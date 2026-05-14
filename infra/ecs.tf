resource "aws_ecs_cluster" "main" {
  name = "${local.prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.prefix}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = local.task_cpu
  memory                   = local.task_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  # ── EFS Volumes ─────────────────────────────────────────────────────────────
  volume {
    name = "sqlite"
    efs_volume_configuration {
      file_system_id          = aws_efs_file_system.data.id
      transit_encryption      = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.sqlite.id
        iam             = "ENABLED"
      }
    }
  }

  volume {
    name = "chroma-data"
    efs_volume_configuration {
      file_system_id          = aws_efs_file_system.data.id
      transit_encryption      = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.chroma.id
        iam             = "ENABLED"
      }
    }
  }

  # BGE embedding models (~400 MB). Persisted on EFS so they are only
  # downloaded once even across container restarts and redeployments.
  volume {
    name = "model-cache"
    efs_volume_configuration {
      file_system_id          = aws_efs_file_system.data.id
      transit_encryption      = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.model_cache.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([

    # ── ChromaDB sidecar ──────────────────────────────────────────────────────
    # Runs alongside the web container in the same task so they share localhost.
    # Next.js connects to it via CHROMA_URL=http://localhost:8000.
    {
      name      = "chroma"
      image     = "chromadb/chroma:latest"
      essential = true

      portMappings = [{ containerPort = 8000, protocol = "tcp" }]

      environment = [
        { name = "IS_PERSISTENT",        value = "TRUE" },
        { name = "ALLOW_RESET",          value = "FALSE" },
        { name = "CHROMA_SERVER_HOST",   value = "0.0.0.0" },
        { name = "PERSIST_DIRECTORY",    value = "/chroma/chroma" },
      ]

      mountPoints = [{
        sourceVolume  = "chroma-data"
        containerPath = "/chroma/chroma"
        readOnly      = false
      }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.chroma.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "chroma"
        }
      }

      healthCheck = {
        # chromadb/chroma does not ship curl; use python3 (always present) instead
        command     = ["CMD-SHELL", "python3 -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/api/v1/heartbeat')\" || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    },

    # ── Next.js web application ───────────────────────────────────────────────
    {
      name      = "web"
      image     = var.web_image
      essential = true

      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      # Wait for ChromaDB to pass its health check before starting the app
      dependsOn = [{
        containerName = "chroma"
        condition     = "HEALTHY"
      }]

      environment = [
        { name = "NODE_ENV",           value = "production" },
        { name = "PORT",               value = "3000" },
        { name = "CHROMA_URL",         value = "http://localhost:8000" },
        { name = "DB_PATH",            value = "/mnt/sqlite/quran.db" },
        { name = "ANTHROPIC_BASE_URL", value = "https://opencode.ai/zen" },
        { name = "ANTHROPIC_MODEL",    value = "minimax-m2.5-free" },
      ]

      # API keys are injected from Secrets Manager at task launch time
      secrets = [
        {
          name      = "ANTHROPIC_API_KEY"
          valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn
        },
        {
          name      = "CLAUDE_API_KEY"
          valueFrom = aws_secretsmanager_secret.claude_api_key.arn
        },
        {
          name      = "OPENAI_API_KEY"
          valueFrom = aws_secretsmanager_secret.openai_api_key.arn
        },
        {
          name      = "OPENROUTER_API_KEY"
          valueFrom = aws_secretsmanager_secret.openrouter_api_key.arn
        },
      ]

      mountPoints = [
        {
          sourceVolume  = "sqlite"
          containerPath = "/mnt/sqlite"
          readOnly      = false
        },
        {
          # @xenova/transformers caches ONNX models at ~/.cache/huggingface/hub/
          sourceVolume  = "model-cache"
          containerPath = "/root/.cache/huggingface"
          readOnly      = false
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.web.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "web"
        }
      }
    },
  ])
}

resource "aws_ecs_service" "app" {
  name            = "${local.prefix}-svc"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "web"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http, aws_efs_mount_target.data]

  lifecycle {
    # Deployments are managed via CI/CD (docker push + force-new-deployment).
    # Terraform only manages infrastructure; ignore image changes here.
    ignore_changes = [task_definition]
  }
}

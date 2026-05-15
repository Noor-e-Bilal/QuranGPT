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

  # ── Volumes (ephemeral) ──────────────────────────────────────────────────────
  # Using local (Docker) volumes instead of EFS to avoid Fargate EFS DNS issues.
  # chroma-data and model-cache are ephemeral: the init container seeds ChromaDB
  # on every task start from the data bundled in the web image.
  volume {
    name = "chroma-data"
    # empty block = Docker-managed ephemeral volume (lost when task stops)
  }

  volume {
    name = "model-cache"
    # empty block = Docker-managed ephemeral volume
  }

  container_definitions = jsonencode([

    # ── Init container: seed ChromaDB ─────────────────────────────────────────
    # Copies pre-built ChromaDB data from the web image into the shared
    # chroma-data volume before the ChromaDB sidecar starts.
    {
      name      = "chroma-init"
      image     = var.web_image
      essential = false
      command   = ["sh", "-c", "cp -rp /app/data/chroma-seed/. /data/ && echo 'ChromaDB seed complete'"]

      mountPoints = [{
        sourceVolume  = "chroma-data"
        containerPath = "/data"
        readOnly      = false
      }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.chroma.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "chroma-init"
        }
      }
    },

    # ── ChromaDB sidecar ──────────────────────────────────────────────────────
    {
      name      = "chroma"
      image     = "chromadb/chroma:latest"
      essential = true

      dependsOn = [{
        containerName = "chroma-init"
        condition     = "SUCCESS"
      }]

      portMappings = [{ containerPort = 8000, protocol = "tcp" }]

      environment = [
        { name = "IS_PERSISTENT",        value = "TRUE" },
        { name = "ALLOW_RESET",          value = "FALSE" },
        { name = "CHROMA_SERVER_HOST",   value = "0.0.0.0" },
      ]

      mountPoints = [{
        sourceVolume  = "chroma-data"
        containerPath = "/data"
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
    },

    # ── Next.js web application ───────────────────────────────────────────────
    {
      name      = "web"
      image     = var.web_image
      essential = true

      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      dependsOn = [{
        containerName = "chroma"
        condition     = "START"
      }]

      environment = [
        { name = "NODE_ENV",           value = "production" },
        { name = "PORT",               value = "3000" },
        { name = "CHROMA_URL",         value = "http://localhost:8000" },
        # DB_PATH is set as ENV in the Dockerfile (/app/data/quran.db, bundled in image)
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
          # @xenova/transformers caches ONNX models here on first query.
          # Ephemeral: models re-download on restart but are cached within task lifetime.
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
  platform_version = "1.4.0"

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

  depends_on = [aws_lb_listener.http]

  lifecycle {
    # Deployments are managed via CI/CD (docker push + force-new-deployment).
    # Terraform only manages infrastructure; ignore image changes here.
    ignore_changes = [task_definition]
  }
}

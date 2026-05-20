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

  # ── Volumes ───────────────────────────────────────────────────────────────────
  # chroma-data and model-cache are ephemeral Docker volumes. ChromaDB is always
  # re-seeded from the bundled image, so ephemeral is intentional there.
  # mongodb-data is EFS-backed so chat history survives task restarts and deploys.
  volume {
    name = "chroma-data"
  }

  volume {
    name = "model-cache"
  }

  # EFS-backed: chat sessions and messages persist across task replacements.
  # Only safe because deployment_minimum_healthy_percent = 0 ensures the old task
  # is fully stopped before the new one starts (single writer at all times).
  volume {
    name = "mongodb-data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      transit_encryption = "ENABLED"
      authorization_config {
        access_point_id = aws_efs_access_point.mongodb.id
        iam             = "ENABLED"
      }
    }
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

    # ── Valkey sidecar (L1 cache) ─────────────────────────────────────────────
    # Redis-compatible in-task KV store. Survives Next.js process restarts within
    # a task lifetime. maxmemory-policy allkeys-lru handles eviction server-side.
    # Non-essential: if Valkey crashes, the web container falls back to in-memory.
    {
      name      = "valkey"
      image     = "valkey/valkey:8"
      essential = false
      cpu       = var.valkey_cpu
      memory    = var.valkey_memory

      portMappings = [{ containerPort = 6379, protocol = "tcp" }]

      command = [
        "valkey-server",
        "--maxmemory", "256mb",
        "--maxmemory-policy", "allkeys-lru",
        "--save", "",         # disable RDB snapshots — ephemeral is intentional
        "--appendonly", "no", # disable AOF — same reason
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.valkey.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "valkey"
        }
      }
    },

    # ── MongoDB sidecar (chat storage) ────────────────────────────────────────
    # Stores chat sessions and messages (the chat history sidebar feature).
    # Storage is ephemeral — chat history is lost when the task is replaced.
    # For production persistence, replace with MongoDB Atlas (set MONGODB_URI
    # secret to the Atlas connection string and remove this sidecar).
    {
      name      = "mongodb"
      image     = "mongo:7"
      essential = true
      cpu       = var.mongo_cpu
      memory    = var.mongo_memory

      portMappings = [{ containerPort = 27017, protocol = "tcp" }]

      environment = [
        { name = "MONGO_INITDB_DATABASE", value = "quransays" },
      ]

      mountPoints = [{
        sourceVolume  = "mongodb-data"
        containerPath = "/data/db"
        readOnly      = false
      }]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.mongodb.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "mongodb"
        }
      }
    },

    # ── ChromaDB sidecar ──────────────────────────────────────────────────────
    {
      name      = "chroma"
      image     = "chromadb/chroma:latest"
      essential = true
      cpu       = var.chroma_cpu
      memory    = var.chroma_memory

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
      cpu       = var.web_cpu
      memory    = var.web_memory

      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      dependsOn = [
        {
          containerName = "chroma"
          condition     = "START"
        },
        {
          containerName = "mongodb"
          condition     = "START"
        },
      ]

      environment = [
        { name = "NODE_ENV",           value = "production" },
        { name = "PORT",               value = "3000" },
        { name = "CHROMA_URL",         value = "http://localhost:8000" },
        { name = "VALKEY_URL",         value = "redis://localhost:6379" },
        { name = "MONGODB_URI",        value = "mongodb://localhost:27017/quransays" },
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

  # Stop-before-start: ensures only ONE MongoDB container ever mounts the EFS
  # access point at a time. Brief downtime (~30s) during deploys is acceptable.
  # With desired_count=1: minimum=0 means stop old → start new (never 2 running).
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

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

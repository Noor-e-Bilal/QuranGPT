# ── ECS Task Execution Role ───────────────────────────────────────────────────
# Used by the ECS agent to pull images from ECR and write logs to CloudWatch.
resource "aws_iam_role" "ecs_execution" {
  name = "${local.prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_managed" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to fetch secrets so they can be injected as env vars
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.prefix}-secrets-read"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [
        aws_secretsmanager_secret.anthropic_api_key.arn,
        aws_secretsmanager_secret.claude_api_key.arn,
        aws_secretsmanager_secret.openai_api_key.arn,
        aws_secretsmanager_secret.openrouter_api_key.arn,
      ]
    }]
  })
}

# ── ECS Task Role ─────────────────────────────────────────────────────────────
# Used by application code running inside the container.
resource "aws_iam_role" "ecs_task" {
  name = "${local.prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_task_logs" {
  name = "${local.prefix}-cloudwatch-logs"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = [
        "${aws_cloudwatch_log_group.web.arn}:*",
        "${aws_cloudwatch_log_group.chroma.arn}:*",
        "${aws_cloudwatch_log_group.mongodb.arn}:*",
      ]
    }]
  })
}

# Allow the task to use EFS with IAM authorization
resource "aws_iam_role_policy" "ecs_task_efs" {
  name = "${local.prefix}-efs-access"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "elasticfilesystem:ClientMount",
        "elasticfilesystem:ClientWrite",
        "elasticfilesystem:ClientRootAccess",
      ]
      Resource = aws_efs_file_system.data.arn
    }]
  })
}

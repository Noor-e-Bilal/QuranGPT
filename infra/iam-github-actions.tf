# ── GitHub Actions OIDC Identity Provider ─────────────────────────────────────
# Allows GitHub Actions to authenticate with AWS using short-lived OIDC tokens
# instead of long-lived IAM access key pairs stored as GitHub secrets.
#
# Trust is scoped to: repo:Noor-e-Bilal/QuranSays on the master branch only.
# The role can only be assumed by workflows triggered by a push to master.

resource "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = [
    "sts.amazonaws.com",
  ]

  # GitHub's OIDC root CA thumbprint (SHA-1 of the root certificate).
  # AWS now validates tokens via JWKS; this field is still required syntactically.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = { Name = "${local.prefix}-oidc-github" }
}

# ── GitHub Actions Deploy Role ─────────────────────────────────────────────────
# Minimum-privilege role: can push to ECR + update ECS service only.
# Cannot manage infrastructure (no VPC/EFS/IAM create/delete permissions).
resource "aws_iam_role" "github_actions_deploy" {
  name = "${local.prefix}-github-deploy"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github_actions.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          # Restrict to master branch pushes only
          "token.actions.githubusercontent.com:sub" = "repo:Noor-e-Bilal/QuranSays:ref:refs/heads/master"
        }
      }
    }]
  })

  tags = { Name = "${local.prefix}-github-deploy" }
}

# ── Deploy Role Policy ─────────────────────────────────────────────────────────
# Grants only the permissions required for a standard ECS deploy:
#   1. Push a new image to the specific ECR repository
#   2. Register a new ECS task definition revision
#   3. Update the ECS service to use the new task definition
#   4. PassRole to the two ECS roles (scoped by ARN — no wildcard)
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "${local.prefix}-github-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # ECR: authorize (account-level) + push to the specific repo only
      {
        Sid    = "ECRGetAuthToken"
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = ["*"] # GetAuthorizationToken requires * (it has no resource ARN)
      },
      {
        Sid    = "ECRPushImage"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:PutImage",
        ]
        Resource = ["arn:aws:ecr:${var.aws_region}:${data.aws_caller_identity.current.account_id}:repository/${aws_ecr_repository.web.name}"]
      },
      # ECS: register new task def revision + deploy to the specific service only
      {
        Sid    = "ECSDeployTaskDef"
        Effect = "Allow"
        Action = [
          "ecs:RegisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
        ]
        Resource = ["*"] # RegisterTaskDefinition has no resource-level permission
      },
      {
        Sid    = "ECSDeployService"
        Effect = "Allow"
        Action = [
          "ecs:UpdateService",
          "ecs:DescribeServices",
        ]
        Resource = [aws_ecs_service.app.id]
      },
      {
        Sid      = "ECSDescribeTasks"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTasks", "ecs:ListTasks"]
        Resource = ["*"]
        Condition = {
          ArnEquals = {
            "ecs:cluster" = aws_ecs_cluster.main.arn
          }
        }
      },
      # IAM PassRole: allows task registration to reference the ECS roles.
      # Scoped to exactly the two ECS roles — not a wildcard.
      {
        Sid    = "IAMPassRoleToECS"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.ecs_execution.arn,
          aws_iam_role.ecs_task.arn,
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "ecs-tasks.amazonaws.com"
          }
        }
      },
    ]
  })
}

# Retrieve the current AWS account ID for ARN construction in the policy above.
data "aws_caller_identity" "current" {}

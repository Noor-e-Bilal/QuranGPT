output "alb_dns_name" {
  description = "Public DNS name of the ALB — point your domain CNAME here"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Route53 hosted zone ID of the ALB (for alias records)"
  value       = aws_lb.main.zone_id
}

output "ecr_repository_url" {
  description = "ECR repository URL — push your Docker image here before first deploy"
  value       = aws_ecr_repository.web.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_task_definition_arn" {
  description = "Latest ECS task definition ARN — use this to update the service after infra changes"
  value       = aws_ecs_task_definition.app.arn
}

output "efs_id" {
  description = "EFS filesystem ID — reference when mounting for the ingestion job"
  value       = aws_efs_file_system.data.id
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC — set as AWS_ROLE_ARN secret in the GitHub repo"
  value       = aws_iam_role.github_actions_deploy.arn
}

output "secret_arns" {
  description = "Secrets Manager ARNs — populate with real API keys before first deploy"
  value = {
    anthropic  = aws_secretsmanager_secret.anthropic_api_key.arn
    claude     = aws_secretsmanager_secret.claude_api_key.arn
    openai     = aws_secretsmanager_secret.openai_api_key.arn
    openrouter = aws_secretsmanager_secret.openrouter_api_key.arn
  }
  sensitive = true
}

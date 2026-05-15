# Secrets are created with placeholder values.
# Populate them before first deployment:
#   aws secretsmanager put-secret-value \
#     --secret-id <ARN> --secret-string "<actual-key>"
#
# Or pass them as sensitive tfvars: terraform apply -var="anthropic_api_key=sk-..."

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name                    = "${local.prefix}/anthropic-api-key"
  description             = "opencode.ai API key — query reformulation via minimax-m2.5-free"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key != "" ? var.anthropic_api_key : "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "claude_api_key" {
  name                    = "${local.prefix}/claude-api-key"
  description             = "Anthropic Claude API key"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "claude_api_key" {
  secret_id     = aws_secretsmanager_secret.claude_api_key.id
  secret_string = var.claude_api_key != "" ? var.claude_api_key : "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "openai_api_key" {
  name                    = "${local.prefix}/openai-api-key"
  description             = "OpenAI API key"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "openai_api_key" {
  secret_id     = aws_secretsmanager_secret.openai_api_key.id
  secret_string = var.openai_api_key != "" ? var.openai_api_key : "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "openrouter_api_key" {
  name                    = "${local.prefix}/openrouter-api-key"
  description             = "OpenRouter API key (free models: Gemini Flash, Llama-4, etc.)"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "openrouter_api_key" {
  secret_id     = aws_secretsmanager_secret.openrouter_api_key.id
  secret_string = var.openrouter_api_key != "" ? var.openrouter_api_key : "REPLACE_ME"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

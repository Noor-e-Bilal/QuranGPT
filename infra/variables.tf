variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Environment name (prod | staging | dev)"
  type        = string
  default     = "prod"
}

variable "app_name" {
  description = "Application name — used as a prefix for all resource names"
  type        = string
  default     = "quransays"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets (ALB lives here; must span ≥2 AZs)"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (ECS tasks run here)"
  type        = list(string)
  default     = ["10.0.3.0/24", "10.0.4.0/24"]
}

variable "availability_zones" {
  description = "AZs to spread across (must align with subnet CIDRs)"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

# ── Container images ──────────────────────────────────────────────────────────
variable "web_image" {
  description = "Full ECR image URI for the Next.js container (e.g. 123456789012.dkr.ecr.us-east-1.amazonaws.com/quransays-prod-web:latest). Set after your first push."
  type        = string
  default     = "REPLACE_ME_AFTER_FIRST_PUSH"
}

# ── Compute sizing ────────────────────────────────────────────────────────────
variable "web_cpu" {
  description = "CPU units for the web container (1024 = 1 vCPU)"
  type        = number
  default     = 1024
}

variable "web_memory" {
  description = "Memory (MiB) for the web container"
  type        = number
  default     = 2048
}

variable "chroma_cpu" {
  description = "CPU units for the ChromaDB sidecar container"
  type        = number
  default     = 512
}

variable "chroma_memory" {
  description = "Memory (MiB) for the ChromaDB sidecar container"
  type        = number
  default     = 2048
}

variable "valkey_cpu" {
  description = "CPU units for the Valkey (L1 cache) sidecar container"
  type        = number
  default     = 512
}

variable "valkey_memory" {
  description = "Memory (MiB) for the Valkey sidecar container"
  type        = number
  default     = 1024
}

variable "mongo_cpu" {
  description = "CPU units for the MongoDB (chat storage) sidecar container"
  type        = number
  default     = 512
}

variable "mongo_memory" {
  description = "Memory (MiB) for the MongoDB sidecar container"
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "Desired number of ECS task instances"
  type        = number
  default     = 1
}

# ── API keys (set via tfvars or CI secrets; all sensitive) ────────────────────
variable "anthropic_api_key" {
  description = "opencode.ai API key — used for query reformulation (minimax-m2.5-free)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "claude_api_key" {
  description = "Anthropic Claude API key — enables the Claude provider"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openai_api_key" {
  description = "OpenAI API key — enables the OpenAI provider"
  type        = string
  sensitive   = true
  default     = ""
}

variable "openrouter_api_key" {
  description = "OpenRouter API key — enables the OpenRouter provider (free models)"
  type        = string
  sensitive   = true
  default     = ""
}

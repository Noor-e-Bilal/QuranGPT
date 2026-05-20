locals {
  prefix = "${var.app_name}-${var.env}"

  common_tags = {
    Project     = var.app_name
    Environment = var.env
    ManagedBy   = "Terraform"
  }

  # ECS task totals = sum of all container allocations
  # Valid Fargate combination: 2048 CPU / 5120 MiB
  task_cpu    = var.web_cpu + var.chroma_cpu + var.valkey_cpu
  task_memory = var.web_memory + var.chroma_memory + var.valkey_memory
}

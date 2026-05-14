locals {
  prefix = "${var.app_name}-${var.env}"

  common_tags = {
    Project     = var.app_name
    Environment = var.env
    ManagedBy   = "Terraform"
  }

  # ECS task totals = sum of all container allocations
  task_cpu    = var.web_cpu + var.chroma_cpu
  task_memory = var.web_memory + var.chroma_memory
}

locals {
  prefix = "${var.app_name}-${var.env}"

  common_tags = {
    Project     = var.app_name
    Environment = var.env
    ManagedBy   = "Terraform"
  }

  # ECS task totals = sum of all container allocations
  # Valid Fargate combination: 4096 CPU / 8192 MiB (web+chroma+valkey+mongo)
  task_cpu    = var.web_cpu + var.chroma_cpu + var.valkey_cpu + var.mongo_cpu
  task_memory = var.web_memory + var.chroma_memory + var.valkey_memory + var.mongo_memory
}

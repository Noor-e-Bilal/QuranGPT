resource "aws_efs_file_system" "data" {
  creation_token   = "${local.prefix}-data"
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"
  encrypted        = true

  # Move cold files to Infrequent Access after 30 days to cut storage cost
  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = { Name = "${local.prefix}-data" }
}

# Mount target in every private subnet so any AZ can reach EFS
resource "aws_efs_mount_target" "data" {
  count           = length(aws_subnet.private)
  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# ── Access Points ─────────────────────────────────────────────────────────────
# Each access point is an isolated directory inside the single EFS filesystem.

resource "aws_efs_access_point" "sqlite" {
  file_system_id = aws_efs_file_system.data.id

  root_directory {
    path = "/sqlite"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "0750"
    }
  }

  posix_user {
    gid = 1000
    uid = 1000
  }

  tags = { Name = "${local.prefix}-ap-sqlite" }
}

resource "aws_efs_access_point" "chroma" {
  file_system_id = aws_efs_file_system.data.id

  root_directory {
    path = "/chroma"
    creation_info {
      owner_gid   = 1000
      owner_uid   = 1000
      permissions = "0750"
    }
  }

  posix_user {
    gid = 1000
    uid = 1000
  }

  tags = { Name = "${local.prefix}-ap-chroma" }
}

# MongoDB chat storage: persists chat sessions and messages across task restarts.
# MongoDB process in mongo:7 runs as uid/gid 999 ("mongodb" user).
# IMPORTANT: deployment_minimum_healthy_percent = 0 in ecs.tf ensures only ONE
# MongoDB container ever mounts this access point at a time (stop-before-start).
resource "aws_efs_access_point" "mongodb" {
  file_system_id = aws_efs_file_system.data.id

  root_directory {
    path = "/mongodb"
    creation_info {
      owner_gid   = 999
      owner_uid   = 999
      permissions = "0750"
    }
  }

  posix_user {
    gid = 999
    uid = 999
  }

  tags = { Name = "${local.prefix}-ap-mongodb" }
}

# Model cache: @xenova/transformers downloads ONNX embedding models here on first query.
# Persisting on EFS means the ~400 MB BGE-base model is only downloaded once.
resource "aws_efs_access_point" "model_cache" {
  file_system_id = aws_efs_file_system.data.id

  root_directory {
    path = "/model-cache"
    creation_info {
      owner_gid   = 0
      owner_uid   = 0
      permissions = "0755"
    }
  }

  posix_user {
    gid = 0
    uid = 0
  }

  tags = { Name = "${local.prefix}-ap-model-cache" }
}

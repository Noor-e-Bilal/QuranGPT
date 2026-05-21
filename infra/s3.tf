# Build-asset bucket — stores the pre-built Quran data files (quran.db + chroma/)
# that are gitignored but must be present at docker-build time.
#
# Populated once (or after re-ingestion) by running:
#   aws s3 sync data/ s3://<bucket>/data/ --delete
#
# The GitHub Actions deploy role has read-only access to this bucket.
resource "aws_s3_bucket" "build_assets" {
  bucket = "${local.prefix}-build-assets"

  tags = { Name = "${local.prefix}-build-assets" }
}

resource "aws_s3_bucket_versioning" "build_assets" {
  bucket = aws_s3_bucket.build_assets.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Block all public access — CI downloads via OIDC role, not public URLs
resource "aws_s3_bucket_public_access_block" "build_assets" {
  bucket = aws_s3_bucket.build_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "build_assets" {
  bucket = aws_s3_bucket.build_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

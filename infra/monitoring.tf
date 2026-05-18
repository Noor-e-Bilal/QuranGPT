resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.prefix}-web"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "chroma" {
  name              = "/ecs/${local.prefix}-chroma"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "valkey" {
  name              = "/ecs/${local.prefix}-valkey"
  retention_in_days = 7
}

# ── Optional: ALB 5xx alarm ───────────────────────────────────────────────────
# Uncomment and add an SNS topic (var.alert_sns_arn) to receive email alerts.
#
# resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
#   alarm_name          = "${local.prefix}-alb-5xx"
#   comparison_operator = "GreaterThanThreshold"
#   evaluation_periods  = 2
#   metric_name         = "HTTPCode_Target_5XX_Count"
#   namespace           = "AWS/ApplicationELB"
#   period              = 60
#   statistic           = "Sum"
#   threshold           = 10
#   alarm_description   = "ALB 5xx errors > 10 per minute for 2 consecutive minutes"
#
#   dimensions = {
#     LoadBalancer = aws_lb.main.arn_suffix
#   }
#
#   alarm_actions = [var.alert_sns_arn]
# }

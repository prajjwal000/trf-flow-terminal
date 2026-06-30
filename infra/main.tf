provider "aws" {
  region = var.region
}

data "archive_file" "aggregator" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/bin/aggregator"
  output_path = "${path.module}/.terraform/aggregator.zip"
}

resource "aws_s3_bucket" "cache" {
  bucket_prefix = "trf-flow-cache-"
  force_destroy = true
}

resource "aws_iam_role" "lambda" {
  name_prefix = "trf-flow-lambda-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "lambda_s3" {
  name_prefix = "trf-flow-lambda-s3-"
  role        = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:CopyObject"]
      Resource = "${aws_s3_bucket.cache.arn}/*"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_logs" {
  name_prefix = "trf-flow-lambda-logs-"
  role        = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "arn:aws:logs:*:*:*"
    }]
  })
}

resource "aws_lambda_function" "aggregator" {
  filename         = data.archive_file.aggregator.output_path
  source_code_hash = data.archive_file.aggregator.output_base64sha256
  function_name    = "trf-flow-aggregator"
  role             = aws_iam_role.lambda.arn
  handler          = "bootstrap"
  runtime          = "provided.al2"
  memory_size      = 512
  timeout          = 300

  environment {
    variables = {
      APCA_API_KEY_ID     = var.APCA_API_KEY_ID
      APCA_API_SECRET_KEY = var.APCA_API_SECRET_KEY
      CACHE_BUCKET        = aws_s3_bucket.cache.bucket
    }
  }
}

resource "aws_apigatewayv2_api" "main" {
  name          = "trf-flow-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = [var.allowed_origin]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["Content-Type"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.aggregator.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "replay" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/replay"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "health" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/health"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "search" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /api/search"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_route" "options" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "OPTIONS /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "api_gw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.aggregator.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ─── FINRA ATS Cron ────────────────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "finra_cron" {
  name_prefix         = "trf-flow-finra-"
  schedule_expression = "cron(0 6 ? * MON *)"
}

resource "aws_iam_role" "finra_lambda" {
  name_prefix = "trf-flow-finra-lambda-"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy" "finra_lambda_s3" {
  name_prefix = "trf-flow-finra-lambda-s3-"
  role        = aws_iam_role.finra_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject"]
      Resource = "${aws_s3_bucket.cache.arn}/finra-ats/*"
    }]
  })
}

resource "aws_iam_role_policy" "finra_lambda_logs" {
  name_prefix = "trf-flow-finra-lambda-logs-"
  role        = aws_iam_role.finra_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "arn:aws:logs:*:*:*"
    }]
  })
}

data "archive_file" "finra_cron" {
  type        = "zip"
  source_dir  = "${path.module}/../backend/bin/finra-cron"
  output_path = "${path.module}/.terraform/finra-cron.zip"
}

resource "aws_lambda_function" "finra_cron" {
  filename         = data.archive_file.finra_cron.output_path
  source_code_hash = data.archive_file.finra_cron.output_base64sha256
  function_name    = "trf-flow-finra-cron"
  role             = aws_iam_role.finra_lambda.arn
  handler          = "bootstrap"
  runtime          = "provided.al2"
  memory_size      = 128
  timeout          = 120

  environment {
    variables = {
      CACHE_BUCKET = aws_s3_bucket.cache.bucket
    }
  }
}

resource "aws_lambda_permission" "finra_cron" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.finra_cron.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.finra_cron.arn
}

resource "aws_cloudwatch_event_target" "finra_cron" {
  rule  = aws_cloudwatch_event_rule.finra_cron.name
  arn   = aws_lambda_function.finra_cron.arn
}

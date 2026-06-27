output "api_url" {
  value = aws_apigatewayv2_api.main.api_endpoint
}

output "cache_bucket" {
  value = aws_s3_bucket.cache.bucket
}

output "lambda_role_arn" {
  value = aws_iam_role.lambda.arn
}

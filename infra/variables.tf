variable "alpaca_api_key" {
  type      = string
  sensitive = true
}

variable "alpaca_api_secret" {
  type      = string
  sensitive = true
}

variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "allowed_origin" {
  type    = string
  default = "*"
}

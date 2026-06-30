variable "APCA_API_KEY_ID" {
  type      = string
  sensitive = true
}

variable "APCA_API_SECRET_KEY" {
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

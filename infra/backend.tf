terraform {
  backend "s3" {
    bucket = "trf-flow-project-tfstate-bucket"
    key    = "trf-flow/terraform.tfstate"
    region = "ap-south-1"
  }
}

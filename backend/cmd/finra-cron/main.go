package main

import (
	"context"
	"log"

	"github.com/aws/aws-lambda-go/lambda"
)

func handler(ctx context.Context) error {
	log.Println("FINRA cron stub")
	return nil
}

func main() {
	lambda.Start(handler)
}

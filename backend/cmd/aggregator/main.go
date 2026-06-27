package main

import (
	"context"
	"encoding/json"
	"log"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func handler(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	tickers := req.QueryStringParameters["tickers"]
	hours := req.QueryStringParameters["hours"]

	log.Printf("received request: tickers=%s, hours=%s", tickers, hours)

	body, err := json.Marshal(map[string]string{
		"message": "hello from trf-flow",
		"tickers": tickers,
		"hours":   hours,
	})
	if err != nil {
		return events.APIGatewayProxyResponse{StatusCode: 500, Body: `{"error":"internal"}`}, nil
	}

	return events.APIGatewayProxyResponse{
		StatusCode: 200,
		Headers: map[string]string{
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		},
		Body: string(body),
	}, nil
}

func main() {
	lambda.Start(handler)
}

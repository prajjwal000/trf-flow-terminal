.PHONY: build clean

build:
	GOOS=linux GOARCH=amd64 go build -o bin/aggregator/bootstrap cmd/aggregator/main.go

clean:
	rm -rf bin/

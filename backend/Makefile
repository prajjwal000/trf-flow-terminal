.PHONY: build dev clean

build: bin/aggregator/bootstrap bin/finra-cron/bootstrap bin/local-server

dev: bin/local-server
	@echo "==> starting local server on :9000"
	./bin/local-server

bin/aggregator/bootstrap: cmd/aggregator/main.go
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o $@ ./cmd/aggregator

bin/finra-cron/bootstrap: cmd/finra-cron/main.go
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o $@ ./cmd/finra-cron

bin/local-server: cmd/local-server/main.go
	CGO_ENABLED=0 go build -o $@ ./cmd/local-server

clean:
	rm -rf bin/ aggregator finra-cron local-server

package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/alpacahq/alpaca-trade-api-go/v3/marketdata"
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/prajjwal000/trf-flow-terminal/backend/internal/bucket"
	"github.com/prajjwal000/trf-flow-terminal/backend/internal/cache"
	"github.com/prajjwal000/trf-flow-terminal/backend/internal/classifier"
)

type SymbolResult struct {
	Symbol  string         `json:"symbol"`
	Buckets []bucket.Bucket `json:"buckets"`
	Error   string         `json:"error,omitempty"`
	Warn    string         `json:"warn,omitempty"`
}

type ReplayResponse struct {
	Status      string         `json:"status"`
	Symbols     []SymbolResult `json:"symbols"`
	NextOffset  int            `json:"next_offset,omitempty"`
	Warn        string         `json:"warn,omitempty"`
	TruncatedAt int64          `json:"truncated_at,omitempty"`
}

func main() {
	lambda.Start(func(ctx context.Context, req events.APIGatewayV2HTTPRequest) (events.APIGatewayProxyResponse, error) {
		if req.RequestContext.HTTP.Method == "OPTIONS" {
			return respond(200, nil), nil
		}
		switch req.RouteKey {
		case "GET /api/health":
			return handleHealth(), nil
		case "GET /api/replay":
			return handleReplay(ctx, req), nil
		case "GET /api/search":
			return handleSearch(ctx, req), nil
		default:
			return respond(404, map[string]string{"error": "not_found"}), nil
		}
	})
}

func handleHealth() events.APIGatewayProxyResponse {
	return respond(200, map[string]string{"status": "ok"})
}

type SearchResult struct {
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Exchange string `json:"exchange"`
}

var (
	assetCache     []SearchResult
	assetCacheMu   sync.Mutex
	assetCacheDone bool
)

func ensureAssetCache(ctx context.Context) {
	assetCacheMu.Lock()
	defer assetCacheMu.Unlock()
	if assetCacheDone {
		return
	}

	apiReq, _ := http.NewRequestWithContext(ctx, "GET", "https://api.alpaca.markets/v2/assets?status=active", nil)
	if apiReq == nil {
		return
	}
	apiReq.Header.Set("APCA-API-KEY-ID", os.Getenv("APCA_API_KEY_ID"))
	apiReq.Header.Set("APCA-API-SECRET-KEY", os.Getenv("APCA_API_SECRET_KEY"))

	resp, err := http.DefaultClient.Do(apiReq)
	if err != nil {
		log.Printf("asset fetch failed: %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("asset fetch returned status %d", resp.StatusCode)
		return
	}

	body, _ := io.ReadAll(resp.Body)
	type Asset struct {
		Symbol   string `json:"symbol"`
		Name     string `json:"name"`
		Exchange string `json:"exchange"`
		Status   string `json:"status"`
	}
	var assets []Asset
	if err := json.Unmarshal(body, &assets); err != nil {
		log.Printf("asset parse failed: %v", err)
		return
	}
	seen := map[string]bool{}
	for _, a := range assets {
		if a.Status == "active" && !seen[a.Symbol] {
			assetCache = append(assetCache, SearchResult{Symbol: a.Symbol, Name: a.Name, Exchange: a.Exchange})
			seen[a.Symbol] = true
		}
	}
	assetCacheDone = true
	log.Printf("cached %d assets", len(assetCache))
}

func handleSearch(ctx context.Context, req events.APIGatewayV2HTTPRequest) events.APIGatewayProxyResponse {
	q := req.QueryStringParameters["q"]
	if q == "" {
		return respond(400, map[string]string{"error": "missing_query"})
	}

	ensureAssetCache(ctx)

	if !assetCacheDone {
		return respond(200, []SearchResult{})
	}

	qUpper := strings.ToUpper(q)
	qLower := strings.ToLower(q)
	results := make([]SearchResult, 0, 15)
	for _, a := range assetCache {
		if strings.HasPrefix(a.Symbol, qUpper) || strings.Contains(strings.ToLower(a.Name), qLower) {
			results = append(results, a)
			if len(results) >= 15 {
				break
			}
		}
	}
	return respond(200, results)
}

func handleReplay(ctx context.Context, req events.APIGatewayV2HTTPRequest) events.APIGatewayProxyResponse {
	tickersRaw := req.QueryStringParameters["tickers"]
	startRaw := req.QueryStringParameters["start"]
	endRaw := req.QueryStringParameters["end"]
	offsetRaw := req.QueryStringParameters["offset"]

	if tickersRaw == "" || startRaw == "" || endRaw == "" {
		return respond(400, map[string]string{"error": "missing_params"})
	}

	tickers := strings.Split(tickersRaw, ",")
	if len(tickers) > 5 {
		return respond(400, map[string]string{"error": "too_many_tickers"})
	}

	start, err := time.Parse(time.RFC3339, startRaw)
	if err != nil {
		return respond(400, map[string]string{"error": "invalid_start"})
	}
	end, err := time.Parse(time.RFC3339, endRaw)
	if err != nil {
		return respond(400, map[string]string{"error": "invalid_end"})
	}
	if !end.After(start) {
		return respond(400, map[string]string{"error": "end_must_be_after_start"})
	}
	windowHours := end.Sub(start).Hours()
	if windowHours < 1 || windowHours > 8 {
		return respond(400, map[string]string{"error": "invalid_window"})
	}

	offset := 0
	if offsetRaw != "" {
		offset, err = strconv.Atoi(offsetRaw)
		if err != nil || offset < 0 {
			return respond(400, map[string]string{"error": "invalid_offset"})
		}
	}

	bucketMs := bucket.SelectSize()
	c := initCache(ctx, bucketMs)

	log.Printf("replay: %v [%s – %s] offset=%d bucketMs=%d", tickers, startRaw, endRaw, offset, bucketMs)

	totalSec := int(end.Sub(start).Seconds())
	chunkSec := max(30, min(offset, 90))
	fetchStart := start.Add(time.Duration(offset) * time.Second)
	fetchEnd := fetchStart.Add(time.Duration(chunkSec) * time.Second)
	if fetchEnd.After(end) {
		fetchEnd = end
	}

	// Check full cache
	if c != nil {
		full, err := c.GetFull(ctx, tickers, start, end)
		if err == nil {
			log.Printf("full cache HIT")
			return respondRaw(200, full)
		}

		// Check chunk cache
		chunkRaw, err := c.GetChunk(ctx, tickers, start, end, offset)
		if err == nil {
			log.Printf("chunk cache HIT offset=%d", offset)
			var symbols []SymbolResult
			if err := json.Unmarshal(chunkRaw, &symbols); err == nil {
				nextOff := offset + chunkSec
				if nextOff >= totalSec {
					nextOff = -1
				}
				return respond(200, ReplayResponse{
					Status:     "partial",
					Symbols:    symbols,
					NextOffset: nextOff,
				})
			}
		}
	}

	// Fetch from Alpaca
	log.Printf("fetching offset=%d [%s – %s]", offset, fetchStart.Format(time.RFC3339), fetchEnd.Format(time.RFC3339))
	client := marketdata.NewClient(marketdata.ClientOpts{
		APIKey:    os.Getenv("APCA_API_KEY_ID"),
		APISecret: os.Getenv("APCA_API_SECRET_KEY"),
	})

	mreq := marketdata.GetTradesRequest{
		Start: fetchStart,
		End:   fetchEnd,
		Feed:  "sip",
	}
	var trades map[string][]marketdata.Trade
	for attempt := 0; attempt < 3; attempt++ {
		trades, err = client.GetMultiTrades(tickers, mreq)
		if err == nil {
			break
		}
		log.Printf("attempt %d failed: %v", attempt+1, err)
		if attempt < 2 {
			time.Sleep(time.Duration(1<<attempt) * time.Millisecond * 500)
		}
	}
	if err != nil {
		log.Printf("GetMultiTrades exhausted: %v", err)
		return respond(500, map[string]string{"error": "upstream_unavailable"})
	}

	symbols := classifyAndBucket(tickers, trades, bucketMs)
	chunkData, _ := json.Marshal(symbols)

	if c != nil {
		if err := c.SetChunk(ctx, tickers, start, end, offset, chunkData); err != nil {
			log.Printf("chunk cache write error: %v", err)
		}
	}

	nextOff := offset + chunkSec
	status := "partial"
	if nextOff >= totalSec {
		nextOff = -1
		status = "complete"
	}

	// Check if all chunks done
	if status == "complete" && c != nil {
		updateMeta(ctx, c, tickers, start, end, offset)
		assembleFull(ctx, c, tickers, start, end)
	} else if c != nil {
		updateMeta(ctx, c, tickers, start, end, offset)
	}

	resp := ReplayResponse{
		Status:     status,
		Symbols:    symbols,
		NextOffset: nextOff,
	}

	return respondWithGuard(200, resp)
}

func initCache(ctx context.Context, bucketMs int64) *cache.Client {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Printf("aws config error: %v", err)
		return nil
	}
	s3Client := s3.NewFromConfig(cfg)
	bucket := os.Getenv("CACHE_BUCKET")
	if bucket == "" {
		bucket = "trf-flow-cache-dev"
	}
	return cache.New(s3Client, bucket, bucketMs)
}

func updateMeta(ctx context.Context, c *cache.Client, tickers []string, start, end time.Time, offset int) {
	meta, err := c.GetMeta(ctx, tickers, start, end)
	if err != nil {
		meta = &cache.SliceMeta{FetchedOffsets: []int{}}
	}
	for _, o := range meta.FetchedOffsets {
		if o == offset {
			return
		}
	}
	meta.FetchedOffsets = append(meta.FetchedOffsets, offset)
	sort.Ints(meta.FetchedOffsets)
	meta.Complete = true
	for _, o := range meta.FetchedOffsets {
		nextOff := o + chunkSize(o)
		if nextOff < int(end.Sub(start).Seconds()) {
			meta.Complete = false
			break
		}
	}
	if err := c.SetMeta(ctx, tickers, start, end, meta); err != nil {
		log.Printf("meta write error: %v", err)
	}
}

func assembleFull(ctx context.Context, c *cache.Client, tickers []string, start, end time.Time) {
	meta, err := c.GetMeta(ctx, tickers, start, end)
	if err != nil {
		log.Printf("assemble: no meta found")
		return
	}

	all := make(map[string][]bucket.Bucket)
	for _, off := range meta.FetchedOffsets {
		raw, err := c.GetChunk(ctx, tickers, start, end, off)
		if err != nil {
			log.Printf("assemble: missing offset=%d", off)
			return
		}
		var symbols []SymbolResult
		if err := json.Unmarshal(raw, &symbols); err != nil {
			log.Printf("assemble: unmarshal error offset=%d: %v", off, err)
			return
		}
		for _, sym := range symbols {
			all[sym.Symbol] = append(all[sym.Symbol], sym.Buckets...)
		}
	}

	for _, sym := range tickers {
		if b, ok := all[sym]; ok {
			sort.Slice(b, func(i, j int) bool { return b[i].Epoch < b[j].Epoch })
		}
	}

	var result []SymbolResult
	for _, sym := range tickers {
		if b, ok := all[sym]; ok {
			result = append(result, SymbolResult{Symbol: sym, Buckets: b})
		}
	}

	data, _ := json.Marshal(ReplayResponse{Status: "complete", Symbols: result})
	if err := c.SetFull(ctx, tickers, start, end, data); err != nil {
		log.Printf("full cache write error: %v", err)
	}
}

func respondWithGuard(code int, resp ReplayResponse) events.APIGatewayProxyResponse {
	const maxPayload = 5.5 * 1024 * 1024
	body, _ := json.Marshal(resp)
	if len(body) <= maxPayload {
		return respondRaw(code, body)
	}

	ratio := float64(maxPayload) / float64(len(body))
	for i := range resp.Symbols {
		keep := int(float64(len(resp.Symbols[i].Buckets)) * ratio * 0.9)
		if keep < len(resp.Symbols[i].Buckets) && keep > 0 {
			resp.Symbols[i].Buckets = resp.Symbols[i].Buckets[:keep]
		}
	}
	resp.Warn = "truncated"
	if len(resp.Symbols) > 0 && len(resp.Symbols[0].Buckets) > 0 {
		resp.TruncatedAt = resp.Symbols[0].Buckets[len(resp.Symbols[0].Buckets)-1].Epoch
	}
	body, _ = json.Marshal(resp)
	log.Printf("payload truncated to %d bytes", len(body))
	return respondRaw(code, body)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func chunkSize(offset int) int {
	return max(30, min(offset, 90))
}

func classifyAndBucket(tickers []string, trades map[string][]marketdata.Trade, bucketMs int64) []SymbolResult {
	symbols := make([]SymbolResult, 0, len(tickers))
	for _, sym := range tickers {
		sr := SymbolResult{Symbol: sym}
		t, ok := trades[sym]
		if !ok {
			sr.Buckets = []bucket.Bucket{}
			sr.Error = "ticker_not_found"
			symbols = append(symbols, sr)
			continue
		}
		if len(t) == 0 {
			sr.Buckets = []bucket.Bucket{}
			sr.Warn = "no_trades_in_window"
			symbols = append(symbols, sr)
			continue
		}
		agg := bucket.NewAggregator(bucketMs)
		for _, tr := range t {
			cls := classifier.Classify(classifier.Trade{
				Price:    tr.Price,
				Size:     tr.Size,
				Exchange: tr.Exchange,
			})
			epoch := tr.Timestamp.UnixMilli()
			switch cls {
			case classifier.Lit:
				agg.Add(epoch, int64(tr.Size), 0, 0, 0, 0)
			case classifier.DarkRetail:
				agg.Add(epoch, 0, int64(tr.Size), 0, 0, 0)
			case classifier.DarkInstitutionalSmall, classifier.DarkInstitutionalMid:
				agg.Add(epoch, 0, 0, int64(tr.Size), 0, 0)
			case classifier.DarkInstitutionalBlock:
				agg.Add(epoch, 0, 0, int64(tr.Size), int64(tr.Size), 1)
			}
		}
		sr.Buckets = agg.Snapshot()
		symbols = append(symbols, sr)
	}
	return symbols
}

func respondRaw(code int, body []byte) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers: map[string]string{
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Content-Type":                 "application/json",
		},
		Body: string(body),
	}
}

func respond(code int, body interface{}) events.APIGatewayProxyResponse {
	b, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: code,
		Headers: map[string]string{
			"Access-Control-Allow-Origin":  "*",
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
			"Content-Type":                 "application/json",
		},
		Body: string(b),
	}
}

package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/alpacahq/alpaca-trade-api-go/v3/marketdata"

	"github.com/prajjwal000/trf-flow-terminal/backend/internal/bucket"
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

func ensureAssetCache() {
	assetCacheMu.Lock()
	defer assetCacheMu.Unlock()
	if assetCacheDone {
		return
	}

	apiReq, _ := http.NewRequest("GET", "https://api.alpaca.markets/v2/assets?status=active", nil)
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

func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next(w, r)
	}
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", cors(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))

	mux.HandleFunc("/api/search", cors(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		q := r.URL.Query().Get("q")
		if q == "" {
			writeError(w, http.StatusBadRequest, "missing_query")
			return
		}

		ensureAssetCache()
		if !assetCacheDone {
			json.NewEncoder(w).Encode([]SearchResult{})
			return
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
		json.NewEncoder(w).Encode(results)
	}))

	mux.HandleFunc("/api/replay", cors(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		tickersRaw := r.URL.Query().Get("tickers")
		startRaw := r.URL.Query().Get("start")
		endRaw := r.URL.Query().Get("end")
		offsetRaw := r.URL.Query().Get("offset")

		if tickersRaw == "" || startRaw == "" || endRaw == "" {
			writeError(w, http.StatusBadRequest, "missing_params")
			return
		}

		tickers := strings.Split(tickersRaw, ",")
		if len(tickers) > 5 {
			writeError(w, http.StatusBadRequest, "too_many_tickers")
			return
		}

		start, err := time.Parse(time.RFC3339, startRaw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_start")
			return
		}
		end, err := time.Parse(time.RFC3339, endRaw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_end")
			return
		}
		if !end.After(start) {
			writeError(w, http.StatusBadRequest, "end_must_be_after_start")
			return
		}

		offset := 0
		if offsetRaw != "" {
			offset, err = strconv.Atoi(offsetRaw)
			if err != nil || offset < 0 {
				writeError(w, http.StatusBadRequest, "invalid_offset")
				return
			}
		}

		bucketMs := bucket.SelectSize()

		chunkSec := max(30, offset*2)
		fetchStart := start.Add(time.Duration(offset) * time.Second)
		fetchEnd := fetchStart.Add(time.Duration(chunkSec) * time.Second)
		if fetchEnd.After(end) {
			fetchEnd = end
		}

		log.Printf("fetching offset=%d [%s – %s]", offset, fetchStart.Format(time.RFC3339), fetchEnd.Format(time.RFC3339))
		client := marketdata.NewClient(marketdata.ClientOpts{
			APIKey:    os.Getenv("APCA_API_KEY_ID"),
			APISecret: os.Getenv("APCA_API_SECRET_KEY"),
		})

		req := marketdata.GetTradesRequest{
			Start: fetchStart,
			End:   fetchEnd,
			Feed:  "sip",
		}
		var trades map[string][]marketdata.Trade
		for attempt := 0; attempt < 3; attempt++ {
			trades, err = client.GetMultiTrades(tickers, req)
			if err == nil {
				break
			}
			log.Printf("attempt %d failed: %v", attempt+1, err)
			if attempt < 2 {
				time.Sleep(time.Duration(1<<attempt) * time.Second)
			}
		}
		if err != nil {
			log.Printf("GetMultiTrades exhausted: %v", err)
			writeError(w, http.StatusInternalServerError, "upstream_unavailable")
			return
		}

		symbols := classifyAndBucket(tickers, trades, bucketMs)

		totalSec := int(end.Sub(start).Seconds())
		nextOff := offset + chunkSec
		status := "partial"
		if nextOff >= totalSec {
			nextOff = -1
			status = "complete"
		}

		resp := ReplayResponse{
			Status:     status,
			Symbols:    symbols,
			NextOffset: nextOff,
		}
		respondWithGuard(w, resp)
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "9000"
	}
	log.Printf("listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
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

func respondWithGuard(w http.ResponseWriter, resp ReplayResponse) {
	const maxPayload = 5.5 * 1024 * 1024
	body, err := json.Marshal(resp)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "serialization_error")
		return
	}
	if len(body) <= maxPayload {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write(body)
		return
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
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Write(body)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

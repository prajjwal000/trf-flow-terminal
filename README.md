# TRF Flow Terminal

Serverless full-stack application that aggregates, classifies, and replays institutional equity trade data — contrasting lit-exchange volume against off-exchange activity across multiple tickers simultaneously, with three-way flow classification separating retail internalization from institutional dark pool prints.

**Data pipeline:** Alpaca SIP (15-min delayed) → Go Lambda (fetch + classify + bucket) → React (Virtual Clock replay + treemap visualization)

---

## 1. System Overview

Fetches historical tick-level trade data from Alpaca's free-tier SIP consolidated tape feed. Classifies each trade across three flow categories: lit exchange, retail internalized (off-exchange PFOF wholesaler flow), and institutional dark pool (genuine dark pool prints and block trades). Aggregates into 1-minute volume buckets per symbol. Returns compressed JSON to a React frontend that replays via a synchronized Virtual Clock engine — no WebSocket needed.

The 15-minute SIP delay is irrelevant: the frontend replays data, not streams live. Users experience the session as a controllable replay at 1x, 5x, or 10x speed.

### Flow Classification

Each trade is classified using two independent heuristics applied in sequence:

**Step 1 — Exchange code (lit vs. off-exchange):**
Exchange codes `D` (FINRA ADF) and `E` (Market Independent) are off-exchange. All other codes are lit. This is definitive — FINRA TRF rules require all off-exchange trades to be reported through `D` or `E`.

**Step 2 — Sub-penny tick filter (retail vs. institutional, off-exchange only):**
Retail wholesalers (Citadel, Virtu, Susquehanna, etc.) are required by FINRA to provide sub-penny price improvement over NBBO. This means internalized retail prints arrive at fractional-cent prices (e.g., `$185.3214`), while institutional dark pool prints execute at NBBO or mid-point — always at penny or half-penny boundaries (`$185.32`, `$185.325`). Any off-exchange print where `price mod $0.01` has a nonzero fractional-cent component is classified as retail internalized.

**Step 3 — Notional size tier (institutional prints only):**
Off-exchange penny-tick prints are further bucketed by notional value (`price × shares`):

| Tier | Notional | Label |
|---|---|---|
| `dark_retail` | — | Sub-penny tick; retail internalization |
| `dark_inst_small` | < $1M | Penny tick; smaller institutional / ambiguous |
| `dark_inst_mid` | $1M–$10M | Mid-size institutional |
| `dark_inst_block` | > $10M | Large block; primary institutional signal |

> **Why this matters:** The naive lit/dark binary overstates institutional dark pool activity. A large fraction of off-exchange volume is PFOF retail internalization with no informational content about institutional positioning. The three-way split surfaces the signal underneath.

FINRA ATS weekly reports are ingested via cron Lambda and stored in S3. Each symbol is enriched with a **Dark Pool Tendency Score** — 4-week trailing average % *institutional* off-exchange volume (retail internalization excluded) — providing historical context the real-time feed cannot give.

> **Limitation:** The sub-penny tick filter correctly classifies the bulk of retail internalization but is not perfect. A small fraction of institutional algorithmic orders (e.g., peg orders with sub-penny improvement) may be miscategorized as retail. Distinguishing these with higher confidence requires MPID-level data not available in the free SIP tier and will be addressed in a future iteration.

---

## 2. Component Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                                 │
│                      React App (Netlify CDN)                         │
│                                                                      │
│  ┌─────────────────────────┐    ┌───────────────────────────────┐   │
│  │   Virtual Clock Engine  │    │        Visualization          │   │
│  │                         │    │                               │   │
│  │  requestAnimationFrame  │───▶│  Treemap (Canvas GPU-accel)   │   │
│  │  Playback: 1x / 5x / 10x│    │  Grid/Bento per-ticker cells │   │
│  │  Immutable data ref     │    │  Sized by total volume        │   │
│  │  Single global timeline │    │  Colored by inst. dark % dev. │   │
│  └─────────────────────────┘    │  Leaderboard mode (deviation) │   │
│                                 │                               │   │
│  ┌─────────────────────────┐    │  Detail card on click:        │   │
│  │   Incremental Polling   │    │  Stacked sparkline (lit /     │   │
│  │                         │    │  dark_retail / dark_inst),    │   │
│  │  GET /api/replay?token=X│    │  running totals, block print  │   │
│  │  Exponential backoff    │    │  audit log                    │   │
│  └─────────────────────────┘    └───────────────────────────────┘   │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
                       │  GET /api/replay?tickers=AAPL,SPY,NVDA&hours=2
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       GATEWAY LAYER                                  │
│                     AWS API Gateway (HTTP API)                       │
│                                                                      │
│  CORS → Netlify origin  │  GET /api/replay → Lambda                  │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      AGGREGATOR LAYER                                │
│                  AWS Lambda — Go Binary                              │
│                  512MB  │  5 min timeout                             │
│                                                                      │
│  1. S3 cache check → HIT → slice buckets to match window → return    │
│                     MISS → start fetch, write staging to S3          │
│                                                                      │
│  2. Alpaca SDK GetMultiTradesAsync (concurrent, token-bucket         │
│     rate-limited to 200 req/min)                                     │
│                                                                      │
│  3. MapReduce: drain channel → classify each trade (exchange code    │
│     → sub-penny tick filter → notional tier) → bucket by            │
│     (symbol, epoch_ms, lit|dark_retail|dark_inst_*) at             │
│     adaptive resolution (0.5s / 1s / 5s per window length)         │
│                                                                      │
│  4. FINRA ATS enrichment via S3 lookup (tendency score uses          │
│     institutional dark only, retail internalization excluded)        │
│                                                                      │
│  5. Write first 30s of buckets to S3 staging → return            │
│     { status:"partial"} Client polls with exponential backoff     │
│                                                                      │
│  6. On completion: promote staging → final cache entry               │
│                                                                      │
│  7. Payload guard: truncate at 5.5MB per chunk if over limit         │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        DATA LAYER                                    │
│                                                                      │
│  ┌──────────────────────┐    ┌────────────────────────────────────┐ │
│  │  Alpaca Markets API  │    │  AWS S3                            │ │
│  │                      │    │                                    │ │
│  │  /v2/stocks/trades   │    │  cache/{key}/{date}/{start}-{end}.json
│  │  SIP delayed feed    │    │  cache/{key}/{date}/{start}-{end}/ │ │
│  │  200 req/min limit   │    │    staging.json                    │ │
│  └──────────────────────┘    │  finra-ats/latest.json             │ │
│                              │  finra-ats/{YYYY-WW}.json          │ │
│  ┌────────────────────────────────────────────┐                    │ │
│  │  Lambda Cron (EventBridge — Monday 06 UTC) │                    │ │
│  │  Fetches FINRA ATS CSV → parse → S3        │                    │ │
│  └────────────────────────────────────────────┘                    │ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Flow

### 3.1 Trade Classification (MapReduce Step)

The classifier runs per-trade in the MapReduce drain loop before bucketing. Classification is a pure function with no external calls:

```go
type FlowClass int

const (
    Lit                FlowClass = iota
    DarkRetail                          // off-exchange, sub-penny tick
    DarkInstitutionalSmall              // off-exchange, penny tick, notional < $1M
    DarkInstitutionalMid                // off-exchange, penny tick, $1M–$10M
    DarkInstitutionalBlock              // off-exchange, penny tick, > $10M
)

func classifyTrade(t Trade) FlowClass {
    // Step 1: exchange code
    if t.Exchange != "D" && t.Exchange != "E" {
        return Lit
    }

    // Step 2: sub-penny tick filter
    fractionalCent := math.Mod(t.Price*100, 1.0)
    if fractionalCent > 0.001 && fractionalCent < 0.999 {
        return DarkRetail
    }

    // Step 3: notional size tier
    notional := t.Price * float64(t.Size)
    switch {
    case notional >= 10_000_000:
        return DarkInstitutionalBlock
    case notional >= 1_000_000:
        return DarkInstitutionalMid
    default:
        return DarkInstitutionalSmall
    }
}
```

### 3.2 Bucket Schema and Adaptive Resolution

Buckets are sub-minute to make the Virtual Clock replay feel fluid. The bucket size is selected at request time based on the requested window, keeping the total bucket count — and therefore chunk sizes and payload — manageable regardless of session length:

| Window | Bucket size | Buckets per hour | Buckets per max window |
|---|---|---|---|
| ≤ 2 hours | 0.5 seconds | 7,200 | 14,400 |
| 2–4 hours | 1 second | 3,600 | 14,400 |
| 4–8 hours | 5 seconds | 720 | 23,040 |

The bucket size is determined once at the start of the Lambda invocation and held constant for all tickers in the request. It is included in the cache key (see section 3.4) so different window lengths never share cache entries.

Each bucket carries five volume fields. The frontend consumes all five; the treemap coloring and tendency score use only the institutional fields.

```go
type Bucket struct {
    Epoch          int64  `json:"t"`    // Unix timestamp, start of bucket (milliseconds)
    BucketMs       int64  `json:"bms"` // bucket duration in milliseconds (500, 1000, or 5000)
    LitVol         int64  `json:"lv"`  // lit exchange volume
    DarkRetailVol  int64  `json:"drv"` // retail internalization volume
    DarkInstVol    int64  `json:"div"` // institutional dark (all tiers)
    DarkBlockVol   int64  `json:"dbv"` // block prints only (> $10M notional)
    DarkBlockCount int    `json:"dbc"` // number of block prints (for audit log)
}
```

`BucketMs` is included in every bucket so the frontend Virtual Clock can compute inter-bucket timing correctly without needing to know the global bucket size separately. `DarkInstVol` is the sum of `DarkInstitutionalSmall + Mid + Block`. `DarkBlockVol` is a subset of `DarkInstVol` surfaced separately for the audit log.

### 3.3 Tendency Score — Computation and Fallback Hierarchy

The FINRA ATS cron Lambda computes the 4-week trailing tendency score. The score is calculated as:

```
tendency_score = institutional_dark_vol / (lit_vol + institutional_dark_vol)
```

Retail internalization volume is excluded from the denominator. This makes the score a cleaner proxy for institutional off-exchange preference rather than a mixed signal polluted by PFOF flow.

#### Fallback hierarchy

The enrichment S3 lookup does not always return data. The Go Lambda applies the following resolution order per ticker before returning the payload. The `tendency_confidence` field is carried in the per-symbol metadata returned alongside `buckets[]` and is surfaced in the UI.

| Priority | Condition | Action | `tendency_confidence` |
|---|---|---|---|
| 1 | `finra-ats/latest.json` exists and ticker has ≥ 4 weekly entries | Use computed 4-week average | `"high"` |
| 2 | `finra-ats/latest.json` exists and ticker has 1–3 weekly entries | Use partial average; note week count | `"low"` |
| 3 | `finra-ats/latest.json` exists but ticker is absent | Ticker newly listed, illiquid, or below FINRA reporting threshold — use session-derived baseline (see below) | `"session_only"` |
| 4 | `finra-ats/latest.json` absent entirely (fresh deploy or cron failure) | Suppress tendency score for all tickers; disable deviation coloring | `"unavailable"` |

**Session-derived baseline (confidence `"session_only"`):** When no historical data exists for a ticker, the tendency score is computed from the current session itself — the institutional dark % at each clock tick is compared against the session mean up to that point rather than a historical baseline. This provides a within-session relative signal (e.g., "dark activity is spiking vs. the session average") without fabricating a historical benchmark. The detail card clearly labels this as intra-session only.

**`unavailable` behavior:** Treemap cells render in a neutral grey with no deviation coloring. The leaderboard still sorts by raw institutional dark % rather than deviation. The detail card shows the stacked sparkline and running totals normally but omits the tendency comparison row and displays a banner: *"Historical baseline unavailable — FINRA data not yet loaded."*

#### Cron failure detection

The cron Lambda writes a `finra-ats/meta.json` manifest on each successful run:

```json
{
  "last_updated": "2026-06-23T06:00:00Z",
  "weeks_available": 4,
  "ticker_count": 8742
}
```

The aggregator Lambda reads `meta.json` on startup. If `last_updated` is more than 10 days ago, it treats the data as stale and downgrades all tickers to `confidence: "low"` regardless of week count. This surfaces a visible warning in the UI rather than silently using outdated baselines.

### 3.4 Cache Design

Cache keys include the bucket size so requests with different window lengths — and therefore different bucket resolutions — never share a cache entry and return mismatched `BucketMs` values.

```
cache/{ticker_hash}/{date}/{bucket_ms}/{normalized_start}-{normalized_end}.json

# Examples:
# 2hr request  → cache/abc123/2026-06-28/500/1000-1200.json
# 6hr request  → cache/abc123/2026-06-28/5000/0900-1600.json
```

Cache resolution follows the same four-scenario logic as before (full hit → partial → staging → cold). The `bucket_ms` path component is derived from the requested window length at Lambda invocation time before the cache lookup — it never changes mid-request.

### 3.5 Data Availability Failure Modes

Every external dependency has a defined degraded behavior. The system must never silently produce misleading output — every failure mode either surfaces a UI signal or falls back to a weaker-but-honest alternative.

#### Alpaca API — no trades returned for a ticker

The SIP feed may return zero trades for a ticker in the requested window for several legitimate reasons: pre-market or post-market request, halted stock, newly listed ticker with no history, or the ticker simply didn't trade in that window. The Lambda distinguishes these cases:

| Condition | Detection | Response |
|---|---|---|
| Ticker not found / invalid | Alpaca returns 404 or empty with no pages | Return `{ "error": "ticker_not_found" }` for that symbol; other tickers in the batch continue normally |
| Valid ticker, zero trades in window | Empty page set returned | Return symbol with empty `buckets[]` and `{ "warn": "no_trades_in_window" }`; frontend renders cell as empty with tooltip |
| Trading halt | Zero trades + halt condition detectable via Alpaca corporate actions endpoint | Not currently checked; treated same as zero trades; future work |
| Alpaca API timeout (>30s) | SDK context deadline exceeded | Return partial results for completed tickers; mark timed-out tickers with `{ "error": "fetch_timeout" }` |
| Alpaca rate limit hit (429) | Token bucket exhausted | Exponential backoff up to 3 retries within Lambda timeout; if unresolved, return partial with `{ "warn": "rate_limited", "buckets_complete": false }` |
| Alpaca API down (5xx) | Non-retriable HTTP error | Return `{ "error": "upstream_unavailable" }` for affected tickers; logged to CloudWatch |

In all partial-failure cases, successfully fetched tickers are returned and replayed normally. The frontend renders failed tickers with a strikethrough label and error tooltip rather than dropping them from the treemap silently.

#### S3 — cache read/write failures

| Condition | Detection | Response |
|---|---|---|
| S3 GetObject 404 (no cache) | AWS SDK `NoSuchKey` error | Expected — treat as cold request, proceed to Alpaca fetch |
| S3 GetObject failure (non-404) | AWS SDK error (network, IAM, etc.) | Log to CloudWatch; treat as cold request; do not fail the entire Lambda |
| S3 PutObject failure (staging write) | AWS SDK error | Log and continue; incremental polling will simply return empty until a retry succeeds; cache miss on next request is acceptable |
| Staging file corrupted / unparseable | JSON unmarshal error | Treat as cold request; overwrite staging with fresh fetch |
| Cache entry chunk exceeds 5.5MB | Payload guard triggered | Truncate buckets array to fit; add `{ "warn": "truncated", "truncated_at": "<epoch>" }` to response; frontend displays banner |

#### FINRA ATS data — gaps and staleness

Covered in full in section 3.3. Summary:

| Condition | `tendency_confidence` | UI Behavior |
|---|---|---|
| 4 weeks of data present | `"high"` | Full deviation coloring |
| 1–3 weeks of data | `"low"` | Deviation coloring shown; badge indicates partial history |
| Ticker absent from FINRA data | `"session_only"` | Intra-session baseline used; labeled in detail card |
| `latest.json` absent or >10 days stale | `"unavailable"` | Deviation coloring suppressed; neutral grey; banner shown |

#### Lambda — timeout with incomplete data

The Lambda has a 5-minute hard timeout. For large windows (8 hours, 5 tickers), the full fetch may not complete. The incremental polling design handles this naturally: whatever buckets were written to `staging.json` before timeout are returned on the next poll with `{ "status": "partial" }`. The Lambda does not resume — the client receives what was written and the remainder is absent.

The frontend detects a stalled poll (no `next_token` change after 3 consecutive polls beyond the expected window duration) and displays: *"Data collection timed out — showing partial session."* The Virtual Clock plays through the available buckets and stops rather than looping.

#### Input validation failures (API Gateway)

API Gateway rejects requests before Lambda invocation:

| Validation | Rule | HTTP Response |
|---|---|---|
| Ticker count | Max 5 symbols | 400 `{ "error": "too_many_tickers" }` |
| Ticker format | Regex `^[A-Z]{1,5}$` per symbol | 400 `{ "error": "invalid_ticker_format" }` |
| Hours range | Integer 1–8 inclusive | 400 `{ "error": "invalid_hours" }` |
| Missing params | `tickers` or `hours` absent | 400 `{ "error": "missing_params" }` |

The frontend pre-validates the same rules client-side before firing the request, so API Gateway rejections should only occur from direct API abuse or bugs.

### 3.6 Incremental Response Strategy

The Lambda returns the first 30 seconds of session data immediately (~1–2s), getting the treemap rendering before the full fetch completes. Subsequent chunks grow exponentially in session-time coverage — early chunks are small so first paint is fast; later chunks are large because the user is already mid-replay and latency matters less.

Chunk sizes below are in session time covered, not wall-clock poll time. Bucket count per chunk depends on the active bucket size (see section 3.2).

| Poll # | Delay | Session time covered | Buckets (0.5s) | Buckets (1s) | Buckets (5s) |
|---|---|---|---|---|---|
| 1 (initial) | — | 0–30s | 60 | 30 | 6 |
| 2 | ~2s | 30s–2min | 180 | 90 | 18 |
| 3 | ~4s | 2–6min | 480 | 240 | 48 |
| 4 | ~8s | 6–14min | 960 | 480 | 96 |
| 5 | ~16s | 14–30min | 1,920 | 960 | 192 |
| 6 | ~30s | 30min–1hr | 3,600 | 1,800 | 360 |
| 7+ | ~30s (max) | Remaining | remainder | remainder | remainder |

Poll delay caps at 30s. Each chunk response carries `{ "status": "partial", "next_token": "N" }` or `{ "status": "complete" }`. The Virtual Clock appends incoming buckets to its immutable ref and continues playback seamlessly — no pause or stutter at chunk boundaries.

### 3.7 Full Request Path

```
1. User selects tickers + window → React fires GET /api/replay

2. Lambda determines bucket size from requested window:
   ≤2hr → 500ms | 2–4hr → 1000ms | 4–8hr → 5000ms

3. Lambda builds normalized cache key from ticker hash + date +
   bucket_ms + hour-aligned window

4. S3 cache check:
   a) final.json exists AND covers request → slice buckets, return
   b) staging.json exists → return what's available + next_token
   c) nothing exists → begin fetch

5. SDK GetMultiTradesAsync drains to channel in background.
   MapReduce pipeline classifies (exchange code → sub-penny tick
   filter → notional tier) and buckets trades into sub-minute
   buckets as they arrive.

6. Once first 30 seconds of buckets are complete → write to
   staging.json → return { status: "partial", next_token: "1",
   buckets: [...60 buckets at 0.5s] }

7. Client starts playback with initial buckets.
   Polls GET /api/replay?token=1 at 2s, 4s, 8s, ...30s intervals.

8. Lambda reads staging.json, returns exponentially growing
   session-time chunks. Each poll returns
   { status: "partial", next_token: "N" } or { status: "complete" }.

9. On completion: staging.json → final.json (S3 copy/rename).
   Subsequent requests for this window → instant cache hit.
```

---

## 4. Key Architectural Decisions

### 4.1 Three-Way Flow Classification

The naive lit/dark binary conflates two fundamentally different off-exchange populations:

- **Retail internalization** (~17% of total equity volume): PFOF-driven, executed by Citadel/Virtu/Susquehanna at sub-penny improvement. No informational content about institutional positioning.
- **Institutional dark pool prints** (~20–25% of total equity volume): Block trades and algorithm-driven large orders executed in ATSs to minimize market impact.

The sub-penny tick filter cleanly separates these populations at the trade level using data already present in the SIP feed, at zero additional cost. No new data sources or API calls required.

| Heuristic | Precision | Basis |
|---|---|---|
| Exchange code `D`/`E` | Definitive | FINRA TRF rules |
| Sub-penny tick filter | High (known FPs: some peg orders) | FINRA best-execution rules; BJZZ (2021) |
| Notional size tier | Indicative | SEC Rule 10b-18; industry convention |

### 4.2 Virtual Clock vs. WebSocket

| | WebSocket Backend | Virtual Clock (this design) |
|---|---|---|
| Infrastructure | Persistent server (paid) | Serverless (free) |
| Scaling | Connection pooling required | Stateless, auto-scales |
| Reliability | Drops + reconnect state recovery | No connection to drop |
| Complexity | High | Low |
| Visual result | Real-time | Equivalent (replay) |

For a 15-min delayed feed, WebSocket carries already-stale data. Virtual Clock achieves identical visual output at zero hosting cost.

### 4.3 Go on Lambda

Go's fast cold start (~100ms), low memory footprint (~20MB idle), and native goroutine concurrency make it the optimal choice for processing millions of trade records across multiple tickers within Lambda's constraints. Node.js (~300ms cold start, single-threaded event loop) and Python (GIL-limited) are worse fits for this workload.

### 4.4 S3 Cache + Incremental Polling

S3 free tier (5GB, 20K GETs/month) is sufficient. Cache keys are normalized to hour boundaries so overlapping time ranges from different users hit the same cache entry. The staging path (`.../staging.json`) prevents redundant Alpaca fetches: if two users request the same tickers near-simultaneously, the second finds existing staging, reads whatever is available, and avoids an API call.

Cache hits return in sub-100ms. The staging + incremental polling strategy reduces first-frame latency from ~30s to ~1–2s on cold requests.

### 4.5 Frontend Visualization

Two viewing modes:

**Treemap (default):** Canvas-rendered, GPU-accelerated. Each symbol is a cell sized by total volume, colored by *institutional* dark pool % deviation from its 4-week tendency score (retail internalization excluded from both numerator and denominator). Smooth 200ms transitions between clock ticks via `requestAnimationFrame` interpolation.

**Leaderboard:** Sortable list ranked by current institutional dark pool ratio deviation. Surfaces unusual block activity immediately without noise from PFOF flow.

Clicking any symbol opens a detail card showing:
- Stacked sparkline: lit (grey) / retail internalized (blue) / institutional dark (amber) / block prints (red) over the session
- Running totals for all four flow categories
- FINRA institutional tendency score vs. session ratio
- Audit log of block prints (`DarkBlockVol > $10M`) with timestamp, notional, and size

---

## 5. Infrastructure

| Component | Service | Free Tier |
|---|---|---|
| Frontend | Netlify (global CDN) | Unlimited static |
| API routing | AWS API Gateway (HTTP API) | 1M req/month |
| Aggregation | AWS Lambda (Go, 512MB, 5min) | 1M req + 400K GB-sec/month |
| Cache + storage | AWS S3 | 5GB, 20K GETs/month |
| FINRA ingestion | AWS Lambda (EventBridge cron) | Included above |
| Data source | Alpaca Markets SIP delayed | Free with account |
| IaC | Terraform (state in S3) | Free |

**Estimated monthly cost at low traffic: $0.**

### Security

- Alpaca credentials: Lambda environment variables only, never committed
- CORS: locked to Netlify production domain; localhost permitted in dev via env var
- IAM: Lambda role has `s3:GetObject` + `s3:PutObject` on cache path only
- API Gateway validates `tickers` (max 5, regex) and `hours` (1–8) before invoking Lambda

---

## 6. Known Constraints

### Infrastructure limits

| Constraint | Limit | Mitigation |
|---|---|---|
| API Gateway response | 10MB (not binding) | — |
| Lambda response payload | 6MB hard limit (binding constraint) | Per-chunk payload guard at 5.5MB; truncate + `warn: "truncated"` header |
| Lambda timeout | 5 min | Incremental polling returns partial data; frontend detects stall and displays banner; 5s buckets used for 4–8hr windows to keep bucket counts manageable |
| Alpaca rate limit | 200 req/min | Token bucket across goroutines; up to 3 retries with backoff |
| SIP feed delay | 15 min | Irrelevant for replay model |
| S3 PUT limit | 2,000/month free | Cache stores normalized unique windows only |
| S3 GET limit | 20,000/month free | Cache hit ratio reduces effective GETs; monitoring via CloudWatch |

### Classification accuracy

| Constraint | Impact | Mitigation |
|---|---|---|
| Sub-penny filter false positives | ~1–5% of institutional peg orders classified as `dark_retail` | Acceptable for visualization; noted in UI tooltip; MPID-level resolution is future work |
| Notional tier thresholds are heuristic | Smaller hedge funds / family offices overlap with `dark_inst_small` | Tiers are labeled indicative, not definitive; thresholds documented in UI |
| MPID-level venue identification | Not available in free SIP tier | Would allow exact wholesaler identification (Citadel, Virtu, etc.); future work |
| Buy/sell direction | Dark pool data is post-trade; side not reported on SIP | Directional heuristic (print vs. VWAP) used in audit log; labeled as estimated |

### Data availability

| Condition | Affected Feature | Behavior |
|---|---|---|
| Ticker has no FINRA ATS history | Tendency score | Session-derived baseline used; `confidence: "session_only"` shown in detail card |
| Ticker has < 4 weeks FINRA history | Tendency score | Partial average used; week count shown; `confidence: "low"` badge |
| `finra-ats/latest.json` absent | Tendency score (all tickers) | Deviation coloring suppressed; neutral grey treemap; banner displayed |
| FINRA data stale (>10 days) | Tendency score reliability | All tickers downgraded to `confidence: "low"`; staleness warning shown |
| Ticker returns zero trades | Treemap cell | Cell rendered empty with tooltip: "No trades in window" |
| Ticker not found on Alpaca | Treemap cell | Cell rendered with strikethrough label and `error: "ticker_not_found"` tooltip |
| Alpaca API timeout | Partial session | Completed tickers replay normally; timed-out tickers marked with error tooltip |
| Lambda timeout before full fetch | Session completeness | Virtual Clock plays available buckets and stops; "partial session" banner shown |
| S3 cache write failure | Cache miss on next request | Request re-fetches from Alpaca; logged to CloudWatch; no user-visible error |
| Corrupted staging file | Current request | Treated as cold request; staging overwritten; adds ~1–2s latency |

---

*Architecture version 3.3 — June 2026*

# TRF Flow Terminal

Serverless full-stack application that aggregates, classifies, and replays institutional equity trade data — contrasting lit-exchange volume against off-exchange (dark pool / TRF) activity across multiple tickers simultaneously.

**Data pipeline:** Alpaca SIP (15-min delayed) → Go Lambda (fetch + classify + bucket) → React (Virtual Clock replay + treemap visualization)

---

## 1. System Overview

Fetches historical tick-level trade data from Alpaca's free-tier SIP consolidated tape feed. Classifies each trade as lit exchange or off-exchange TRF print (exchange codes `D`/`E` = dark pool). Aggregates into 1-minute volume buckets per symbol. Returns compressed JSON to a React frontend that replays via a synchronized Virtual Clock engine — no WebSocket needed.

The 15-minute SIP delay is irrelevant: the frontend replays data, not streams live. Users experience the session as a controllable replay at 1x, 5x, or 10x speed.

### Dark Pool Classification

Two-layer classifier using the `marketdata.Trade` struct (`Exchange`, `Conditions`, `Tape`). Layer 1: definitive TRF check via exchange code (`D` = FINRA ADF, `E` = Market Independent). Layer 2: condition code confidence scoring (CTS spec for Tape A/B, UTDF spec for Tape C). Combined output gives `IsDarkPool` + `ConfidenceScore` (0–3) per trade.

> **Limitation:** My current approach equates all TRF (dark pool) volume with institutional activity. This is naive — dark pools serve both institutions executing block trades and retail wholesalers internalizing order flow. Differentiating retail vs institutional dark volume is an open research problem. I plan to address this using order flow normalization and limit order book microstructure analysis. Relevant literature: [Briola et al. (2024) — Deep Limit Order Book Forecasting](https://arxiv.org/abs/2403.09267) connects a stock's microstructural properties to its predictability, providing a framework for classifying trade types based on LOB signatures. [Kang (2025) — Optimal Signal Extraction from Order Flow](https://arxiv.org/abs/2512.18648) shows that market-cap normalization acts as a matched filter for informed vs noise trader signals, achieving 1.3–1.9× higher correlation with returns than volume-based normalization. Both are promising directions for a more sophisticated classifier in a future iteration.

FINRA ATS weekly reports are ingested via cron Lambda and stored in S3. Each symbol is enriched with a **Dark Pool Tendency Score** — 4-week trailing average % off-exchange volume — providing historical context the real-time feed cannot give.

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
│  │  Single global timeline │    │  Colored by dark pool % dev.  │   │
│  └─────────────────────────┘    │  Leaderboard mode (deviation)  │   │
│                                 │                               │   │
│  ┌─────────────────────────┐    │  Detail card on click:        │   │
│  │   Incremental Polling   │    │  Sparkline, running total,    │   │
│  │                         │    │  notable prints audit log     │   │
│  │  GET /api/replay?token=X│    └───────────────────────────────┘   │
│  │  Exponential backoff    │                                         │
│  └─────────────────────────┘                                         │
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
│  3. MapReduce: drain channel, classify each trade, bucket by         │
│     (symbol, minute_epoch, lit|dark)                                 │
│                                                                      │
│  4. FINRA ATS enrichment via S3 lookup                               │
│                                                                      │
│  5. Write first minute to S3 staging → return { status:"partial"}    │
│     Client polls with exponential backoff for remaining chunks       │
│                                                                      │
│  6. On completion: promote staging → final cache entry               │
│                                                                      │
│  7. Payload guard: truncate at 9MB if over limit                     │
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

### 3.1 Cache Design

The Lambda uses the **AWS SDK for Go** (`github.com/aws/aws-sdk-go-v2/service/s3`) to talk to S3 over HTTPS. IAM policy grants `s3:GetObject` + `s3:PutObject` on the cache bucket only. The SDK auto-discovers credentials from the Lambda execution environment — no manual auth setup.

**Cache keys are normalized to hour boundaries** so overlapping requests share cache entries:

```
cache/{ticker_hash}/{date}/{normalized_start}-{normalized_end}.json

# Example:
# User requests 10:15–11:45 → normalized to 10:00–12:00
# User requests 10:30–11:30 → same normalized window → cache hit
# Key: cache/abc123/2026-06-28/1000-1200.json
```

A **staging path** is used for in-progress first-time requests:

```
cache/{ticker_hash}/{date}/{normalized_start}-{normalized_end}/
  staging.json     ← written incrementally during fetch
  final.json       ← promoted from staging on completion
```

**How cache resolution works — four scenarios:**

| Cache State | Action |
|---|---|
| Cache fully covers requested window | Read `final.json`, slice buckets array to match `[reqStart, reqEnd]`. Return immediately. The file stores `cached_start` and `cached_end` in metadata — slicing is a simple array range on the `buckets[]` field. Frontend gets exactly what it asked for. |
| Cache partially covers (e.g. cached 10:00–11:00, request 10:00–12:00) | Return cached portion immediately with `{ status: "partial", cached_until: "11:00", buckets: [...] }`. Lambda starts fetching the unfilled portion (11:00–12:00) from Alpaca. Client polls for remaining data after the cached range. |
| Staging exists (another request is already fetching) | Read whatever `staging.json` has. Return as partial. Client polls — Lambda checks staging on each poll, returns more data as it appears. No duplicate Alpaca fetch. |
| No cache, no staging (cold request) | Start full fetch from Alpaca. Write first minute bucket to `staging.json` → return partial. Subsequent polls drain more from staging as the pipeline progresses. On completion, rename staging → final. |

The frontend is unaware of these details. It receives `buckets[]` and optionally a `next_token` if more data is coming. The Virtual Clock plays whatever buckets it has — new buckets are appended to the immutable ref seamlessly.

### 3.2 Incremental Response Strategy

Instead of waiting for the full dataset (~30s for 2hr window), the Lambda returns the **first minute of bucketed data immediately** (~1–2s latency). The frontend starts replaying while remaining data is still being fetched.

The client polls with exponentially growing chunk sizes:

| Poll # | Chunk | Cumulative |
|---|---|---|
| 1 (initial response) | Minute 0–1 | 1 min |
| 2 (after ~2s) | Minutes 1–3 | 3 min |
| 3 (after ~4s) | Minutes 3–7 | 7 min |
| 4 (after ~8s) | Minutes 7–15 | 15 min |
| ... | Exponential doubling | ... |

This gets the user to **first frame in ~1–2s** instead of 30s, while the full dataset fills in progressively. The S3 cache stores the complete payload once available, so subsequent requests are instant.

### 3.3 Full Request Path

```
1. User selects tickers + window → React fires GET /api/replay

2. Lambda builds normalized cache key from ticker hash + date +
   hour-aligned window

3. S3 cache check:
   a) final.json exists AND covers request → slice buckets, return
   b) staging.json exists → return what's available + next_token
   c) nothing exists → begin fetch

4. SDK GetMultiTradesAsync drains to channel in background.
   MapReduce pipeline classifies and buckets trades as they arrive.

5. Once first minute bucket is complete → write to staging.json →
   return { status: "partial", next_token: "1", buckets: [...] }

6. Client starts playback with initial buckets.
   Polls GET /api/replay?token=1 at 2s, 4s, 8s, ... intervals.

7. Lambda reads staging.json, returns remaining chunks.
   On each poll, returns { status: "partial", next_token: "N" }
   or { status: "complete" } when all data is returned.

8. On completion: staging.json → final.json (S3 copy/rename).
   Subsequent requests for this window → instant cache hit.
```

---

## 4. Key Architectural Decisions

### 4.1 Virtual Clock vs. WebSocket

| | WebSocket Backend | Virtual Clock (this design) |
|---|---|---|
| Infrastructure | Persistent server (paid) | Serverless (free) |
| Scaling | Connection pooling required | Stateless, auto-scales |
| Reliability | Drops + reconnect state recovery | No connection to drop |
| Complexity | High | Low |
| Visual result | Real-time | Equivalent (replay) |

For a 15-min delayed feed, WebSocket carries already-stale data. Virtual Clock achieves identical visual output at zero hosting cost.

### 4.2 Go on Lambda

Go's fast cold start (~100ms), low memory footprint (~20MB idle), and native goroutine concurrency make it the optimal choice for processing millions of trade records across multiple tickers within Lambda's constraints. Node.js (~300ms cold start, single-threaded event loop) and Python (GIL-limited) are worse fits for this workload.

### 4.3 S3 Cache + Incremental Polling

S3 free tier (5GB, 20K GETs/month) is sufficient. Cache keys are normalized to hour boundaries so overlapping time ranges from different users hit the same cache entry. Each `final.json` stores `cached_start`/`cached_end` in its metadata — the Lambda slices the buckets array to match the exact requested window, so the frontend never sees extra data.

The staging path (`.../staging.json`) prevents redundant Alpaca fetches: if two users request the same tickers near-simultaneously, the second finds existing staging, reads whatever is available, and avoids an API call. Polling uses exponential backoff (2s → 4s → 8s → 16s, max 30s) to avoid hammering the cache.

Cache hits return in sub-100ms. The staging + incremental polling strategy reduces first-frame latency from ~30s to ~1–2s on cold requests.

### 4.4 Minute-Level Bucketing

Raw tick data for 3 tickers × 2 hours would be hundreds of MB. Aggregating to 1-minute buckets yields ~360 data points — renderable at 60fps on any device.

### 4.5 Frontend Visualization

Two viewing modes:

- **Treemap (default):** Canvas-rendered, GPU-accelerated. Each symbol is a cell sized by total volume, colored by dark pool % deviation from its 4-week tendency. Smooth 200ms transitions between clock ticks via `requestAnimationFrame` interpolation.
- **Leaderboard:** Sortable list ranked by current dark pool ratio deviation. Surfaces unusual activity immediately.

Clicking any symbol opens a detail card showing a sparkline of dark% over the session, running totals (lit vs dark), FINRA tendency score comparison, and an audit log of high-confidence institutional block prints.

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

| Constraint | Limit | Mitigation |
|---|---|---|
| API Gateway response | 10MB hard limit | Payload guard at 9MB; truncate + warning header |
| Lambda timeout | 5 min config | Incremental response returns partial data early |
| Alpaca rate limit | 200 req/min | Token bucket across goroutines |
| SIP feed delay | 15 min | Irrelevant for replay model |
| S3 PUT limit | 2,000/month free | Cache stores unique combos only |
| Dark pool classification | No retail vs institutional differentiation | Future work: microstructure-informed classifier per cited research |

---

*Architecture version 2.1 — June 2026*

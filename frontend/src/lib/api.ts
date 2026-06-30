interface Bucket {
  t: number
  bms: number
  lv: number
  drv: number
  div: number
  dbv: number
  dbc: number
}

interface SymbolResult {
  symbol: string
  buckets: Bucket[]
  error?: string
  warn?: string
}

interface ApiResponse {
  status: string
  symbols: SymbolResult[]
  next_offset?: number
  warn?: string
  truncated_at?: number
}

interface TickerResult {
  symbol: string
  name: string
  exchange: string
}

function getBaseUrl(): string {
  if (import.meta.env.DEV) {
    return ""
  }
  return import.meta.env.VITE_API_URL ?? ""
}

export async function fetchBuckets(
  tickers: string[],
  start: string,
  end: string,
  offset: number = 0
): Promise<ApiResponse> {
  const params = new URLSearchParams({
    tickers: tickers.join(","),
    start,
    end,
    offset: String(offset),
  })
  const res = await fetch(`${getBaseUrl()}/api/replay?${params}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json()
}

export async function searchTickersOnline(query: string): Promise<TickerResult[]> {
  if (!query || query.length < 1) return []
  const res = await fetch(`${getBaseUrl()}/api/search?q=${encodeURIComponent(query)}`)
  if (!res.ok) return []
  return res.json()
}

export type { Bucket, SymbolResult, ApiResponse, TickerResult }

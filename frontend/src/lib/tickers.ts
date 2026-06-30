export interface TickerInfo {
  symbol: string
  name: string
}

export const COMMON_TICKERS: TickerInfo[] = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "SPY", name: "SPDR S&P 500 ETF" },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "META", name: "Meta Platforms Inc." },
  { symbol: "GOOGL", name: "Alphabet Inc. (A)" },
  { symbol: "GOOG", name: "Alphabet Inc. (C)" },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "AVGO", name: "Broadcom Inc." },
  { symbol: "BRK.B", name: "Berkshire Hathaway (B)" },
  { symbol: "JPM", name: "JPMorgan Chase & Co." },
  { symbol: "LLY", name: "Eli Lilly & Co." },
  { symbol: "V", name: "Visa Inc." },
  { symbol: "XOM", name: "Exxon Mobil Corp." },
  { symbol: "UNH", name: "UnitedHealth Group Inc." },
  { symbol: "MA", name: "Mastercard Inc." },
  { symbol: "COST", name: "Costco Wholesale Corp." },
  { symbol: "PG", name: "Procter & Gamble Co." },
  { symbol: "JNJ", name: "Johnson & Johnson" },
  { symbol: "ORCL", name: "Oracle Corp." },
  { symbol: "HD", name: "The Home Depot Inc." },
  { symbol: "BAC", name: "Bank of America Corp." },
  { symbol: "WMT", name: "Walmart Inc." },
  { symbol: "NFLX", name: "Netflix Inc." },
  { symbol: "CRM", name: "Salesforce Inc." },
  { symbol: "CVX", name: "Chevron Corp." },
  { symbol: "AMD", name: "Advanced Micro Devices Inc." },
  { symbol: "KO", name: "The Coca-Cola Co." },
  { symbol: "MRK", name: "Merck & Co. Inc." },
  { symbol: "PEP", name: "PepsiCo Inc." },
  { symbol: "TMO", name: "Thermo Fisher Scientific Inc." },
  { symbol: "ABBV", name: "AbbVie Inc." },
  { symbol: "WFC", name: "Wells Fargo & Co." },
  { symbol: "DIS", name: "The Walt Disney Co." },
  { symbol: "CSCO", name: "Cisco Systems Inc." },
  { symbol: "MCD", name: "McDonald's Corp." },
  { symbol: "ADBE", name: "Adobe Inc." },
  { symbol: "CMCSA", name: "Comcast Corp." },
  { symbol: "QCOM", name: "Qualcomm Inc." },
  { symbol: "INTC", name: "Intel Corp." },
  { symbol: "IBM", name: "International Business Machines Corp." },
  { symbol: "PYPL", name: "PayPal Holdings Inc." },
  { symbol: "UBER", name: "Uber Technologies Inc." },
  { symbol: "AMAT", name: "Applied Materials Inc." },
  { symbol: "VZ", name: "Verizon Communications Inc." },
  { symbol: "TXN", name: "Texas Instruments Inc." },
  { symbol: "NKE", name: "NIKE Inc." },
  { symbol: "BA", name: "The Boeing Co." },
  { symbol: "GE", name: "General Electric Co." },
]

export function searchTickers(query: string): TickerInfo[] {
  const q = query.toLowerCase()
  if (!q) return COMMON_TICKERS.slice(0, 10)
  return COMMON_TICKERS.filter(
    (t) =>
      t.symbol.toLowerCase().startsWith(q) ||
      t.name.toLowerCase().includes(q)
  ).slice(0, 8)
}

import { useState } from "react"
import { ClockControls } from "@/components/ClockControls"
import { DetailCard } from "@/components/DetailCard"
import { Treemap } from "@/components/Treemap"
import { NarrativeBar } from "@/components/NarrativeBar"
import { TickerSearch } from "@/components/TickerSearch"
import { TimeRange } from "@/components/TimeRange"
import { AboutDialog } from "@/components/AboutDialog"
import { useReplay } from "@/hooks/useReplay"
import { Button } from "@/components/ui/button"
import { runningTotals } from "@/lib/totals"

const DEFAULT_TICKERS = ["AAPL", "NVDA", "SPCX"]
const DEFAULT_START = "2026-06-22T15:00:00Z"
const DEFAULT_END = "2026-06-22T16:00:00Z"

export function App() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS)
  const [start, setStart] = useState(DEFAULT_START)
  const [end, setEnd] = useState(DEFAULT_END)
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const [showLeaderboard, setShowLeaderboard] = useState(true)
  const [showTreemap, setShowTreemap] = useState(true)
  const [showAbout, setShowAbout] = useState(false)

  const { clock, symbols, loading, error, fetchError, truncated, play, pause, setSpeed } = useReplay({
    tickers,
    start,
    end,
  })

  return (
    <div className="flex flex-col min-h-svh">
      <header className="border-b px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1">
          <h1 className="text-sm font-medium shrink-0">TRF Flow Terminal</h1>
          <div className="flex-1 max-w-md">
            <TickerSearch selected={tickers} onChange={setTickers} />
          </div>
          <TimeRange start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e) }} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant={showLeaderboard ? "default" : "outline"}
            size="xs"
            onClick={() => setShowLeaderboard((v) => !v)}
          >
            Leaderboard
          </Button>
          <Button
            variant={showTreemap ? "default" : "outline"}
            size="xs"
            onClick={() => setShowTreemap((v) => !v)}
          >
            Treemap
          </Button>
          <Button
            variant="default"
            size="xs"
            className="bg-orange-600 hover:bg-orange-500"
            onClick={() => setShowAbout(true)}
          >
            About
          </Button>
        </div>
      </header>

      <NarrativeBar symbols={symbols} currentEpoch={clock.currentEpoch} />

      <ClockControls
        clock={clock}
        onPlay={play}
        onPause={pause}
        onSpeedChange={setSpeed}
      />

      <main className="flex-1 p-4">
        {loading && (
          <div className="text-sm text-muted-foreground">Loading data...</div>
        )}

        {error && symbols.length === 0 && (
          <div className="text-sm text-destructive">Error: {error}</div>
        )}

        {fetchError && symbols.length > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-600">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {fetchError} &mdash; retrying...
          </div>
        )}

        {truncated && (
          <div className="mb-2 flex items-center gap-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-600">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
            Data truncated due to payload size limit &mdash; showing partial session.
          </div>
        )}

        {!loading && !error && symbols.length === 0 && (
          <div className="text-sm text-muted-foreground">No data returned.</div>
        )}

        {symbols.length > 0 && (
          <div className="flex gap-4">
            {showTreemap && (
              <div className={showLeaderboard || selectedSymbol ? "flex-1" : "w-full"}>
                <Treemap
                  symbols={symbols}
                  currentEpoch={clock.currentEpoch}
                  onSelect={setSelectedSymbol}
                />
              </div>
            )}

            <div className="flex flex-col gap-4 shrink-0">
              {showLeaderboard && (
                <div className="w-80">
                  <div className="rounded-lg border">
                    <div className="grid grid-cols-5 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground border-b">
                      <span>Symbol</span>
                      <span className="text-right">Lit Vol</span>
                      <span className="text-right">Retail</span>
                      <span className="text-right">Inst. Dark</span>
                      <span className="text-right">Inst %</span>
                    </div>
                    {symbols.map((sym) => {
                      const total = runningTotals(sym.buckets, clock.currentEpoch)
                      const instPct = total.lit + total.inst > 0
                        ? ((total.inst / (total.lit + total.inst)) * 100).toFixed(1)
                        : "0.0"

                      return (
                        <button
                          key={sym.symbol}
                          data-symbol={sym.symbol}
                          className={`grid grid-cols-5 gap-2 px-3 py-1.5 text-xs w-full text-left hover:bg-muted/50 transition-colors ${
                            selectedSymbol === sym.symbol ? "bg-muted" : ""
                          }`}
                          onClick={() => setSelectedSymbol(
                            selectedSymbol === sym.symbol ? null : sym.symbol
                          )}
                        >
                          <span className={sym.error ? "line-through text-destructive" : "font-medium"}>
                            {sym.symbol}
                          </span>
                          <span className="text-right font-mono tabular-nums">
                            {total.lit.toLocaleString()}
                          </span>
                          <span className="text-right font-mono tabular-nums">
                            {total.retail.toLocaleString()}
                          </span>
                          <span className="text-right font-mono tabular-nums">
                            {total.inst.toLocaleString()}
                          </span>
                          <span className="text-right font-mono tabular-nums">
                            {instPct}%
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {selectedSymbol && (
                <div className="w-72">
                  <DetailCard
                    symbol={selectedSymbol}
                    buckets={symbols.find((s) => s.symbol === selectedSymbol)?.buckets ?? []}
                    currentEpoch={clock.currentEpoch}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="border-t px-4 py-1.5 text-xs text-muted-foreground flex items-center justify-between">
        <span>
          {clock.totalBuckets} buckets &middot; {clock.speed}x &middot;{" "}
          {clock.isPlaying ? "playing" : "paused"}
        </span>
        <span>
          {start} &ndash; {end}
        </span>
      </footer>

      <AboutDialog open={showAbout} onClose={() => setShowAbout(false)} />
    </div>
  )
}

export default App

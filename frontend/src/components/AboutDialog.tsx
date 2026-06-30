import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

interface AboutDialogProps {
  open: boolean
  onClose: () => void
}

export function AboutDialog({ open, onClose }: AboutDialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 mx-4 w-full max-w-lg rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">About TRF Flow Terminal</h2>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>

        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            TRF Flow Terminal is a tool for visualising where stock trades happen.
            When you buy or sell a stock, the trade can execute in one of several
            places — public exchanges like NYSE/Nasdaq, private "dark pool" venues,
            or it can be handled internally by a broker. This tool breaks down that
            mix for any stock and plays it back over time.
          </p>

          <div>
            <h3 className="mb-1 font-medium text-foreground">Three Trade Types</h3>
            <ul className="ml-4 list-disc space-y-1.5">
              <li>
                <span className="font-medium text-foreground">Lit</span> — Trades on
                public stock exchanges. Everyone can see them, just like orders on a
                public order book.
              </li>
              <li>
                <span className="font-medium text-foreground">Retail internalised</span>{" "}
                — When you place a trade through a retail broker (Robinhood, Schwab,
                etc.), the broker often routes it to a wholesaler who fills it at a
                slightly better price. These trades happen off-exchange and the price
                often includes fractions of a cent (e.g., $185.32<strong>14</strong>).
              </li>
              <li>
                <span className="font-medium text-foreground">Institutional dark</span>{" "}
                — Large investors (mutual funds, hedge funds) trade in private venues
                called dark pools to avoid moving the market price. These trades
                happen off-exchange at round cent prices.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-1 font-medium text-foreground">How the Classification Works</h3>
            <p className="mb-2">
              Every trade is classified in two steps. First, its exchange code
              tells us whether it went through a public exchange or off-exchange.
              If it was off-exchange, we check the price: fractional cents mean
              a retail internalised trade, round cents mean an institutional dark
              pool trade.
            </p>
          </div>

          <div>
            <h3 className="mb-1 font-medium text-foreground">How to Use It</h3>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                Search for stock tickers to add them to the session. The treemap
                shows each stock as a rectangle sized by trading volume, split
                into three coloured segments.
              </li>
              <li>
                Use the playback controls at the top to play, pause, or speed up
                the replay (1x / 5x / 10x). Data loads in the background as you
                watch.
              </li>
              <li>
                Hover over any rectangle to see detailed volume numbers. Click it
                to pin a detail card with running totals and the current slice of
                data.
              </li>
              <li>
                Toggle the Leaderboard for a sortable table or hide the treemap
                entirely if you prefer just the numbers.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-1 font-medium text-foreground">Data Pipeline</h3>
            <p className="text-xs">
              Alpaca market data feed (15-min delayed) → Go Lambda (fetch, classify,
              and bucket into 0.5-second intervals) → S3 cache → API Gateway →
              React frontend.
            </p>
          </div>

          <div className="border-t pt-3 text-xs text-muted-foreground">
            Built with Go &middot; React 19 &middot; Tailwind CSS 4 &middot; shadcn/ui
            &middot; AWS Lambda &middot; API Gateway &middot; S3 &middot; Terraform
          </div>
        </div>
      </div>
    </div>
  )
}

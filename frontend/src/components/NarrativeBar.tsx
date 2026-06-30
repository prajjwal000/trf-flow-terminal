import { runningTotals, type Accumulated } from "@/lib/totals"
import type { Bucket } from "@/lib/api"

interface NarrativeBarProps {
  symbols: { symbol: string; buckets: Bucket[] }[]
  currentEpoch: number
}

function sumAcross(accs: Accumulated[]): Accumulated {
  return accs.reduce(
    (a, b) => ({ lit: a.lit + b.lit, retail: a.retail + b.retail, inst: a.inst + b.inst, block: a.block + b.block, blockCount: a.blockCount + b.blockCount }),
    { lit: 0, retail: 0, inst: 0, block: 0, blockCount: 0 }
  )
}

export function NarrativeBar({ symbols, currentEpoch }: NarrativeBarProps) {
  const totals = sumAcross(
    symbols.map((s) =>
      currentEpoch > 0
        ? runningTotals(s.buckets, currentEpoch)
        : s.buckets.reduce(
            (a, b) => ({ lit: a.lit + b.lv, retail: a.retail + b.drv, inst: a.inst + b.div, block: a.block + b.dbv, blockCount: a.blockCount + b.dbc }),
            { lit: 0, retail: 0, inst: 0, block: 0, blockCount: 0 }
          )
    )
  )

  const total = totals.lit + totals.retail + totals.inst
  const litPct = total > 0 ? (totals.lit / total) * 100 : 0
  const retailPct = total > 0 ? (totals.retail / total) * 100 : 0
  const instPct = total > 0 ? (totals.inst / total) * 100 : 0

  return (
    <div className="border-b bg-card px-4 py-2.5">
      <div className="flex items-center gap-6">
        <div className="text-center min-w-[100px]">
          <div className="text-2xl font-bold tabular-nums tracking-tight">
            {instPct.toFixed(1)}<span className="text-base font-normal">%</span>
          </div>
          <div className="text-[11px] text-muted-foreground uppercase tracking-wider">
            Institutional Dark
          </div>
        </div>

        <div className="flex-1 flex flex-col gap-1">
          <div className="flex h-5 rounded-full overflow-hidden border">
            <div
              className="bg-blue-500 transition-all duration-300"
              style={{ width: `${litPct}%` }}
              title={`Lit: ${litPct.toFixed(1)}%`}
            />
            <div
              className="bg-amber-500 transition-all duration-300"
              style={{ width: `${retailPct}%` }}
              title={`Retail: ${retailPct.toFixed(1)}%`}
            />
            <div
              className="bg-red-500 transition-all duration-300"
              style={{ width: `${instPct}%` }}
              title={`Institutional Dark: ${instPct.toFixed(1)}%`}
            />
          </div>
          <div className="flex text-[11px] text-muted-foreground">
            <span className="flex-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-500 align-middle mr-1" />
              Lit {litPct.toFixed(1)}%
            </span>
            <span className="flex-1 text-center">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 align-middle mr-1" />
              Retail {retailPct.toFixed(1)}%
            </span>
            <span className="flex-1 text-right">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 align-middle mr-1" />
              Inst. Dark {instPct.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
          <div>Vol: {total.toLocaleString()}</div>
          {totals.blockCount > 0 && (
            <div className="text-amber-500">
              {totals.blockCount} blocks ({totals.block.toLocaleString()} sh)
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

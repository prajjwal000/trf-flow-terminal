import { type Bucket } from "@/lib/api"
import { runningTotals } from "@/lib/totals"

interface DetailCardProps {
  symbol: string
  buckets: Bucket[]
  currentEpoch: number
}

function currentBucket(buckets: Bucket[], epoch: number): Bucket | undefined {
  return buckets.find((b) => b.t === epoch)
}

export function DetailCard({ symbol, buckets, currentEpoch }: DetailCardProps) {
  const totals = runningTotals(buckets, currentEpoch)
  const cb = currentBucket(buckets, currentEpoch)
  const totalVol = totals.lit + totals.retail + totals.inst
  const litPct = totalVol > 0 ? (totals.lit / totalVol) * 100 : 0
  const retailPct = totalVol > 0 ? (totals.retail / totalVol) * 100 : 0
  const instPct = totalVol > 0 ? (totals.inst / totalVol) * 100 : 0

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="px-3 py-2 border-b">
        <h3 className="font-semibold text-sm">{symbol}</h3>
      </div>

      <div className="p-3 space-y-3">
        <div>
          <div className="flex h-2 rounded-full overflow-hidden border">
            <div className="bg-blue-500 transition-all" style={{ width: `${litPct}%` }} />
            <div className="bg-amber-500 transition-all" style={{ width: `${retailPct}%` }} />
            <div className="bg-red-500 transition-all" style={{ width: `${instPct}%` }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
            <span>Lit {litPct.toFixed(0)}%</span>
            <span>Retail {retailPct.toFixed(0)}%</span>
            <span>Dark {instPct.toFixed(0)}%</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <MetricRow label="Lit Vol" value={totals.lit.toLocaleString()} color="text-blue-500" />
          <MetricRow label="Retail" value={totals.retail.toLocaleString()} color="text-amber-500" />
          <MetricRow label="Inst. Dark" value={totals.inst.toLocaleString()} color="text-red-500" />
          <MetricRow label="Dark %" value={`${instPct.toFixed(1)}%`} color="" />
        </div>

        {totals.blockCount > 0 && (
          <div className="border-t pt-2 text-xs">
            <div className="text-amber-500 font-medium mb-1">Block Trades</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              <MetricRow label="Count" value={String(totals.blockCount)} color="text-amber-500" />
              <MetricRow label="Volume" value={totals.block.toLocaleString()} color="text-amber-500" />
            </div>
          </div>
        )}
      </div>

      {cb && (
        <div className="border-t bg-muted/30 px-3 py-2">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Current Bucket</div>
          <div className="flex gap-3 text-xs">
            <span className="text-blue-500">{cb.lv.toLocaleString()} L</span>
            <span className="text-amber-500">{cb.drv.toLocaleString()} R</span>
            <span className="text-red-500">{cb.div.toLocaleString()} D</span>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${color || "text-foreground"}`}>{value}</span>
    </div>
  )
}

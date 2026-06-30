import { useRef, useEffect, useState } from "react"
import type { Bucket } from "@/lib/api"
import { runningTotals, type Accumulated } from "@/lib/totals"

interface TreemapItem {
  symbol: string
  value: number
  instPct: number
  litPct: number
  retailPct: number
  totals: Accumulated
}

interface LayoutCell {
  symbol: string
  x: number
  y: number
  w: number
  h: number
  instPct: number
  litPct: number
  retailPct: number
  totals: Accumulated
}

interface TreemapProps {
  symbols: { symbol: string; buckets: Bucket[] }[]
  currentEpoch: number
  onSelect?: (symbol: string) => void
}

const RETAIL_COLORS = [
  "#0077BB", "#EE7733", "#009988", "#DDCC77",
  "#33BBEE", "#AA3377", "#117733", "#CC8844",
  "#5599CC", "#88AA44",
]

function tint(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mix = (a: number) => Math.round(a + (0 - a) * t)
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`
}

function lighten(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mix = (a: number) => Math.round(a + (255 - a) * t)
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`
}

function totalVol(t: Accumulated): number {
  return t.lit + t.retail + t.inst
}

function pctDark(t: Accumulated): number {
  const total = t.lit + t.inst
  return total > 0 ? (t.inst / total) * 100 : 0
}

function pctOf(t: Accumulated, kind: keyof Accumulated): number {
  const total = t.lit + t.retail + t.inst
  return total > 0 ? ((t[kind] as number) / total) * 100 : 0
}

const ANIM_DURATION = 400

function lerpLayout(from: LayoutCell[], to: LayoutCell[], t: number): LayoutCell[] {
  const toMap = new Map(to.map((c) => [c.symbol, c]))
  const fromMap = new Map(from.map((c) => [c.symbol, c]))
  const result: LayoutCell[] = []

  for (const target of to) {
    const source = fromMap.get(target.symbol)
    if (source) {
      result.push({
        symbol: target.symbol,
        x: source.x + (target.x - source.x) * t,
        y: source.y + (target.y - source.y) * t,
        w: source.w + (target.w - source.w) * t,
        h: source.h + (target.h - source.h) * t,
        instPct: source.instPct + (target.instPct - source.instPct) * t,
        litPct: source.litPct + (target.litPct - source.litPct) * t,
        retailPct: source.retailPct + (target.retailPct - source.retailPct) * t,
        totals: target.totals,
      })
    } else {
      result.push({
        ...target,
        w: target.w * t,
        h: target.h * t,
        x: target.x + (target.w * (1 - t)) / 2,
        y: target.y + (target.h * (1 - t)) / 2,
      })
    }
  }

  for (const source of from) {
    if (!toMap.has(source.symbol)) {
      result.push({
        ...source,
        w: source.w * (1 - t),
        h: source.h * (1 - t),
      })
    }
  }

  return result
}

function squarify(items: TreemapItem[], x: number, y: number, w: number, h: number): LayoutCell[] {
  if (items.length === 0 || w <= 0 || h <= 0) return []
  const total = items.reduce((s, i) => s + i.value, 0)
  if (total === 0) return []

  const sorted = [...items].sort((a, b) => b.value - a.value)
  const out: LayoutCell[] = []

  function worst(rs: number[], short: number): number {
    if (rs.length === 0) return Infinity
    const s = rs.reduce((a, b) => a + b, 0)
    const r = rs[0]
    return Math.max((short * short * r) / (s * s), (s * s) / (short * short * r))
  }

  function layoutRow(row: TreemapItem[], cx: number, cy: number, cw: number, ch: number, remain: number) {
    const rowSum = row.reduce((s, i) => s + i.value, 0)
    const frac = rowSum / remain
    if (cw >= ch) {
      const rw = cw * frac
      let yOff = cy
      for (const item of row) {
        const ih = ch * (item.value / rowSum)
        out.push({ symbol: item.symbol, x: cx, y: yOff, w: rw, h: ih, instPct: item.instPct, litPct: item.litPct, retailPct: item.retailPct, totals: item.totals })
        yOff += ih
      }
      return { nx: cx + rw, ny: cy, nw: cw - rw, nh: ch }
    } else {
      const rh = ch * frac
      let xOff = cx
      for (const item of row) {
        const iw = cw * (item.value / rowSum)
        out.push({ symbol: item.symbol, x: xOff, y: cy, w: iw, h: rh, instPct: item.instPct, litPct: item.litPct, retailPct: item.retailPct, totals: item.totals })
        xOff += iw
      }
      return { nx: cx, ny: cy + rh, nw: cw, nh: ch - rh }
    }
  }

  function slice(items: TreemapItem[], cx: number, cy: number, cw: number, ch: number, remain: number) {
    if (items.length === 0 || cw <= 0 || ch <= 0 || remain <= 0) return
    if (items.length === 1) {
      out.push({ symbol: items[0].symbol, x: cx, y: cy, w: cw, h: ch, instPct: items[0].instPct, litPct: items[0].litPct, retailPct: items[0].retailPct, totals: items[0].totals })
      return
    }
    const short = Math.min(cw, ch)
    const row: TreemapItem[] = [items[0]]
    let i = 1
    while (i < items.length) {
      const next = [...row, items[i]]
      if (worst(next.map((v) => v.value), short) <= worst(row.map((v) => v.value), short)) {
        row.push(items[i])
        i++
      } else break
    }
    const { nx, ny, nw, nh } = layoutRow(row, cx, cy, cw, ch, remain)
    const rowSum = row.reduce((s, i) => s + i.value, 0)
    slice(items.slice(i), nx, ny, nw, nh, remain - rowSum)
  }

  slice(sorted, x, y, w, h, total)
  return out
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  cells: LayoutCell[],
  w: number,
  h: number,
  hovered: LayoutCell | null,
) {
  ctx.clearRect(0, 0, w, h)

  if (cells.length === 0) {
    ctx.fillStyle = "#666"
    ctx.font = "14px sans-serif"
    ctx.textAlign = "center"
    ctx.textBaseline = "middle"
    ctx.fillText("No data", w / 2, h / 2)
    return
  }

  for (let ci = 0; ci < cells.length; ci++) {
    const cell = cells[ci]
    const { x, y, w: cw, h: ch } = cell
    const gap = 1.5
    const ix = x + gap
    const iy = y + gap
    const iw = cw - gap * 2
    const ih = ch - gap * 2

    if (iw <= 0 || ih <= 0) continue

    const retailColor = RETAIL_COLORS[ci % RETAIL_COLORS.length]
    const instColor = tint(retailColor, 0.55)
    const litColor = lighten(retailColor, 0.55)

    const litW = iw * (cell.litPct / 100)
    const instW = iw * (cell.instPct / 100)
    const retailW = iw - litW - instW

    if (litW > 1) {
      ctx.fillStyle = litColor
      ctx.fillRect(ix, iy, litW, ih)
    }

    if (retailW > 1) {
      ctx.fillStyle = retailColor
      ctx.fillRect(ix + litW, iy, retailW, ih)
    }

    if (instW > 1) {
      ctx.fillStyle = instColor
      ctx.fillRect(ix + iw - instW, iy, instW, ih)
    }

    if (iw > 50 && ih > 35) {
      ctx.fillStyle = "rgba(0,0,0,0.55)"
      const labelH = Math.min(ih * 0.55, 48)
      const labelY = iy + (ih - labelH) / 2
      ctx.fillRect(ix, labelY, iw, labelH)
    }

    if (iw > 40 && ih > 28) {
      ctx.fillStyle = "#fff"
      ctx.font = `bold ${Math.min(15, iw / 6, ih / 3.5)}px sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      const cy = iy + ih / 2 - 8
      ctx.fillText(cell.symbol, ix + iw / 2, cy)

      ctx.font = `${Math.min(11, iw / 8, ih / 5)}px sans-serif`
      ctx.fillStyle = "rgba(255,255,255,0.7)"
      ctx.fillText(`${cell.instPct.toFixed(0)}% dark`, ix + iw / 2, cy + 15)

      if (iw > 70 && ih > 45) {
        ctx.font = `${Math.min(10, iw / 9, ih / 5.5)}px sans-serif`
        ctx.fillStyle = "rgba(255,255,255,0.45)"
        ctx.fillText(cell.totals.inst.toLocaleString(), ix + iw / 2, cy + 27)
      }
    } else if (iw > 20 && ih > 14) {
      ctx.fillStyle = "#fff"
      ctx.font = `bold ${Math.min(10, iw / 5)}px sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(cell.symbol, ix + iw / 2, iy + ih / 2)
    }
  }

  if (hovered) {
    const { x, y, w: cw, h: ch } = hovered
    ctx.strokeStyle = "#fff"
    ctx.lineWidth = 2.5
    ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2)
  }
}

export function Treemap({ symbols, currentEpoch, onSelect }: TreemapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<LayoutCell | null>(null)
  const [hoverColor, setHoverColor] = useState("")
  const cellsRef = useRef<LayoutCell[]>([])
  const hoveredRef = useRef<LayoutCell | null>(null)
  const targetCellsRef = useRef<LayoutCell[]>([])

  const symbolsRef = useRef(symbols)
  const epochRef = useRef(currentEpoch)
  useEffect(() => {
    symbolsRef.current = symbols
    epochRef.current = currentEpoch
  }, [symbols, currentEpoch])

  const animStateRef = useRef({
    fromCells: [] as LayoutCell[],
    toCells: [] as LayoutCell[],
    startTime: 0,
  })
  const rafIdRef = useRef(0)
  const lastKeyRef = useRef("")

  useEffect(() => {
    const canvas = canvasRef.current
    const el = containerRef.current
    if (!canvas || !el) return

    const dpr = window.devicePixelRatio || 1
    let w = el.clientWidth
    let h = el.clientHeight

    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    function computeTarget(layoutW: number, layoutH: number): LayoutCell[] {
      const syms = symbolsRef.current
      const epoch = epochRef.current
      const items: TreemapItem[] = syms
        .map((s) => {
          const totals =
            epoch > 0
              ? runningTotals(s.buckets, epoch)
              : s.buckets.reduce(
                  (a, b) => ({ lit: a.lit + b.lv, retail: a.retail + b.drv, inst: a.inst + b.div, block: a.block + b.dbv, blockCount: a.blockCount + b.dbc }),
                  { lit: 0, retail: 0, inst: 0, block: 0, blockCount: 0 }
                )
          return {
            symbol: s.symbol,
            value: totalVol(totals),
            instPct: pctDark(totals),
            litPct: pctOf(totals, "lit"),
            retailPct: pctOf(totals, "retail"),
            totals,
          }
        })
        .filter((i) => i.value > 0)

      if (items.length === 0) return []
      const pad = 2
      return squarify(items, pad, pad, layoutW - pad * 2, layoutH - pad * 2)
    }

    function itemsKey(): string {
      const syms = symbolsRef.current
      const epoch = epochRef.current
      return `${epoch}|${syms.map((s) => `${s.symbol}:${s.buckets.length}`).join(",")}`
    }

    function frame(now: number) {
      const cw = el!.clientWidth
      const ch = el!.clientHeight
      if (cw !== w || ch !== h) {
        w = cw
        h = ch
        canvas!.width = w * dpr
        canvas!.height = h * dpr
        canvas!.style.width = `${w}px`
        canvas!.style.height = `${h}px`
        lastKeyRef.current = ""
      }

      const key = itemsKey()
      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key

        const target = computeTarget(w, h)
        targetCellsRef.current = target
        animStateRef.current.fromCells =
          cellsRef.current.length > 0 ? cellsRef.current : animStateRef.current.toCells
        animStateRef.current.toCells = target
        animStateRef.current.startTime = now
      }

      const { fromCells, toCells, startTime } = animStateRef.current
      const elapsed = now - startTime
      const t = Math.min(elapsed / ANIM_DURATION, 1)
      const eased = 1 - Math.pow(1 - t, 3)

      const animated = lerpLayout(fromCells, toCells, eased)
      cellsRef.current = animated

      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawCells(ctx!, animated, w, h, hoveredRef.current)
      ctx!.setTransform(1, 0, 0, 1, 0, 0)

      rafIdRef.current = requestAnimationFrame(frame)
    }

    rafIdRef.current = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  function handleMouse(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const found = cellsRef.current.find(
      (c) => mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h
    )
    if (found) {
      const target = targetCellsRef.current.find((c) => c.symbol === found.symbol) ?? found
      setHovered(target)
      const colorIdx = targetCellsRef.current.indexOf(target)
      setHoverColor(RETAIL_COLORS[colorIdx % RETAIL_COLORS.length] ?? "")
      hoveredRef.current = found
    } else {
      setHovered(null)
      setHoverColor("")
      hoveredRef.current = null
    }
    canvas.style.cursor = found ? "pointer" : "default"
  }

  function handleClick() {
    if (hovered && onSelect) {
      onSelect(hovered.symbol)
    }
  }

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[280px]">
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-lg"
        onMouseMove={handleMouse}
        onMouseLeave={() => {
          setHovered(null)
          hoveredRef.current = null
        }}
        onClick={handleClick}
      />
      {hovered && (
        <div className="absolute top-2 left-2 bg-background/95 border rounded px-2.5 py-1.5 text-xs pointer-events-none shadow-sm z-10">
          <div className="font-semibold text-sm">{hovered.symbol}</div>
          <div className="mt-1 space-y-0.5 text-muted-foreground">
            <div>Vol: {(hovered.totals.lit + hovered.totals.retail + hovered.totals.inst).toLocaleString()}</div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
              Lit: {hovered.totals.lit.toLocaleString()} ({hovered.litPct.toFixed(0)}%)
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: hoverColor || "#999" }} />
              Retail: {hovered.totals.retail.toLocaleString()} ({hovered.retailPct.toFixed(0)}%)
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-red-400" />
              Dark: {hovered.totals.inst.toLocaleString()} ({hovered.instPct.toFixed(0)}%)
            </div>
          </div>
          {hovered.totals.blockCount > 0 && (
            <div className="mt-1 text-amber-500">
              Blocks: {hovered.totals.blockCount} ({hovered.totals.block.toLocaleString()} sh)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef, useState, useCallback } from "react"
import { VirtualClock, type ClockSpeed, type ClockState } from "@/engine/clock"
import { fetchBuckets, type SymbolResult } from "@/lib/api"

interface UseReplayOptions {
  tickers: string[]
  start: string
  end: string
}

interface UseReplayReturn {
  clock: ClockState
  symbols: SymbolResult[]
  loading: boolean
  error: string | null
  fetchError: string | null
  truncated: boolean
  progress: number
  play: () => void
  pause: () => void
  setSpeed: (speed: ClockSpeed) => void
}

const POLL_DELAYS = [5000, 10000, 20000, 30000]
const MAX_POLLS = 10

export function useReplay({ tickers, start, end }: UseReplayOptions): UseReplayReturn {
  const [symbols, setSymbols] = useState<SymbolResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [progress, setProgress] = useState(0)
  const [clock, setClock] = useState<ClockState>({
    currentEpoch: 0, currentIndex: 0, totalBuckets: 0,
    isPlaying: false, speed: 1, elapsedMs: 0, durationMs: 0,
  })
  const clockRef = useRef<VirtualClock | null>(null)
  const nextOffsetRef = useRef(0)
  const fetchingRef = useRef(false)
  const hasDataRef = useRef(false)
  const pollCountRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    nextOffsetRef.current = 0
    pollCountRef.current = 0
    fetchingRef.current = false
    hasDataRef.current = false
    setError(null)
    setFetchError(null)
    setTruncated(false)
    setProgress(0)
    setSymbols([])

    const vc = new VirtualClock([])
    clockRef.current = vc
    vc.subscribe((s) => setClock({ ...s }))

    async function fetchSlice() {
      if (cancelled) return
      if (nextOffsetRef.current < 0) return
      if (pollCountRef.current >= MAX_POLLS) return
      if (fetchingRef.current) return

      fetchingRef.current = true
      const reqOffset = nextOffsetRef.current
      try {
        const data = await fetchBuckets(tickers, start, end, reqOffset)
        if (cancelled) return

        nextOffsetRef.current = data.next_offset ?? -1
        setFetchError(null)

        if (data.warn === "truncated") {
          setTruncated(true)
        }

        if (data.symbols && data.symbols.length > 0) {
          hasDataRef.current = true
          setSymbols((prev) => mergeSymbols(prev, data.symbols))

          const newBuckets: { t: number; bms: number }[] = []
          for (const sym of data.symbols) {
            if (sym.buckets && !sym.error) {
              for (const b of sym.buckets) {
                newBuckets.push({ t: b.t, bms: b.bms })
              }
            }
          }

          vc.appendBuckets(newBuckets)
          const totalSec = (new Date(end).getTime() - new Date(start).getTime()) / 1000
          const chunkSec = Math.max(30, reqOffset * 2)
          const covered = reqOffset + chunkSec
          const pct = Math.min(100, Math.round((covered / totalSec) * 100))
          setProgress(pct)
        }

        setLoading(false)
        pollCountRef.current++
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load data"
          setFetchError(msg)
          if (!hasDataRef.current) {
            setError(msg)
            setLoading(false)
          }
        }
      }
      fetchingRef.current = false
    }

    fetchSlice()

    function scheduleNext() {
      if (cancelled || nextOffsetRef.current < 0) return

      const idx = Math.min(pollCountRef.current, POLL_DELAYS.length - 1)
      const delay = POLL_DELAYS[idx]

      setTimeout(() => {
        if (cancelled) return
        fetchSlice().then(() => scheduleNext())
      }, delay)
    }

    scheduleNext()

    return () => {
      cancelled = true
      vc.destroy()
    }
  }, [tickers.join(","), start, end])

  const play = useCallback(() => clockRef.current?.play(), [])
  const pause = useCallback(() => clockRef.current?.pause(), [])
  const setSpeedFn = useCallback((speed: ClockSpeed) => clockRef.current?.setSpeed(speed), [])

  return { clock, symbols, loading, error, fetchError, truncated, progress, play, pause, setSpeed: setSpeedFn }
}

function mergeSymbols(prev: SymbolResult[], next: SymbolResult[]): SymbolResult[] {
  const map = new Map<string, SymbolResult>()
  for (const s of prev) map.set(s.symbol, s)
  for (const s of next) {
    const existing = map.get(s.symbol)
    if (existing) {
      existing.buckets = [...existing.buckets, ...s.buckets]
        .sort((a, b) => a.t - b.t)
    } else {
      map.set(s.symbol, { ...s, buckets: [...s.buckets] })
    }
  }
  return Array.from(map.values())
}

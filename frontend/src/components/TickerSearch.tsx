import { useState, useRef, useEffect } from "react"
import { searchTickersOnline, type TickerResult } from "@/lib/api"
import { searchTickers as searchTickersLocal } from "@/lib/tickers"
import { X, Loader2 } from "lucide-react"

interface TickerSearchProps {
  selected: string[]
  onChange: (tickers: string[]) => void
}

export function TickerSearch({ selected, onChange }: TickerSearchProps) {
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<TickerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!query) {
      setResults([])
      return
    }
    setLoading(true)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      let res = await searchTickersOnline(query)
      if (res.length === 0) {
        const local = searchTickersLocal(query)
        res = local.map((t) => ({ symbol: t.symbol, name: t.name, exchange: "" }))
      }
      setResults(res.filter((t) => !selected.includes(t.symbol)))
      setLoading(false)
    }, 200)
    return () => clearTimeout(debounceRef.current)
  }, [query, selected])

  useEffect(() => {
    setHighlightIdx(0)
  }, [results])

  function select(sym: string) {
    const upper = sym.toUpperCase()
    if (!selected.includes(upper)) {
      onChange([...selected, upper])
    }
    setQuery("")
    setOpen(false)
    inputRef.current?.focus()
  }

  function remove(sym: string) {
    onChange(selected.filter((s) => s !== sym))
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlightIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlightIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (results[highlightIdx]) {
        select(results[highlightIdx].symbol)
      } else if (query) {
        select(query)
      }
    } else if (e.key === "Escape") {
      setOpen(false)
    } else if (e.key === "Backspace" && query === "" && selected.length > 0) {
      remove(selected[selected.length - 1])
    }
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 focus-within:ring-1 focus-within:ring-ring">
        {selected.map((sym) => (
          <span
            key={sym}
            className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
          >
            {sym}
            <button
              type="button"
              className="hover:text-destructive"
              onClick={() => remove(sym)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className="flex-1 min-w-[80px] bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground"
          placeholder={selected.length === 0 ? "Search tickers..." : "Add more..."}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value.toUpperCase())
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {loading && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
        )}
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-md border bg-popover shadow-md">
          {results.map((t, i) => (
            <button
              key={t.symbol}
              type="button"
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                i === highlightIdx ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseDown={() => select(t.symbol)}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              <span className="font-medium">{t.symbol}</span>
              <span className="text-xs text-muted-foreground flex-1 truncate">{t.name}</span>
              <span className="text-[10px] text-muted-foreground">{t.exchange}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

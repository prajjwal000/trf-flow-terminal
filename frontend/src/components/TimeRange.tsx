import { useRef, useEffect, useCallback } from "react"

interface TimeRangeProps {
  start: string
  end: string
  onChange: (start: string, end: string) => void
}

const PRESETS = [
  { label: "1h", hours: 1 },
  { label: "2h", hours: 2 },
  { label: "4h", hours: 4 },
  { label: "8h", hours: 8 },
]

function toLocalDatetimeValue(iso: string): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toISO(localValue: string): string {
  if (!localValue) return ""
  const d = new Date(localValue)
  return isNaN(d.getTime()) ? "" : d.toISOString()
}

function marketEnd(): string {
  const d = new Date()
  d.setUTCHours(16, 0, 0, 0)
  if (d > new Date()) {
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return d.toISOString()
}

export function TimeRange({ start, end, onChange }: TimeRangeProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const debouncedOnChange = useCallback(
    (s: string, e: string) => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (s && e) onChange(s, e)
      }, 400)
    },
    [onChange]
  )

  useEffect(() => {
    return () => clearTimeout(debounceRef.current)
  }, [])

  function applyPreset(hours: number) {
    clearTimeout(debounceRef.current)
    const baseEnd = end || marketEnd()
    const endDate = new Date(baseEnd)
    const startDate = new Date(endDate.getTime() - hours * 3600000)
    onChange(startDate.toISOString(), endDate.toISOString())
  }

  const isPresetActive = (hours: number) => {
    if (!start || !end) return false
    const endDate = new Date(end)
    const expectedStart = new Date(endDate.getTime() - hours * 3600000)
    return Math.abs(new Date(start).getTime() - expectedStart.getTime()) < 1000
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-0.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
              isPresetActive(p.hours)
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
            onClick={() => applyPreset(p.hours)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5">
        <input
          type="datetime-local"
          defaultValue={toLocalDatetimeValue(start)}
          key={start + end}
          onChange={(e) => {
            const newStart = toISO(e.target.value)
            if (newStart) debouncedOnChange(newStart, end)
          }}
          className="w-44 rounded border bg-background px-1.5 py-1 text-xs dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:ml-1"
        />
        <span className="text-xs text-muted-foreground">&ndash;</span>
        <input
          type="datetime-local"
          defaultValue={toLocalDatetimeValue(end)}
          key={start + end + 1}
          onChange={(e) => {
            const newEnd = toISO(e.target.value)
            if (newEnd) debouncedOnChange(start, newEnd)
          }}
          className="w-44 rounded border bg-background px-1.5 py-1 text-xs dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:ml-1"
        />
      </div>
    </div>
  )
}

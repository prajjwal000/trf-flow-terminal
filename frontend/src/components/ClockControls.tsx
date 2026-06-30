import { Button } from "@/components/ui/button"
import { type ClockState, type ClockSpeed } from "@/engine/clock"

interface ClockControlsProps {
  clock: ClockState
  onPlay: () => void
  onPause: () => void
  onSpeedChange: (speed: ClockSpeed) => void
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function ClockControls({ clock, onPlay, onPause, onSpeedChange }: ClockControlsProps) {
  const speeds: ClockSpeed[] = [1, 5, 10]
  const progress = clock.durationMs > 0 ? (clock.elapsedMs / clock.durationMs) * 100 : 0

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <Button
        variant="outline"
        size="sm"
        onClick={clock.isPlaying ? onPause : onPlay}
      >
        {clock.isPlaying ? "Pause" : "Play"}
      </Button>

      <div className="flex items-center gap-1">
        {speeds.map((s) => (
          <Button
            key={s}
            variant={clock.speed === s ? "default" : "outline"}
            size="xs"
            onClick={() => onSpeedChange(s)}
          >
            {s}x
          </Button>
        ))}
      </div>

      <div className="flex-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span>{formatMs(clock.elapsedMs)}</span>
        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-200 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span>{formatMs(clock.durationMs)}</span>
      </div>
    </div>
  )
}

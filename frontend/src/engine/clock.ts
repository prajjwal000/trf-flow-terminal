export type ClockSpeed = 1 | 5 | 10

export interface ClockState {
  currentEpoch: number
  currentIndex: number
  totalBuckets: number
  isPlaying: boolean
  speed: ClockSpeed
  elapsedMs: number
  durationMs: number
}

type Listener = (state: ClockState) => void

export class VirtualClock {
  private buckets: { t: number; bms: number }[]
  private _currentIndex = 0
  private _isPlaying = false
  private _speed: ClockSpeed = 1
  private lastFrameTime = 0
  private accumulatedTime = 0
  private rafId = 0
  private listeners = new Set<Listener>()

  constructor(buckets: { t: number; bms: number }[]) {
    this.buckets = buckets
  }

  get state(): ClockState {
    const totalBuckets = this.buckets.length
    const first = totalBuckets > 0 ? this.buckets[0].t : 0
    const last = totalBuckets > 0 ? this.buckets[totalBuckets - 1].t + this.buckets[totalBuckets - 1].bms : 0
    const current = totalBuckets > 0 ? this.buckets[this._currentIndex] : null
    return {
      currentEpoch: current?.t ?? 0,
      currentIndex: this._currentIndex,
      totalBuckets,
      isPlaying: this._isPlaying,
      speed: this._speed,
      elapsedMs: current ? current.t - first : 0,
      durationMs: last - first,
    }
  }

  private emit() {
    const state = this.state
    for (const fn of this.listeners) {
      fn(state)
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private tick = (now: number) => {
    if (!this._isPlaying || this.buckets.length === 0) {
      this.rafId = requestAnimationFrame(this.tick)
      return
    }

    if (this.lastFrameTime === 0) {
      this.lastFrameTime = now
    }

    const delta = now - this.lastFrameTime
    this.lastFrameTime = now
    this.accumulatedTime += delta * this._speed

    while (this.accumulatedTime >= this.buckets[this._currentIndex].bms) {
      const bms = this.buckets[this._currentIndex].bms
      if (bms <= 0) {
        this._currentIndex++
      } else {
        this.accumulatedTime -= bms
        this._currentIndex++
      }
      if (this._currentIndex >= this.buckets.length) {
        this._currentIndex = this.buckets.length - 1
        this._isPlaying = false
        break
      }
    }

    this.emit()
    this.rafId = requestAnimationFrame(this.tick)
  }

  play() {
    if (this._isPlaying) return
    this._isPlaying = true
    this.lastFrameTime = 0
    this.accumulatedTime = 0
    this.rafId = requestAnimationFrame(this.tick)
  }

  pause() {
    this._isPlaying = false
    cancelAnimationFrame(this.rafId)
  }

  setSpeed(speed: ClockSpeed) {
    this._speed = speed
  }

  seekTo(index: number) {
    this._currentIndex = Math.max(0, Math.min(index, this.buckets.length - 1))
    this.accumulatedTime = 0
    this.emit()
  }

  appendBuckets(newBuckets: { t: number; bms: number }[]) {
    const seen = new Set<number>(this.buckets.map((b) => b.t))
    for (const b of newBuckets) {
      if (!seen.has(b.t)) {
        this.buckets.push(b)
        seen.add(b.t)
      }
    }
    this.buckets.sort((a, b) => a.t - b.t)
    this.emit()
  }

  destroy() {
    cancelAnimationFrame(this.rafId)
    this.listeners.clear()
  }
}

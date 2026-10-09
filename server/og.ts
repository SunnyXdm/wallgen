// Server-side wallpaper rendering for link previews: the same renderer as the
// app (src/lib/wallpaper.ts), backed by @napi-rs/canvas (Skia, like Chrome).
import { createCanvas, DOMMatrix, type Canvas } from "@napi-rs/canvas"
import { isPortrait, type OutputSpec } from "../src/lib/output.ts"
import { renderPreview, renderWallpaper, setCanvasFactory } from "../src/lib/wallpaper.ts"
import type { WallpaperConfig } from "../src/lib/wallpaper.ts"

// wallpaper.ts reaches for document.createElement and the DOMMatrix global
setCanvasFactory(() => createCanvas(1, 1) as unknown as HTMLCanvasElement)
globalThis.DOMMatrix ??= DOMMatrix as unknown as typeof globalThis.DOMMatrix

/** Open Graph's recommended 1.91:1 card; fixed so nobody can ask for 8K renders */
export const OG_W = 1200
export const OG_H = 630

export type OgFormat = "png" | "jpg"

const JPEG_QUALITIES = [86, 78, 70, 60, 50]
const JPEG_BUDGET = 280 * 1024

export const MIME: Record<OgFormat, string> = { png: "image/png", jpg: "image/jpeg" }

/**
 * Portrait outputs compose differently from a wide card, so the card shows the
 * actual phone/tablet composition centered over a dimmed wide render of the
 * same look. Centered, it survives the square crops some apps apply.
 */
function drawPortraitCard(canvas: Canvas, cfg: WallpaperConfig, out: OutputSpec) {
  const ctx = canvas.getContext("2d")
  ctx.fillStyle = "rgba(0,0,0,0.55)"
  ctx.fillRect(0, 0, OG_W, OG_H)
  const ph = OG_H - 2 * 44
  const pw = Math.round((ph * out.w) / out.h)
  const panel = createCanvas(pw, ph)
  renderPreview(panel as unknown as HTMLCanvasElement, cfg, out.w, out.h, pw, ph)
  const x = Math.round((OG_W - pw) / 2)
  const r = Math.round(pw * 0.09)
  ctx.save()
  ctx.shadowColor = "rgba(0,0,0,0.6)"
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 12
  ctx.beginPath()
  ctx.roundRect(x, 44, pw, ph, r)
  ctx.fillStyle = cfg.bg
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, 44, pw, ph, r)
  ctx.clip()
  ctx.drawImage(panel, x, 44)
  ctx.restore()
  ctx.strokeStyle = "rgba(255,255,255,0.14)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x + 1, 45, pw - 2, ph - 2, r)
  ctx.stroke()
}

export async function renderOg(cfg: WallpaperConfig, format: OgFormat, output?: OutputSpec): Promise<Buffer> {
  const canvas = createCanvas(OG_W, OG_H)
  renderWallpaper(canvas as unknown as HTMLCanvasElement, cfg, OG_W, OG_H)
  if (output && isPortrait(output)) drawPortraitCard(canvas, cfg, output)
  // encode runs on libuv's pool, so only the (few ms) draw blocks the loop
  if (format === "png") return canvas.encode("png")
  // WhatsApp silently drops preview images much over ~300KB, and heavy grain
  // is close to noise for JPEG — step quality down until the card fits
  let jpg = await canvas.encode("jpeg", JPEG_QUALITIES[0])
  for (const q of JPEG_QUALITIES.slice(1)) {
    if (jpg.length <= JPEG_BUDGET) break
    jpg = await canvas.encode("jpeg", q)
  }
  return jpg
}

/** LRU bounded by entry count and total bytes (grainy PNGs are ~600KB each) */
export class LruCache {
  private map = new Map<string, Buffer>()
  private bytes = 0
  private maxEntries: number
  private maxBytes: number
  hits = 0
  misses = 0
  constructor(maxEntries: number, maxBytes: number) {
    this.maxEntries = maxEntries
    this.maxBytes = maxBytes
  }

  get(key: string): Buffer | undefined {
    const v = this.map.get(key)
    if (v) {
      this.map.delete(key)
      this.map.set(key, v)
      this.hits++
    } else {
      this.misses++
    }
    return v
  }

  set(key: string, value: Buffer) {
    const old = this.map.get(key)
    if (old) {
      this.bytes -= old.length
      this.map.delete(key)
    }
    this.map.set(key, value)
    this.bytes += value.length
    for (const [k, v] of this.map) {
      if (this.map.size <= this.maxEntries && this.bytes <= this.maxBytes) break
      this.map.delete(k)
      this.bytes -= v.length
    }
  }

  get size() {
    return this.map.size
  }
}

/** at most `limit` jobs at once, at most `maxQueue` waiting; beyond that, refuse */
export class Limiter {
  private active = 0
  private queue: (() => void)[] = []
  private limit: number
  private maxQueue: number
  constructor(limit: number, maxQueue: number) {
    this.limit = limit
    this.maxQueue = maxQueue
  }

  /** null = overloaded */
  async run<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxQueue) return null
      // a finishing job hands its slot straight over, so `active` already counts us
      await new Promise<void>((r) => this.queue.push(r))
    } else {
      this.active++
    }
    try {
      return await fn()
    } finally {
      const next = this.queue.shift()
      if (next) next()
      else this.active--
    }
  }
}

/** per-key token bucket: `burst` requests, refilling `perMinute` per minute */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>()
  private burst: number
  private perMinute: number
  constructor(burst: number, perMinute: number) {
    this.burst = burst
    this.perMinute = perMinute
  }

  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 60_000) * this.perMinute)
    b.at = now
    const ok = b.tokens >= 1
    if (ok) b.tokens -= 1
    this.buckets.set(key, b)
    return ok
  }

  /** drop buckets that have refilled completely */
  sweep(now = Date.now()) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + ((now - b.at) / 60_000) * this.perMinute >= this.burst) this.buckets.delete(k)
    }
  }
}

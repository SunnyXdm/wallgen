// Page-side scheduler for the render worker. One job runs at a time; each kind
// has one replaceable pending slot (latest request wins, superseded requests
// resolve null), and previews jump the queue ahead of full views and
// thumbnails. Without worker + OffscreenCanvas support the same jobs run on
// the main thread, still coalesced, so behavior matches with less headroom.
import {
  renderJob,
  type ExportRequest,
  type FullRequest,
  type PreviewRequest,
  type RenderResponse,
  type ThumbJob,
} from "./render-jobs"
import type { WallpaperConfig } from "./wallpaper"

/** a drawable result; close() releases its memory once drawn */
export interface Frame {
  image: CanvasImageSource
  width: number
  height: number
  close(): void
}

/** jobs are queued per channel; previews first, then full views, then the rest */
const RANK: Record<Payload["type"], number> = { preview: 0, full: 1, thumbs: 2 }

type Payload =
  | Omit<PreviewRequest, "id">
  | Omit<FullRequest, "id">
  | { type: "thumbs"; items: ThumbJob[] }

interface Job {
  payload: Payload
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

const makeWorker = () =>
  new Worker(new URL("./render.worker.ts", import.meta.url), { type: "module", name: "wallgen-render" })

const workerSupported = () =>
  typeof Worker !== "undefined" &&
  typeof OffscreenCanvas !== "undefined" &&
  "convertToBlob" in OffscreenCanvas.prototype &&
  "transferToImageBitmap" in OffscreenCanvas.prototype

const bitmapFrame = (b: ImageBitmap): Frame => ({
  image: b,
  width: b.width,
  height: b.height,
  close: () => b.close(),
})

const canvasFrame = (c: HTMLCanvasElement): Frame => ({
  image: c,
  width: c.width,
  height: c.height,
  close: () => {
    c.width = 0
    c.height = 0
  },
})

/** resolves once the worker has answered a ping, false if it can't render */
function startWorker(): Promise<Worker | null> {
  if (!workerSupported()) return Promise.resolve(null)
  return new Promise((resolve) => {
    let w: Worker
    try {
      w = makeWorker()
    } catch {
      resolve(null)
      return
    }
    const done = (ok: boolean) => {
      clearTimeout(timer)
      w.onmessage = null
      w.onerror = null
      if (!ok) w.terminate()
      resolve(ok ? w : null)
    }
    const timer = setTimeout(() => done(false), 4000)
    w.onmessage = (e: MessageEvent<RenderResponse>) => done(e.data.type === "pong" && e.data.ok)
    w.onerror = () => done(false)
    w.postMessage({ type: "ping" })
  })
}

class RenderClient {
  private worker: Promise<Worker | null>
  private slots = new Map<string, Job>()
  private running = false
  private nextId = 1
  /** true once we know rendering happens off the main thread */
  offThread = false

  constructor() {
    this.worker = startWorker().then((w) => {
      this.offThread = Boolean(w)
      return w
    })
  }

  preview(r: Omit<PreviewRequest, "id" | "type">, channel = "preview"): Promise<Frame | null> {
    return this.enqueue(channel, { type: "preview", ...r }) as Promise<Frame | null>
  }

  full(cfg: WallpaperConfig, w: number, h: number): Promise<Frame | null> {
    return this.enqueue("full", { type: "full", cfg, w, h }) as Promise<Frame | null>
  }

  thumbs(items: ThumbJob[], channel = "thumbs"): Promise<Map<string, Frame> | null> {
    return this.enqueue(channel, { type: "thumbs", items }) as Promise<Map<string, Frame> | null>
  }

  private enqueue(channel: string, payload: Payload) {
    return new Promise((resolve, reject) => {
      this.slots.get(channel)?.resolve(null) // superseded before it started
      this.slots.set(channel, { payload, resolve, reject })
      void this.pump()
    })
  }

  private async pump() {
    if (this.running) return
    let channel: string | null = null
    for (const [k, j] of this.slots)
      if (channel === null || RANK[j.payload.type] < RANK[this.slots.get(channel)!.payload.type]) channel = k
    if (channel === null) return
    const job = this.slots.get(channel)!
    this.slots.delete(channel)
    this.running = true
    try {
      const worker = await this.worker
      job.resolve(worker ? await this.runInWorker(worker, job.payload) : await this.runHere(job.payload))
    } catch (err) {
      job.reject(err instanceof Error ? err : new Error(String(err)))
    } finally {
      this.running = false
      void this.pump()
    }
  }

  private runInWorker(worker: Worker, payload: Payload): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<RenderResponse>) => {
        const m = e.data
        if (!("id" in m) || m.id !== id) return
        if (m.type === "image") resolve(bitmapFrame(m.image))
        else if (m.type === "thumbs") resolve(new Map(m.items.map((t) => [t.key, bitmapFrame(t.image)])))
        else if (m.type === "error") reject(new Error(m.message))
      }
      worker.postMessage({ ...payload, id })
    })
  }

  /** main-thread fallback: yield first so a burst of requests collapses to the last */
  private async runHere(payload: Payload): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 0))
    const canvas = () => document.createElement("canvas")
    if (payload.type === "thumbs")
      return new Map(payload.items.map((t) => [t.key, canvasFrame(renderJob.thumb(canvas(), t))]))
    if (payload.type === "preview") return canvasFrame(renderJob.preview(canvas(), payload))
    return canvasFrame(renderJob.full(canvas(), payload))
  }
}

export const renderer = new RenderClient()

export type ExportStage = "rendering" | "encoding"

export interface ExportJob {
  done: Promise<Blob>
  cancel(): void
}

/**
 * Full-size PNG in its own worker, so an 8K render can't stall previews, and
 * cancel can stop it mid-render. Terminating the worker also frees its memory.
 */
export function exportPNG(
  cfg: WallpaperConfig,
  w: number,
  h: number,
  onStage: (s: ExportStage) => void
): ExportJob {
  let cancel = () => {}
  const done = new Promise<Blob>((resolve, reject) => {
    const abort = () => reject(new DOMException("Export cancelled", "AbortError"))
    if (!workerSupported()) {
      let cancelled = false
      cancel = () => {
        cancelled = true
        abort()
      }
      onStage("rendering")
      // let the "Rendering…" state paint before the main thread is busy
      requestAnimationFrame(() =>
        setTimeout(() => {
          if (cancelled) return
          try {
            const c = renderJob.export(document.createElement("canvas"), { cfg, w, h })
            onStage("encoding")
            c.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png")
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        }, 0)
      )
      return
    }
    const worker = makeWorker()
    const finish = () => worker.terminate()
    cancel = () => {
      finish()
      abort()
    }
    worker.onerror = (e) => {
      finish()
      reject(new Error(e.message || "Export failed"))
    }
    worker.onmessage = (e: MessageEvent<RenderResponse>) => {
      const m = e.data
      if (m.type === "stage") onStage(m.stage)
      else if (m.type === "export") {
        finish()
        resolve(m.blob)
      } else if (m.type === "error") {
        finish()
        reject(new Error(m.message))
      }
    }
    onStage("rendering")
    const req: ExportRequest = { type: "export", id: 1, cfg, w, h }
    worker.postMessage(req)
  })
  return { done, cancel: () => cancel() }
}

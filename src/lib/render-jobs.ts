// The render work itself, shared by the worker and the main-thread fallback.
import { renderPreview, renderWallpaper, type WallpaperConfig } from "./wallpaper"

export interface PreviewRequest {
  type: "preview"
  id: number
  cfg: WallpaperConfig
  outW: number
  outH: number
  /** device-pixel size of the on-screen canvas */
  w: number
  h: number
  draft: boolean
}

/** the export's own pixels (for the Actual pixels view) */
export interface FullRequest {
  type: "full"
  id: number
  cfg: WallpaperConfig
  w: number
  h: number
}

export interface ThumbJob {
  key: string
  cfg: WallpaperConfig
  w: number
  h: number
  /** texture pitch in device px, so samples stay legible at thumbnail size */
  cellPx?: number
}

export interface ThumbsRequest {
  type: "thumbs"
  id: number
  items: ThumbJob[]
}

export interface ExportRequest {
  type: "export"
  id: number
  cfg: WallpaperConfig
  w: number
  h: number
}

export type RenderRequest = PreviewRequest | FullRequest | ThumbsRequest | ExportRequest

export type RenderResponse =
  | { type: "pong"; ok: boolean }
  | { type: "image"; id: number; image: ImageBitmap }
  | { type: "thumbs"; id: number; items: { key: string; image: ImageBitmap }[] }
  | { type: "stage"; id: number; stage: "encoding" }
  | { type: "export"; id: number; blob: Blob }
  | { type: "error"; id: number; message: string }

export const renderJob = {
  preview(c: HTMLCanvasElement, r: Omit<PreviewRequest, "type" | "id">) {
    renderPreview(c, r.cfg, r.outW, r.outH, r.w, r.h, r.draft)
    return c
  },
  full(c: HTMLCanvasElement, r: Omit<FullRequest, "type" | "id">) {
    renderWallpaper(c, r.cfg, r.w, r.h)
    return c
  },
  export(c: HTMLCanvasElement, r: Omit<ExportRequest, "type" | "id">) {
    renderWallpaper(c, r.cfg, r.w, r.h)
    return c
  },
  thumb(c: HTMLCanvasElement, t: ThumbJob) {
    renderWallpaper(c, t.cfg, t.w, t.h, t.cellPx ? { cellPx: t.cellPx } : {})
    return c
  },
}

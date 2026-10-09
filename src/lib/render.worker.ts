// Renders off the main thread with OffscreenCanvas: previews, thumbnails,
// full-resolution "actual pixels" views and PNG exports. Same renderer as the
// page and the link-preview server, so output is identical.
import { renderJob, type RenderRequest, type RenderResponse } from "./render-jobs"
import { setCanvasFactory } from "./wallpaper"

setCanvasFactory(() => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement)

const post = (msg: RenderResponse, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer)

self.onmessage = async (e: MessageEvent<RenderRequest | { type: "ping" }>) => {
  const req = e.data
  if (req.type === "ping") {
    // Safari < 16.4 has OffscreenCanvas without a 2d context
    let ok = false
    try {
      ok = Boolean(new OffscreenCanvas(1, 1).getContext("2d"))
    } catch {
      ok = false
    }
    post({ type: "pong", ok })
    return
  }
  try {
    const canvas = () => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement
    const bitmap = (c: HTMLCanvasElement) => (c as unknown as OffscreenCanvas).transferToImageBitmap()
    if (req.type === "export") {
      const c = renderJob.export(canvas(), req)
      post({ type: "stage", id: req.id, stage: "encoding" })
      const blob = await (c as unknown as OffscreenCanvas).convertToBlob({ type: "image/png" })
      post({ type: "export", id: req.id, blob })
    } else if (req.type === "thumbs") {
      const out = req.items.map((t) => ({ key: t.key, image: bitmap(renderJob.thumb(canvas(), t)) }))
      post({ type: "thumbs", id: req.id, items: out }, out.map((o) => o.image))
    } else {
      const c = req.type === "preview" ? renderJob.preview(canvas(), req) : renderJob.full(canvas(), req)
      const image = bitmap(c)
      post({ type: "image", id: req.id, image }, [image])
    }
  } catch (err) {
    post({ type: "error", id: req.id, message: err instanceof Error ? err.message : String(err) })
  }
}

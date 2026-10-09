import { useEffect, useRef, useState } from "react"
import { AlertCircle, Download, Image as ImageIcon, Link2, Share2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { dims, type OutputSpec } from "@/lib/output"
import { exportPNG, type ExportJob } from "@/lib/render-client"
import type { WallpaperConfig } from "@/lib/wallpaper"
import { CheckDraw } from "./motion"

type Purpose = "download" | "share"
type JobState =
  | { status: "idle" }
  | { status: "rendering" | "encoding"; purpose: Purpose }
  | { status: "done"; purpose: Purpose }
  | { status: "ready" } // a shareable file is prepared and waiting for a tap
  | { status: "error"; purpose: Purpose; message: string }

const fileName = (cfg: WallpaperConfig, o: OutputSpec) => `wallgen-${cfg.scene}-${cfg.seed}-${o.w}x${o.h}.png`

/** can this browser share image files (feature-detected once) */
const canShareFiles = (() => {
  try {
    return (
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [new File([new Uint8Array(8)], "x.png", { type: "image/png" })] })
    )
  } catch {
    return false
  }
})()

const canShareLink = typeof navigator !== "undefined" && typeof navigator.share === "function"

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  // revoking immediately can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function ExportActions({
  cfg,
  output,
  shareUrl,
  className,
  showSummary,
}: {
  cfg: WallpaperConfig
  output: OutputSpec
  shareUrl: () => string
  className?: string
  /** one line naming exactly what Download produces */
  showSummary?: boolean
}) {
  const [job, setJob] = useState<JobState>({ status: "idle" })
  const [copied, setCopied] = useState(false)
  const [linkFallback, setLinkFallback] = useState<string | null>(null)
  const [announce, setAnnounce] = useState("")
  const running = useRef<ExportJob | null>(null)
  // the prepared share file belongs to the exact recipe that produced it
  const prepared = useRef<{ key: string; file: File } | null>(null)
  const key = JSON.stringify([cfg, output.w, output.h])
  const busy = job.status === "rendering" || job.status === "encoding"

  // editing after preparing a share image invalidates it
  useEffect(() => {
    if (prepared.current && prepared.current.key !== key) prepared.current = null
    setJob((j) => (j.status === "ready" ? { status: "idle" } : j))
  }, [key])

  useEffect(() => () => running.current?.cancel(), [])

  const finishLater = (purpose: Purpose) =>
    setTimeout(() => setJob((j) => (j.status === "done" && j.purpose === purpose ? { status: "idle" } : j)), 2200)

  const shareFile = async (file: File) => {
    try {
      await navigator.share({ files: [file], title: "wallgen wallpaper" })
      setJob({ status: "done", purpose: "share" })
      finishLater("share")
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setJob({ status: "idle" }) // the user closed the share sheet
      } else if (err instanceof DOMException && err.name === "NotAllowedError") {
        setJob({ status: "ready" }) // activation expired: ask for one more tap
      } else {
        setJob({ status: "error", purpose: "share", message: "Sharing failed — try Download instead." })
      }
    }
  }

  const render = (purpose: Purpose) => {
    const snapshotKey = key
    const name = fileName(cfg, output)
    const t0 = performance.now()
    const j = exportPNG(cfg, output.w, output.h, (stage) => setJob({ status: stage, purpose }))
    running.current = j
    setAnnounce(`Rendering ${dims(output)} PNG…`)
    j.done
      .then((blob) => {
        if (running.current !== j) return
        running.current = null
        if (purpose === "download") {
          saveBlob(blob, name)
          setJob({ status: "done", purpose })
          setAnnounce(`Download started: ${name}`)
          finishLater(purpose)
          return
        }
        const file = new File([blob], name, { type: "image/png" })
        prepared.current = { key: snapshotKey, file }
        setAnnounce("Image ready to share")
        // a short render keeps the tap's activation; a long one needs a new tap
        const active = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive
        if (active ?? performance.now() - t0 < 4000) void shareFile(file)
        else setJob({ status: "ready" })
      })
      .catch((err: unknown) => {
        if (running.current !== j) return
        running.current = null
        if (err instanceof DOMException && err.name === "AbortError") {
          setJob({ status: "idle" })
          setAnnounce("Export cancelled")
          return
        }
        const message =
          output.w * output.h > 20e6
            ? "Not enough memory for this size — try a smaller output."
            : "Export failed — try again."
        setJob({ status: "error", purpose, message })
        setAnnounce(message)
      })
  }

  const onDownload = () => {
    if (busy) return
    render("download")
  }

  const onShareImage = () => {
    if (busy) return
    if (prepared.current?.key === key) void shareFile(prepared.current.file)
    else render("share")
  }

  const onShareLink = async () => {
    try {
      await navigator.share({ title: "wallgen", text: "My wallpaper — open to tweak & download:", url: shareUrl() })
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) void onCopy()
    }
  }

  const onCopy = async () => {
    const url = shareUrl()
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setAnnounce("Link copied")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setLinkFallback(url) // clipboard blocked: show the link to copy by hand
    }
  }

  const downloadLabel = () => {
    if (job.status === "rendering" && job.purpose === "download") return <><Download /> Rendering…</>
    if (job.status === "encoding" && job.purpose === "download") return <><Download /> Encoding PNG…</>
    if (job.status === "done" && job.purpose === "download") return <><CheckDraw /> Download started</>
    if (job.status === "error" && job.purpose === "download") return <><AlertCircle /> Retry download</>
    return <><Download /> Download PNG</>
  }

  const shareBusy = busy && job.purpose === "share"
  const shareReady = job.status === "ready"

  return (
    <div className={cn("grid gap-2", className)}>
      {showSummary && (
        <p className="flex items-baseline justify-between text-xs text-muted-foreground">
          <span>PNG</span>
          <span className="tabular-nums">{dims(output)} px</span>
        </p>
      )}
      <div className="flex gap-2">
        <Button
          data-export="download"
          onClick={onDownload}
          disabled={busy && job.purpose === "share"}
          aria-busy={busy && job.purpose === "download"}
          className={cn(
            "h-11 min-w-0 flex-1 text-[15px]",
            busy && job.purpose === "download" && "export-sweep cursor-progress hover:bg-primary"
          )}
        >
          {downloadLabel()}
        </Button>
        {busy ? (
          <Button
            variant="outline"
            size="icon"
            className="size-11"
            aria-label="Cancel export"
            onClick={() => {
              running.current?.cancel()
            }}
          >
            <X />
          </Button>
        ) : shareReady ? (
          <Button variant="secondary" className="h-11 gap-1.5 px-3" onClick={onShareImage}>
            <Share2 /> Share image
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="h-11 gap-1.5 px-3" aria-label={copied ? "Link copied" : "Share"}>
                {copied ? <CheckDraw /> : <Share2 />}
                <span className="max-[359px]:sr-only">{copied ? "Copied" : "Share"}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dark w-56">
              {canShareFiles && (
                <DropdownMenuItem className="min-h-11" onSelect={onShareImage}>
                  <ImageIcon /> Share image…
                </DropdownMenuItem>
              )}
              {canShareLink && (
                <DropdownMenuItem className="min-h-11" onSelect={onShareLink}>
                  <Share2 /> Share link…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="min-h-11" onSelect={onCopy}>
                <Link2 /> Copy editable link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {(shareBusy || job.status === "error" || shareReady) && (
        <p className={cn("text-xs", job.status === "error" ? "text-destructive" : "text-muted-foreground")}>
          {job.status === "error" ? job.message : shareReady ? "Image ready — tap Share image." : "Preparing image to share…"}
        </p>
      )}
      {linkFallback && (
        <div className="flex items-center gap-2">
          <input
            readOnly
            aria-label="Link to this wallpaper"
            value={linkFallback}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            className="h-9 min-w-0 flex-1 rounded-md border bg-input/30 px-2 text-xs"
          />
          <Button variant="ghost" size="icon" className="size-9" aria-label="Close" onClick={() => setLinkFallback(null)}>
            <X />
          </Button>
        </div>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
    </div>
  )
}

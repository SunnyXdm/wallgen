import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { cn } from "@/lib/utils"
import { renderer, type Frame } from "@/lib/render-client"
import type { OutputSpec } from "@/lib/output"
import type { WallpaperConfig } from "@/lib/wallpaper"
import { liftAway, reducedMotion, snapshotInto } from "@/lib/motion"

export type StageMode = "fit" | "actual"

/** the screen's pixel density, capped: past 3× extra pixels only cost time */
const dpr = () => Math.min(window.devicePixelRatio || 1, 3)

function useBoxSize(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // layout size, not getBoundingClientRect: that includes the entrance
    // animation's scale and would fit the preview a few percent small
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return box
}

export function PreviewStage({
  cfg,
  output,
  mode,
  draft,
  fadeNext,
  label,
  className,
}: {
  cfg: WallpaperConfig
  output: OutputSpec
  mode: StageMode
  /** a continuous edit is in progress: favor fast frames over supersampling */
  draft: boolean
  /** set by discrete edits; the next frame crossfades in */
  fadeNext: RefObject<boolean>
  label: string
  className?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const box = useBoxSize(boxRef)
  return (
    <div ref={boxRef} className={cn("relative min-h-0 min-w-0", className)}>
      {box.w > 0 && box.h > 0 &&
        (mode === "fit" ? (
          <FitView cfg={cfg} output={output} draft={draft} fadeNext={fadeNext} box={box} label={label} />
        ) : (
          <ActualPixels cfg={cfg} output={output} box={box} label={label} />
        ))}
    </div>
  )
}

function FitView({
  cfg,
  output,
  draft,
  fadeNext,
  box,
  label,
}: {
  cfg: WallpaperConfig
  output: OutputSpec
  draft: boolean
  fadeNext: RefObject<boolean>
  box: { w: number; h: number }
  label: string
}) {
  const mainRef = useRef<HTMLCanvasElement>(null)
  const ghostRef = useRef<HTMLCanvasElement>(null)
  const ratio = dpr()
  // fit the output's aspect into the box, then snap to whole device pixels so
  // the canvas is shown at exactly its backing size (no CSS resampling)
  const scale = Math.min(box.w / output.w, box.h / output.h)
  const dw = Math.max(1, Math.floor(output.w * scale * ratio))
  const dh = Math.max(1, Math.floor(output.h * scale * ratio))
  const css = { width: dw / ratio, height: dh / ratio }
  const radius = { borderRadius: Math.min(22, Math.min(css.width, css.height) * 0.06) }

  // only size changes (panel opening, window resize) wait for things to settle
  const last = useRef({ cfg, w: output.w, h: output.h, draft })
  useEffect(() => {
    const sizeOnly =
      last.current.cfg === cfg && last.current.w === output.w && last.current.h === output.h && last.current.draft === draft
    last.current = { cfg, w: output.w, h: output.h, draft }
    const fade = !sizeOnly && fadeNext.current && !reducedMotion()
    fadeNext.current = false
    let alive = true
    const run = () =>
      renderer.preview({ cfg, outW: output.w, outH: output.h, w: dw, h: dh, draft }).then((frame) => {
        if (!frame) return
        const main = mainRef.current
        if (!alive || !main) return frame.close()
        draw(main, ghostRef.current, frame, fade)
      })
    if (!sizeOnly) {
      void run()
      return () => {
        alive = false
      }
    }
    const t = setTimeout(run, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [cfg, output.w, output.h, dw, dh, draft, fadeNext])

  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative" style={css}>
        <canvas
          ref={mainRef}
          role="img"
          aria-label={label}
          style={radius}
          className="absolute inset-0 size-full shadow-2xl ring-1 ring-white/10"
        />
        {/* previous frame, faded out over the new one on discrete changes */}
        <canvas
          ref={ghostRef}
          aria-hidden
          style={radius}
          className="pointer-events-none absolute inset-0 size-full opacity-0"
        />
      </div>
    </div>
  )
}

function draw(main: HTMLCanvasElement, ghost: HTMLCanvasElement | null, frame: Frame, fade: boolean) {
  if (fade && ghost && main.width > 1) snapshotInto(ghost, main)
  if (main.width !== frame.width || main.height !== frame.height) {
    main.width = frame.width
    main.height = frame.height
  }
  main.getContext("2d")!.drawImage(frame.image, 0, 0)
  frame.close()
  if (fade && ghost && ghost.width > 1) liftAway(ghost)
}

/**
 * The export's own pixels, one output pixel per device pixel, panned by drag
 * or arrow keys. Renders the full PNG-size image once per change (off-thread)
 * and only blits the visible window.
 */
function ActualPixels({
  cfg,
  output,
  box,
  label,
}: {
  cfg: WallpaperConfig
  output: OutputSpec
  box: { w: number; h: number }
  label: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<Frame | null>(null)
  const [loading, setLoading] = useState(true)
  const ratio = dpr()
  const vw = Math.max(1, Math.floor(box.w * ratio))
  const vh = Math.max(1, Math.floor(box.h * ratio))
  // view center in output pixels
  const center = useRef({ x: output.w / 2, y: output.h / 2 })

  const paint = () => {
    const c = ref.current
    const f = frameRef.current
    if (!c) return
    c.width = vw
    c.height = vh
    const ctx = c.getContext("2d")!
    ctx.clearRect(0, 0, vw, vh)
    if (!f) return
    const halfW = Math.min(vw, f.width) / 2
    const halfH = Math.min(vh, f.height) / 2
    const cx = Math.min(Math.max(center.current.x, halfW), f.width - halfW)
    const cy = Math.min(Math.max(center.current.y, halfH), f.height - halfH)
    center.current = { x: cx, y: cy }
    const sx = Math.round(cx - halfW)
    const sy = Math.round(cy - halfH)
    const w = Math.round(halfW * 2)
    const h = Math.round(halfH * 2)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(f.image, sx, sy, w, h, Math.round((vw - w) / 2), Math.round((vh - h) / 2), w, h)
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    void renderer.full(cfg, output.w, output.h).then((f) => {
      if (!f) return
      if (!alive) return f.close()
      frameRef.current?.close()
      frameRef.current = f
      setLoading(false)
      paint()
    })
    return () => {
      alive = false
    }
    // paint reads the latest refs; re-render only when the image changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, output.w, output.h])

  useEffect(() => {
    center.current = { x: output.w / 2, y: output.h / 2 }
  }, [output.w, output.h])

  useEffect(paint)

  useEffect(
    () => () => {
      frameRef.current?.close()
      frameRef.current = null
    },
    []
  )

  const drag = useRef<{ x: number; y: number } | null>(null)
  const pan = (dx: number, dy: number) => {
    center.current = { x: center.current.x + dx, y: center.current.y + dy }
    paint()
  }

  return (
    <div className="absolute inset-0">
      <canvas
        ref={ref}
        role="img"
        tabIndex={0}
        aria-label={`${label}, actual pixels. Drag or use arrow keys to pan.`}
        className="size-full cursor-grab touch-none rounded-lg active:cursor-grabbing"
        style={{ width: vw / ratio, height: vh / ratio }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          pan((drag.current.x - e.clientX) * ratio, (drag.current.y - e.clientY) * ratio)
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 400 : 80
          const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
          if (!d) return
          e.preventDefault()
          pan(d[0], d[1])
        }}
      />
      <p className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/85 backdrop-blur-sm">
        Actual pixels · {output.w} × {output.h} · drag to pan
      </p>
      {loading && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
          Rendering {output.w} × {output.h}…
        </p>
      )}
    </div>
  )
}

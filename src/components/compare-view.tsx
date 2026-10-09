import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { dims, fromPreset, presetById, type OutputSpec } from "@/lib/output"
import { renderer } from "@/lib/render-client"
import type { WallpaperConfig } from "@/lib/wallpaper"
import { KIND_ICON } from "@/lib/device-icons"

const FORMATS = ["iphone", "ipad", "uhd4k"].map((id) => fromPreset(presetById(id)!))
const GAP = 24
const LABEL = 44

/** the same look in a phone, tablet and desktop composition; pick one to switch */
export function CompareView({
  cfg,
  output,
  onPick,
}: {
  cfg: WallpaperConfig
  output: OutputSpec
  onPick: (o: OutputSpec) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // one scale for all three so their relative sizes read honestly
  const totalW = FORMATS.reduce((s, f) => s + f.w / f.h, 0)
  const unitH = Math.max(0, Math.min(box.h - LABEL, (box.w - GAP * (FORMATS.length - 1)) / totalW))
  return (
    <div ref={ref} className="absolute inset-0 flex items-center justify-center" style={{ gap: GAP }}>
      {unitH > 0 &&
        FORMATS.map((f, i) => (
          <CompareCard
            key={f.preset}
            index={i}
            cfg={cfg}
            format={f}
            height={unitH}
            current={output.preset === f.preset && output.w === f.w}
            onPick={() => onPick(f)}
          />
        ))}
    </div>
  )
}

function CompareCard({
  cfg,
  format,
  height,
  current,
  onPick,
  index,
}: {
  cfg: WallpaperConfig
  format: OutputSpec
  height: number
  current: boolean
  onPick: () => void
  index: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const ratio = Math.min(window.devicePixelRatio || 1, 3)
  const dh = Math.max(1, Math.floor(height * ratio))
  const dw = Math.max(1, Math.floor((height * format.w * ratio) / format.h))
  useEffect(() => {
    let alive = true
    void renderer
      .preview({ cfg, outW: format.w, outH: format.h, w: dw, h: dh, draft: false }, `compare-${index}`)
      .then((f) => {
        if (!f) return
        const c = canvas.current
        if (!alive || !c) return f.close()
        c.width = f.width
        c.height = f.height
        c.getContext("2d")!.drawImage(f.image, 0, 0)
        f.close()
      })
    return () => {
      alive = false
    }
  }, [cfg, format.w, format.h, dw, dh, index])
  const Icon = KIND_ICON[format.kind]
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={current}
      aria-label={`Use ${format.kind} format, ${dims(format)}`}
      className="group/cmp flex flex-col items-center gap-2 rounded-xl"
    >
      <canvas
        ref={canvas}
        aria-hidden
        style={{ width: dw / ratio, height: dh / ratio, borderRadius: Math.min(dw, dh) / ratio * 0.06 }}
        className={cn(
          "shadow-2xl ring-1 ring-white/10 transition-transform motion-ui group-hover/cmp:-translate-y-1",
          current && "ring-2 ring-primary"
        )}
      />
      <span className={cn("flex items-center gap-1.5 text-xs", current ? "text-foreground" : "text-muted-foreground")}>
        <Icon className="size-3.5" /> {dims(format)}
      </span>
    </button>
  )
}

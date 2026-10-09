import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { Frame } from "@/lib/render-client"

/** draws a frame when one arrives; keeps showing the last one until then */
export function ThumbCanvas({ frame, className }: { frame: Frame | undefined; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c || !frame) return
    c.width = frame.width
    c.height = frame.height
    c.getContext("2d")!.drawImage(frame.image, 0, 0)
  }, [frame])
  return <canvas ref={ref} aria-hidden className={cn("block size-full bg-muted", className)} />
}

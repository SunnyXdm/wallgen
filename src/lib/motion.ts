import { useRef } from "react"

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Copy what the preview currently shows into its ghost layer. If a crossfade
 * is still running, blend the incoming frame in at the ghost's live opacity so
 * rapid regenerations hand off seamlessly instead of snapping.
 */
export function snapshotInto(ghost: HTMLCanvasElement, main: HTMLCanvasElement) {
  const running = ghost.getAnimations() // only non-empty mid-fade
  const ctx = ghost.getContext("2d")!
  if (running.length > 0 && ghost.width === main.width && ghost.height === main.height) {
    const a = Number(getComputedStyle(ghost).opacity)
    for (const anim of running) anim.cancel()
    ctx.globalAlpha = 1 - a
    ctx.drawImage(main, 0, 0)
    ctx.globalAlpha = 1
  } else {
    for (const anim of running) anim.cancel()
    ghost.width = main.width
    ghost.height = main.height
    ctx.drawImage(main, 0, 0)
  }
}

/** old frame lifts off and fades, revealing the freshly rendered one beneath */
export function liftAway(ghost: HTMLCanvasElement) {
  ghost.animate(
    [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(1.015)" },
    ],
    // no fill: once finished it falls back to the class's opacity-0, so no
    // idle animation (or compositor layer) lingers on the ghost
    { duration: 480, easing: "cubic-bezier(0.33, 1, 0.68, 1)" }
  )
}

export function spin(el: Element | null, turn = 360) {
  if (!el || reducedMotion()) return
  el.animate([{ transform: "rotate(0)" }, { transform: `rotate(${turn}deg)` }], {
    duration: 600,
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
  })
}

export function useDir(value: number) {
  const prev = useRef(value)
  const dir = useRef<"up" | "down">("up")
  if (value !== prev.current) {
    dir.current = value > prev.current ? "up" : "down"
    prev.current = value
  }
  return dir.current
}

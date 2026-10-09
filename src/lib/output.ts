// Output targets: the one answer to "what am I making?". The preview aspect,
// the resolution label, the downloaded PNG and the share URL all read the same
// OutputSpec. Plain .ts (no imports) so the link-preview server can use it.

export type DeviceKind = "phone" | "desktop" | "tablet" | "custom"

export interface OutputSpec {
  kind: DeviceKind
  /** preset id, "screen" for an estimate of the viewer's display, or "custom" */
  preset: string
  /** final, oriented pixel size */
  w: number
  h: number
}

export interface OutputPreset {
  id: string
  kind: Exclude<DeviceKind, "custom">
  name: string
  /** short descriptor shown next to the name, e.g. the aspect ratio */
  note: string
  /** natural orientation: portrait for phones and tablets, landscape for desktops */
  w: number
  h: number
}

export const OUTPUT_PRESETS: OutputPreset[] = [
  { id: "iphone", kind: "phone", name: "iPhone 15 / 16", note: "19.5:9", w: 1179, h: 2556 },
  { id: "iphone-pro", kind: "phone", name: "iPhone 16 Pro", note: "19.5:9", w: 1206, h: 2622 },
  { id: "iphone-max", kind: "phone", name: "iPhone Plus / Pro Max", note: "19.5:9", w: 1290, h: 2796 },
  { id: "iphone-16-max", kind: "phone", name: "iPhone 16 Pro Max", note: "19.5:9", w: 1320, h: 2868 },
  { id: "android", kind: "phone", name: "Android FHD+", note: "20:9", w: 1080, h: 2400 },
  { id: "android-qhd", kind: "phone", name: "Android QHD+", note: "19.5:9", w: 1440, h: 3120 },
  { id: "phone-16x9", kind: "phone", name: "Classic phone", note: "16:9", w: 1080, h: 1920 },

  { id: "hd", kind: "desktop", name: "HD", note: "16:9", w: 1280, h: 720 },
  { id: "fhd", kind: "desktop", name: "Full HD", note: "16:9", w: 1920, h: 1080 },
  { id: "qhd", kind: "desktop", name: "QHD", note: "16:9", w: 2560, h: 1440 },
  { id: "uhd4k", kind: "desktop", name: "4K", note: "16:9", w: 3840, h: 2160 },
  { id: "uhd5k", kind: "desktop", name: "5K", note: "16:9", w: 5120, h: 2880 },
  { id: "uhd8k", kind: "desktop", name: "8K", note: "16:9", w: 7680, h: 4320 },
  { id: "wuxga", kind: "desktop", name: "WUXGA", note: "16:10", w: 1920, h: 1200 },
  { id: "wqxga", kind: "desktop", name: "WQXGA", note: "16:10", w: 2560, h: 1600 },
  { id: "mba13", kind: "desktop", name: "MacBook Air 13″", note: "16:10", w: 2560, h: 1664 },
  { id: "mbp14", kind: "desktop", name: "MacBook Pro 14″", note: "16:10", w: 3024, h: 1964 },
  { id: "mbp16", kind: "desktop", name: "MacBook Pro 16″", note: "16:10", w: 3456, h: 2234 },
  { id: "uw-qhd", kind: "desktop", name: "Ultrawide", note: "21:9", w: 3440, h: 1440 },
  { id: "uw-5k", kind: "desktop", name: "Ultrawide 5K", note: "21:9", w: 5120, h: 2160 },
  { id: "suw", kind: "desktop", name: "Super ultrawide", note: "32:9", w: 5120, h: 1440 },

  { id: "ipad", kind: "tablet", name: "iPad / iPad Air 11″", note: "≈3:2", w: 1640, h: 2360 },
  { id: "ipad-pro-11", kind: "tablet", name: "iPad Pro 11″", note: "≈3:2", w: 1668, h: 2420 },
  { id: "ipad-pro-13", kind: "tablet", name: "iPad Pro 12.9″", note: "4:3", w: 2048, h: 2732 },
  { id: "android-tab", kind: "tablet", name: "Android tablet", note: "16:10", w: 1600, h: 2560 },
]

/** sides beyond this are refused: an 8K-class canvas is already ~130 MB of pixels */
export const MAX_SIDE = 8192
export const MIN_SIDE = 64
export const MAX_PIXELS = 7680 * 4320

export const presetById = (id: string) => OUTPUT_PRESETS.find((p) => p.id === id)

export const isPortrait = (o: { w: number; h: number }) => o.h > o.w

export function fromPreset(p: OutputPreset, portrait = p.h > p.w): OutputSpec {
  const long = Math.max(p.w, p.h)
  const short = Math.min(p.w, p.h)
  return { kind: p.kind, preset: p.id, w: portrait ? short : long, h: portrait ? long : short }
}

export function rotate(o: OutputSpec): OutputSpec {
  return { ...o, w: o.h, h: o.w }
}

export function validSize(w: number, h: number): boolean {
  return (
    Number.isInteger(w) &&
    Number.isInteger(h) &&
    w >= MIN_SIDE &&
    h >= MIN_SIDE &&
    w <= MAX_SIDE &&
    h <= MAX_SIDE &&
    w * h <= MAX_PIXELS
  )
}

/** the default when a link names no output (and the legacy one for `res=3`) */
export const DEFAULT_OUTPUT: OutputSpec = fromPreset(presetById("uhd4k")!)

/** legacy `res=` index → the 16:9 desktop size it exported in landscape */
const LEGACY_RES = ["hd", "fhd", "qhd", "uhd4k", "uhd5k", "uhd8k"]

export function legacyOutput(res: number): OutputSpec {
  return fromPreset(presetById(LEGACY_RES[res] ?? "uhd4k")!)
}

/** inverse of legacyOutput, for code that still reports a `res` index */
export function legacyResIndex(o: OutputSpec): number {
  const i = LEGACY_RES.indexOf(o.preset)
  return i >= 0 && !isPortrait(o) ? i : 3
}

/** `1179x2556` → size, or null */
export function parseSize(v: string | null): { w: number; h: number } | null {
  const m = v?.match(/^(\d{2,4})x(\d{2,4})$/)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  return validSize(w, h) ? { w, h } : null
}

/**
 * Rebuild an output from URL values: a known preset keeps its identity only
 * if the size is one of its two orientations; anything else is custom.
 */
export function outputFrom(size: { w: number; h: number }, device: string | null): OutputSpec {
  const p = device ? presetById(device) : undefined
  if (p && Math.min(size.w, size.h) === Math.min(p.w, p.h) && Math.max(size.w, size.h) === Math.max(p.w, p.h))
    return { kind: p.kind, preset: p.id, ...size }
  if (device === "screen") return { kind: guessKind(size), preset: "screen", ...size }
  return { kind: "custom", preset: "custom", ...size }
}

/** a reasonable category for an arbitrary size */
export function guessKind({ w, h }: { w: number; h: number }): Exclude<DeviceKind, "custom"> {
  const long = Math.max(w, h) / Math.min(w, h)
  if (h > w && long >= 1.75) return "phone"
  if (h > w) return "tablet"
  return "desktop"
}

/**
 * Best guess at the viewer's display in device pixels. Browsers report CSS
 * size × zoom-affected DPR, so this is an estimate the user can correct.
 */
export function estimateScreen(
  s: { width: number; height: number },
  dpr: number,
  portrait: boolean
): { w: number; h: number } {
  const a = Math.round(s.width * dpr)
  const b = Math.round(s.height * dpr)
  const short = Math.max(MIN_SIDE, Math.min(a, b, MAX_SIDE))
  const long = Math.max(MIN_SIDE, Math.min(Math.max(a, b), MAX_SIDE))
  return portrait ? { w: short, h: long } : { w: long, h: short }
}

/** the viewer's screen in its current orientation, in device pixels */
export function screenOutput(): OutputSpec {
  const portrait = window.innerHeight >= window.innerWidth
  const size = estimateScreen(window.screen, window.devicePixelRatio || 1, portrait)
  return { kind: guessKind(size), preset: "screen", ...size }
}

export function outputLabel(o: OutputSpec): string {
  if (o.preset === "screen") return "This screen"
  if (o.preset === "custom") return "Custom size"
  return presetById(o.preset)?.name ?? "Custom size"
}

export const KIND_LABEL: Record<DeviceKind, string> = {
  phone: "Phone",
  desktop: "Desktop",
  tablet: "Tablet",
  custom: "Custom",
}

/** "1179 × 2556" with thin spaces, for labels */
export const dims = (o: { w: number; h: number }) => `${o.w} × ${o.h}`

/** reduced aspect ratio, e.g. 16:9, or 2.17:1 when it doesn't reduce nicely */
export function aspectLabel({ w, h }: { w: number; h: number }): string {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const g = gcd(w, h)
  const a = w / g
  const b = h / g
  if (a <= 32 && b <= 32) return `${a}:${b}`
  const r = Math.max(w, h) / Math.min(w, h)
  return w >= h ? `${r.toFixed(2)}:1` : `1:${r.toFixed(2)}`
}

// Background tone (dark/light wallpaper background) without touching the
// color set: a palette's own bg pair when the bg is still the palette's, else
// the same hue moved to the other end of the lightness range.
import { PALETTES } from "./wallpaper"

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    const a = s * Math.min(l, 1 - l)
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** a background in the requested tone that keeps the current hue */
export function flipTone(bg: string, dark: boolean): string {
  const [h, s, l] = hexToHsl(bg)
  const target = dark ? Math.min(Math.max(1 - l, 0.04), 0.12) : Math.min(Math.max(1 - l, 0.88), 0.95)
  return hslToHex(h, Math.min(s, dark ? 0.6 : 0.35), target)
}

/** what the background becomes when switching to `dark` */
export function toneBg(bg: string, paletteName: string, dark: boolean): string {
  const p = PALETTES.find((p) => p.name === paletteName)
  if (p && (same(bg, p.darkBg) || same(bg, p.lightBg))) return dark ? p.darkBg : p.lightBg
  return flipTone(bg, dark)
}

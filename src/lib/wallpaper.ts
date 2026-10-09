export type Pattern = "grid" | "dots" | "softdots" | "bayer" | "smooth"

export type Scene =
  | "mist"
  | "smoke"
  | "blobs"
  | "flow"
  | "hills"
  | "wave"
  | "dunes"
  | "mountains"
  | "arcs"
  | "scribble"

/** ids are part of shared URLs and must stay stable; labels are free to change */
export const SCENES: { value: Scene; label: string; group: "soft" | "shapes" }[] = [
  { value: "mist", label: "Mist", group: "soft" },
  { value: "smoke", label: "Smoke", group: "soft" },
  { value: "blobs", label: "Blobs", group: "soft" },
  { value: "flow", label: "Flow", group: "soft" },
  { value: "hills", label: "Hills & pines", group: "shapes" },
  { value: "wave", label: "Swell", group: "shapes" },
  { value: "dunes", label: "Dunes", group: "shapes" },
  { value: "mountains", label: "Mountains", group: "shapes" },
  { value: "arcs", label: "Arcs", group: "shapes" },
  { value: "scribble", label: "Scribble", group: "shapes" },
]

export interface Palette {
  name: string
  darkBg: string
  lightBg: string
  colors: string[]
}

export const PALETTES: Palette[] = [
  { name: "Lagoon", darkBg: "#03161a", lightBg: "#e3eeec", colors: ["#06262c", "#0f4f5c", "#4a8088", "#c4ddd9"] },
  { name: "Deep Teal", darkBg: "#0a1417", lightBg: "#dfe7e6", colors: ["#16323a", "#3c6b70", "#a9bfbc", "#517d80"] },
  { name: "Midnight", darkBg: "#0b0b12", lightBg: "#e6e4ee", colors: ["#232345", "#4b4b8f", "#8f8fc9", "#2e2e5e"] },
  { name: "Ember", darkBg: "#120a08", lightBg: "#f3e4dd", colors: ["#4a1f14", "#a84b2f", "#e08d5a", "#712d1c"] },
  { name: "Forest", darkBg: "#0a120c", lightBg: "#e2ebe3", colors: ["#1d3a26", "#3f6b4a", "#93b797", "#2b5236"] },
  { name: "Ocean", darkBg: "#081018", lightBg: "#e0e9f0", colors: ["#12304d", "#2f6291", "#8fb4d1", "#1d4568"] },
  { name: "Rose", darkBg: "#140a10", lightBg: "#f2e3ea", colors: ["#3f1c2e", "#8f4468", "#d29ab5", "#5e2c46"] },
  { name: "Mono", darkBg: "#0d0d0d", lightBg: "#ececec", colors: ["#2a2a2a", "#555555", "#a8a8a8", "#3d3d3d"] },
  { name: "Sunrise", darkBg: "#031c35", lightBg: "#fff0c8", colors: ["#0b4b7a", "#ff5b40", "#ff9438", "#ffd064"] },
  { name: "Neon Horizon", darkBg: "#13051a", lightBg: "#e0fbfd", colors: ["#3b2285", "#1d6cd4", "#59cef2", "#94f2f7"] },
  { name: "Toxic Glow", darkBg: "#050807", lightBg: "#f6ffe0", colors: ["#1e3325", "#3f6b2f", "#86b326", "#b9e83f"] },
]

export interface WallpaperConfig {
  seed: number
  scene: Scene
  pattern: Pattern
  bg: string
  colors: string[]
  /** texture cell size in px, relative to a 1080px-wide image */
  cell: number
  /** complexity: soft-scene layer/blob count; crisp scenes derive their layer counts from it */
  blobs: number
  /** 0..1 */
  grain: number
}

/** legacy `res=` URL index (landscape sizes, portrait swapped w/h); outputs now live in output.ts */
export const RESOLUTIONS = [
  { name: "HD", w: 1280, h: 720 },
  { name: "Full HD", w: 1920, h: 1080 },
  { name: "QHD", w: 2560, h: 1440 },
  { name: "4K", w: 3840, h: 2160 },
  { name: "5K", w: 5120, h: 2880 },
  { name: "8K", w: 7680, h: 4320 },
]

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- color helpers ---------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function isLight(hex: string): boolean {
  return luminance(hex) > 128
}

/** f < 0 darkens toward black, f > 0 lightens toward white */
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex)
  const t = f < 0 ? 0 : 255
  const a = Math.abs(f)
  const mix = (c: number) => Math.round(c + (t - c) * a)
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`
}

/** bg first, then colors ordered away from the bg tone — a smooth depth ramp */
function rampStops(cfg: WallpaperConfig): string[] {
  const sorted = [...cfg.colors].sort((a, b) => luminance(a) - luminance(b))
  if (isLight(cfg.bg)) sorted.reverse()
  return [cfg.bg, ...sorted]
}

function rampRgb(stops: string[], t: number): [number, number, number] {
  const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const [r1, g1, b1] = hexToRgb(stops[i])
  const [r2, g2, b2] = hexToRgb(stops[i + 1])
  return [
    Math.round(r1 + (r2 - r1) * f),
    Math.round(g1 + (g2 - g1) * f),
    Math.round(b1 + (b2 - b1) * f),
  ]
}

function rampColor(stops: string[], t: number): string {
  const [r, g, b] = rampRgb(stops, t)
  return `rgb(${r},${g},${b})`
}

// --- 1D value noise / fbm (deterministic, resolution-independent) ----------

function hash1(i: number, seed: number): number {
  const s = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function noise1(x: number, seed: number): number {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash1(i, seed) * (1 - u) + hash1(i + 1, seed) * u
}

/** ~[-1, 1] */
function fbm(x: number, octaves: number, seed: number): number {
  let v = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    v += amp * (noise1(x * freq, seed + o * 13.7) * 2 - 1)
    amp *= 0.5
    freq *= 2
  }
  return v
}

// --- 2D value noise / fbm, for the domain-warped smoke scene ---------------

function hash2(ix: number, iy: number, seed: number): number {
  const s = Math.sin(ix * 127.1 + iy * 269.5 + seed * 311.7) * 43758.5453
  return s - Math.floor(s)
}

function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

/** ~[0, 1] */
function fbm2(x: number, y: number, octaves: number, seed: number): number {
  let v = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    v += amp * noise2(x * freq, y * freq, seed + o * 13.7)
    amp *= 0.5
    freq *= 2
  }
  return v
}

let createCanvas = (): HTMLCanvasElement => document.createElement("canvas")

/** swap the canvas source, e.g. for server-side rendering with @napi-rs/canvas */
export function setCanvasFactory(fn: () => HTMLCanvasElement) {
  createCanvas = fn
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = createCanvas()
  c.width = w
  c.height = h
  return c
}

// --- soft scenes (drawn tiny, upscaled twice = free blur) -------------------

function softField(cfg: WallpaperConfig, w: number, h: number): HTMLCanvasElement {
  const rand = mulberry32(cfg.seed)
  const gw = cfg.scene === "smoke" ? 96 : 64
  const gh = Math.max(8, Math.round((gw * h) / w))
  const low = makeCanvas(gw, gh)
  const lctx = low.getContext("2d")!
  lctx.fillStyle = cfg.bg
  lctx.fillRect(0, 0, gw, gh)

  if (cfg.scene === "mist") {
    // broad, soft fog banks over a vertical dark→light ramp: low-frequency fbm
    // with a gentle warp, stretched horizontally so the clouds lie in banks
    const stops = rampStops(cfg)
    const ns = (cfg.seed % 1013) * 0.917
    const tilt = (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 0.3)
    const freq = 0.9 + rand() * 0.4 + cfg.blobs * 0.05
    const ox = rand() * 10
    const oy = rand() * 10
    const img = lctx.createImageData(gw, gh)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const px = x / gh
        const py = y / gh
        const qx = fbm2(px * freq + ox, py * freq * 1.4 + oy, 3, ns)
        const qy = fbm2(px * freq + ox + 5.2, py * freq * 1.4 + oy + 1.3, 3, ns + 7)
        const v = fbm2(px * freq + 1.6 * qx, py * freq * 1.4 + 1.6 * qy, 3, ns + 13)
        // gentle enough slope that the cloud banks stay visible in the light
        // end instead of saturating to a flat color
        const base = 1.3 * (y / gh) - 0.26 + tilt * (x / gw - 0.5)
        // 3-octave fbm averages ~0.44, so centre there to keep the ramp honest
        // clouds strengthen toward the bottom so the dark top stays calm
        const amp = 0.7 + 1.4 * (y / gh)
        const t = Math.max(0, Math.min(1, base + (v - 0.44) * amp))
        const [r, g, b] = rampRgb(stops, t)
        const i = (y * gw + x) * 4
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
    }
    lctx.putImageData(img, 0, 0)
  } else if (cfg.scene === "smoke") {
    // domain-warped fbm over a vertical dark→light bias: wispy smoke tendrils
    const stops = rampStops(cfg)
    const ns = (cfg.seed % 1013) * 0.917
    const tilt = (rand() - 0.5) * 0.6
    const warp = 1.2 + cfg.blobs * 0.35
    const freq = 1.6 + rand() * 1.2
    const ox = rand() * 10
    const oy = rand() * 10
    const img = lctx.createImageData(gw, gh)
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const px = x / gh
        const py = y / gh
        const qx = fbm2(px * freq + ox, py * freq + oy, 4, ns)
        const qy = fbm2(px * freq + ox + 5.2, py * freq + oy + 1.3, 4, ns + 7)
        const v = fbm2(px * freq + warp * qx, py * freq + warp * qy, 4, ns + 13)
        const base = 1.25 * (y / gh) - 0.45 + tilt * (x / gw - 0.5)
        const t = Math.max(0, Math.min(1, base + (v - 0.5) * 1.1))
        const [r, g, b] = rampRgb(stops, t)
        const i = (y * gw + x) * 4
        img.data[i] = r
        img.data[i + 1] = g
        img.data[i + 2] = b
        img.data[i + 3] = 255
      }
    }
    lctx.putImageData(img, 0, 0)
  } else if (cfg.scene === "blobs") {
    // shuffled then cycled, so every palette color appears at least once
    const colors = [...(cfg.colors.length ? cfg.colors : [cfg.bg])]
    for (let i = colors.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[colors[i], colors[j]] = [colors[j], colors[i]]
    }
    for (let i = 0; i < cfg.blobs; i++) {
      const x = rand() * gw
      const y = rand() * gh
      const r = (0.35 + rand() * 0.5) * Math.min(gw, gh)
      const [cr, cg, cb] = hexToRgb(colors[i % colors.length])
      const g = lctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.65 + rand() * 0.3})`)
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
      lctx.fillStyle = g
      lctx.fillRect(0, 0, gw, gh)
    }
  } else {
    // flow: tilted stacked wavy bands, blurred into smoke-like waves
    const stops = rampStops(cfg)
    const layers = cfg.blobs + 2
    const tilt = (rand() - 0.5) * 0.5
    const nseed = (cfg.seed % 1013) * 0.917
    lctx.save()
    lctx.translate(gw / 2, gh / 2)
    lctx.rotate(tilt)
    lctx.translate(-gw / 2, -gh / 2)
    const ext = gw * 0.5
    for (let i = 0; i < layers; i++) {
      const baseY = gh * (((i + 0.5) / layers) * 1.4 - 0.2)
      const amp = gh * (0.1 + rand() * 0.25)
      const freq = 1 + rand() * 2
      const phase = rand() * 20
      const [r, g, b] = rampRgb(stops, rand())
      lctx.fillStyle = `rgba(${r},${g},${b},0.9)`
      lctx.beginPath()
      lctx.moveTo(-ext, gh * 2)
      for (let x = -ext; x <= gw + ext; x += 2) {
        lctx.lineTo(x, baseY + fbm((x / gw) * freq + phase, 3, nseed + i * 7.3) * amp)
      }
      lctx.lineTo(gw + ext, gh * 2)
      lctx.closePath()
      lctx.fill()
    }
    lctx.restore()
  }

  // two-stage upscale to avoid bilinear diamond artifacts
  const mid = makeCanvas(256, Math.max(8, Math.round((256 * h) / w)))
  const mctx = mid.getContext("2d")!
  mctx.imageSmoothingEnabled = true
  mctx.imageSmoothingQuality = "high"
  mctx.drawImage(low, 0, 0, mid.width, mid.height)

  const full = makeCanvas(w, h)
  const fctx = full.getContext("2d")!
  fctx.imageSmoothingEnabled = true
  fctx.imageSmoothingQuality = "high"
  fctx.drawImage(mid, 0, 0, w, h)
  return full
}

// --- crisp scenes (WLLPR-style layered shapes) ------------------------------

type SceneCtx = {
  ctx: CanvasRenderingContext2D
  w: number
  h: number
  stops: string[]
  rng: () => number
  nseed: number
  complexity: number
  seed: number
}

function drawPine(ctx: CanvasRenderingContext2D, x: number, baseY: number, ht: number) {
  const wd = ht * 0.55
  ctx.fillRect(x - wd * 0.06, baseY - ht * 0.12, wd * 0.12, ht * 0.12)
  for (let k = 0; k < 3; k++) {
    const top = baseY - ht + k * ht * 0.22
    const half = wd * (0.28 + k * 0.2)
    const bot = top + ht * 0.45
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x - half, bot)
    ctx.lineTo(x + half, bot)
    ctx.closePath()
    ctx.fill()
  }
}

function drawHills(s: SceneCtx) {
  const { ctx, w, h, stops, nseed } = s
  const layers = Math.max(3, s.complexity)
  const step = Math.max(2, w / 160)
  for (let i = 0; i < layers; i++) {
    const t = (i + 1) / layers
    const baseY = h * (0.42 + (i / layers) * 0.5)
    const amp = h * (i < 2 ? 0.13 : 0.06)
    const freq = i < 2 ? 3 : 1.8
    ctx.fillStyle = rampColor(stops, 0.2 + t * 0.78)
    const ridge: number[][] = []
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= w + step; x += step) {
      const y = baseY + fbm((x / w) * freq + i * 4.7, 5, nseed) * amp
      ridge.push([x, y])
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()

    if (i >= 1) {
      // own rng per layer so tree count can't shift other layers' randomness
      const tRng = mulberry32(s.seed + i * 101)
      const ht = Math.min(w, h) * (0.045 + i * 0.008)
      for (let x = ht * 0.4; x <= w; x += ht * (0.5 + tRng() * 0.5)) {
        const idx = Math.min(ridge.length - 1, Math.floor(x / step))
        const y = ridge[idx][1] + ht * 0.08
        if (y > h) continue
        drawPine(ctx, x + (tRng() - 0.5) * ht * 0.3, y, ht * (0.8 + tRng() * 0.5))
      }
    }
  }
}

function drawWave(s: SceneCtx) {
  const { ctx, w, h, stops, rng, nseed } = s
  const layers = s.complexity + 5
  const centerX = w * (0.35 + rng() * 0.3)
  const baseY = h * (0.72 + rng() * 0.1)
  for (let i = layers; i >= 0; i--) {
    const t = i / layers
    const spread = h * (0.8 + t * 1.8)
    const peakH = h * (0.06 + t * 0.32)
    const skew = (rng() - 0.5) * 0.25
    ctx.fillStyle = rampColor(stops, 0.12 + (1 - t) * 0.82)
    ctx.beginPath()
    ctx.moveTo(0, h)
    const steps = 140
    for (let sx = 0; sx <= steps; sx++) {
      const x = (sx / steps) * w
      const dist = (x - centerX) / spread
      const bell = Math.exp(-dist * dist * 0.4) * (1 + skew * dist)
      const micro = fbm((x / h) * 2 + i * 1.4, 3, nseed) * h * 0.008
      ctx.lineTo(x, baseY - bell * peakH + micro)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
}

function drawDunes(s: SceneCtx) {
  const { ctx, w, h, stops, rng, nseed } = s
  const layers = s.complexity + 4
  for (let i = 0; i < layers; i++) {
    const t = (i + 1) / layers
    const baseY = h * (0.5 + t * 0.42)
    const freq = 0.5 + rng() * 0.8
    const phase = rng() * 10
    ctx.fillStyle = rampColor(stops, 0.15 + t * 0.8)
    ctx.beginPath()
    ctx.moveTo(0, h)
    const steps = 160
    for (let sx = 0; sx <= steps; sx++) {
      const x = (sx / steps) * w
      const nx = x / h
      const y =
        baseY +
        Math.sin(nx * Math.PI * freq + phase) * h * 0.05 +
        fbm(nx * 0.8 + i * 2.1, 3, nseed) * h * 0.05
      ctx.lineTo(x, y)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
}

function drawMountains(s: SceneCtx) {
  const { ctx, w, h, stops, rng, nseed } = s
  const layers = Math.max(3, s.complexity)
  for (let i = 0; i < layers; i++) {
    const t = (i + 1) / layers
    const baseY = h * (0.5 + t * 0.42)
    const peaks = []
    for (let p = 0; p < 2 + Math.floor(rng() * 2); p++) {
      peaks.push({
        cx: w * (0.1 + rng() * 0.8),
        peakH: h * (0.1 + rng() * 0.16) * (1 - i * 0.07),
        width: h * (0.5 + rng() * 0.6),
        sharp: 1.3 + rng() * 0.4,
      })
    }
    ctx.fillStyle = rampColor(stops, 0.15 + t * 0.8)
    ctx.beginPath()
    ctx.moveTo(0, h)
    const steps = 200
    for (let sx = 0; sx <= steps; sx++) {
      const x = (sx / steps) * w
      let y = baseY
      for (const p of peaks) {
        const dist = Math.abs(x - p.cx)
        if (dist < p.width) {
          y = Math.min(y, baseY - Math.pow(1 - dist / p.width, p.sharp) * p.peakH)
        }
      }
      ctx.lineTo(x, y + fbm((x / h) * 1.5 + i * 2.3, 3, nseed) * h * 0.008)
    }
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fill()
  }
}

function drawArcs(s: SceneCtx) {
  const { ctx, w, h, stops, rng } = s
  const rings = s.complexity * 2 + 8
  const originX = w * (0.4 + rng() * 0.2)
  const originY = h * 1.5
  const maxR = h * 1.05
  for (let i = rings; i >= 0; i--) {
    const t = i / rings
    ctx.fillStyle = rampColor(stops, 0.1 + (1 - t) * 0.85)
    ctx.beginPath()
    ctx.arc(originX, originY, maxR * t, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawScribble(s: SceneCtx) {
  const { ctx, w, h, stops, rng } = s
  const strokes = s.complexity * 2 + 6
  ctx.lineCap = "round"
  for (let i = 0; i < strokes; i++) {
    const t = i / strokes
    ctx.strokeStyle = rampColor(stops, 0.2 + t * 0.75)
    ctx.lineWidth = (0.5 + rng() * 3) * (w / 1080) * 2
    ctx.beginPath()
    let x = w * rng()
    let y = h * (0.5 + rng() * 0.5)
    ctx.moveTo(x, y)
    for (let j = 0; j < 10; j++) {
      x += (rng() - 0.5) * w
      y += (rng() - 0.4) * h * 0.2
      ctx.bezierCurveTo(w * rng(), h * (0.5 + rng() * 0.5), w * rng(), h * (0.5 + rng() * 0.5), x, y)
    }
    ctx.stroke()
  }
}

function renderScene(cfg: WallpaperConfig, w: number, h: number): HTMLCanvasElement {
  if (cfg.scene === "mist" || cfg.scene === "smoke" || cfg.scene === "blobs" || cfg.scene === "flow")
    return softField(cfg, w, h)

  const c = makeCanvas(w, h)
  const ctx = c.getContext("2d")!
  ctx.fillStyle = cfg.bg
  ctx.fillRect(0, 0, w, h)
  const s: SceneCtx = {
    ctx,
    w,
    h,
    stops: rampStops(cfg),
    rng: mulberry32(cfg.seed),
    nseed: (cfg.seed % 1013) * 0.917,
    complexity: cfg.blobs,
    seed: cfg.seed,
  }
  switch (cfg.scene) {
    case "hills": drawHills(s); break
    case "wave": drawWave(s); break
    case "dunes": drawDunes(s); break
    case "mountains": drawMountains(s); break
    case "arcs": drawArcs(s); break
    case "scribble": drawScribble(s); break
  }
  return c
}

// --- texture + grain over the scene -----------------------------------------

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

/** the texture pitch, in output pixels, of a w-pixel-wide render — what the PNG actually uses */
export const exportCellPx = (cell: number, w: number) => Math.max(2, Math.round((cell * w) / 1080))

export interface RenderOptions {
  /** texture pitch in px at this canvas size (may be fractional); default `exportCellPx(cfg.cell, w)` */
  cellPx?: number
  /** run the grain pass (default true); previews apply it after downscaling instead */
  grain?: boolean
}

export function renderWallpaper(
  target: HTMLCanvasElement,
  cfg: WallpaperConfig,
  w: number,
  h: number,
  opts: RenderOptions = {}
) {
  target.width = w
  target.height = h
  const ctx = target.getContext("2d")!
  const cellpx = opts.cellPx ?? exportCellPx(cfg.cell, w)
  const grad = renderScene(cfg, w, h)

  if (cfg.pattern === "smooth") {
    ctx.drawImage(grad, 0, 0)
  } else if (cfg.pattern === "bayer") {
    const px = cellpx
    const pw = Math.max(1, Math.round(w / px))
    const ph = Math.max(1, Math.round(h / px))
    const small = makeCanvas(pw, ph)
    const sctx = small.getContext("2d")!
    sctx.imageSmoothingEnabled = true
    sctx.drawImage(grad, 0, 0, pw, ph)
    const img = sctx.getImageData(0, 0, pw, ph)
    const d = img.data
    const levels = 5
    const step = 255 / (levels - 1)
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const i = (y * pw + x) * 4
        const t = (BAYER8[y % 8][x % 8] + 0.5) / 64 - 0.5
        for (let c = 0; c < 3; c++) {
          const v = d[i + c] + t * step
          d[i + c] = Math.max(0, Math.min(255, Math.round(v / step) * step))
        }
      }
    }
    sctx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, w, h)
  } else if (cfg.pattern === "softdots") {
    // LED-matrix dots: the gaps darken the local color by a fixed ratio
    // instead of using one gap color, so the grid fades out in the shadows and
    // reads gently in the highlights (a translucent black tile = multiply).
    // The tile is drawn at the final cell size: downscaling a big tile smears
    // the gap into the dot and darkens the whole image.
    ctx.drawImage(grad, 0, 0)
    // fractional pitches (previews only) draw an integer tile and scale it
    const size = Math.max(2, Math.ceil(cellpx))
    const tile = makeCanvas(size, size)
    const tctx = tile.getContext("2d")!
    tctx.fillStyle = "rgba(0,0,0,0.32)"
    tctx.fillRect(0, 0, size, size)
    tctx.globalCompositeOperation = "destination-out"
    tctx.beginPath()
    tctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2)
    tctx.fill()
    const pat = ctx.createPattern(tile, "repeat")!
    if (size !== cellpx) pat.setTransform(new DOMMatrix().scale(cellpx / size))
    ctx.fillStyle = pat
    ctx.fillRect(0, 0, w, h)
  } else {
    // grid / dots: gradient with a repeating mask tile on top. The tile is
    // authored at high res and scaled via pattern transform, so gap
    // proportions stay identical between preview and export sizes.
    ctx.drawImage(grad, 0, 0)
    const gapColor = shade(cfg.bg, isLight(cfg.bg) ? 0.35 : -0.55)
    const TILE = 32
    const tile = makeCanvas(TILE, TILE)
    const tctx = tile.getContext("2d")!
    tctx.fillStyle = gapColor
    tctx.fillRect(0, 0, TILE, TILE)
    tctx.globalCompositeOperation = "destination-out"
    if (cfg.pattern === "dots") {
      tctx.beginPath()
      tctx.arc(TILE / 2, TILE / 2, TILE * 0.4, 0, Math.PI * 2)
      tctx.fill()
    } else {
      const gap = TILE * 0.22
      tctx.fillRect(gap / 2, gap / 2, TILE - gap, TILE - gap)
    }
    // integer cell size — fractional tiles beat against the pixel grid (moiré)
    const pat = ctx.createPattern(tile, "repeat")!
    pat.setTransform(new DOMMatrix().scale(cellpx / TILE))
    ctx.fillStyle = pat
    ctx.fillRect(0, 0, w, h)
  }

  if (opts.grain !== false) applyGrain(ctx, cfg, w, h)
}

/**
 * Film grain: per-pixel noise (a seeded 128px tile, overlay-blended), so it is
 * defined in output pixels. Previews apply it at display resolution, which is
 * how a native-resolution wallpaper reads on a screen.
 */
export function applyGrain(ctx: CanvasRenderingContext2D, cfg: WallpaperConfig, w: number, h: number) {
  if (cfg.grain <= 0) return
  const rand = mulberry32(cfg.seed ^ 0x9e3779b9)
  const tile = makeCanvas(128, 128)
  const tctx = tile.getContext("2d")!
  const img = tctx.createImageData(128, 128)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(rand() * 256)
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v
    img.data[i + 3] = 255
  }
  tctx.putImageData(img, 0, 0)
  ctx.globalAlpha = cfg.grain * 0.35
  ctx.globalCompositeOperation = "overlay"
  ctx.fillStyle = ctx.createPattern(tile, "repeat")!
  ctx.fillRect(0, 0, w, h)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = "source-over"
}

/** pixel budget for one supersampled preview render */
const PREVIEW_BUDGET = 6_000_000

/**
 * Draw a w×h (device pixel) preview of an outW×outH export so the texture
 * reads like the download scaled to fit: the scene and texture are rendered in
 * export proportions at an integer texture pitch, supersampled when the pitch
 * is small on screen, then filtered down (no CSS downscaling, so no moiré).
 * `draft` skips the supersample for fast feedback while dragging.
 */
export function renderPreview(
  target: HTMLCanvasElement,
  cfg: WallpaperConfig,
  outW: number,
  outH: number,
  w: number,
  h: number,
  draft = false
) {
  const cellOut = exportCellPx(cfg.cell, outW)
  const shown = (cellOut * w) / outW // texture pitch on screen, in device px
  if (draft || cfg.pattern === "smooth") {
    renderWallpaper(target, cfg, w, h, { cellPx: shown })
    return
  }
  // an integer pitch m at a render width ≥ 1–2× the display, never past export size
  let m = Math.max(2, Math.ceil(shown * (shown < 8 ? 2 : 1)))
  let rw = Math.round((m * outW) / cellOut)
  while (m > 2 && rw * ((rw * outH) / outW) > PREVIEW_BUDGET) rw = Math.round((--m * outW) / cellOut)
  let cellPx = m
  if (rw >= outW) {
    rw = outW
    cellPx = cellOut
  }
  const rh = Math.max(1, Math.round((rw * outH) / outW))
  if (rw === w && rh === h) {
    renderWallpaper(target, cfg, w, h, { cellPx })
    return
  }
  let src = makeCanvas(rw, rh)
  renderWallpaper(src, cfg, rw, rh, { cellPx, grain: false })
  // halve until within 2× so each step averages its pixels (a box filter)
  while (src.width >= w * 2 && src.height >= h * 2) {
    const half = makeCanvas(Math.round(src.width / 2), Math.round(src.height / 2))
    const hctx = half.getContext("2d")!
    hctx.imageSmoothingEnabled = true
    hctx.imageSmoothingQuality = "high"
    hctx.drawImage(src, 0, 0, half.width, half.height)
    src = half
  }
  target.width = w
  target.height = h
  const ctx = target.getContext("2d")!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(src, 0, 0, w, h)
  applyGrain(ctx, cfg, w, h)
}

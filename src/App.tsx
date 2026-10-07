import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Dices, Download, Moon, Share2, Shuffle, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import {
  downloadPNG,
  PALETTES,
  renderWallpaper,
  RESOLUTIONS,
  SCENES,
  type Pattern,
  type Scene,
  type WallpaperConfig,
} from "@/lib/wallpaper"

const PATTERNS: { value: Pattern; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "dots", label: "Dots" },
  { value: "softdots", label: "Soft dots" },
  { value: "bayer", label: "Bayer dither" },
  { value: "smooth", label: "None" },
]

function randomConfig(): { cfg: WallpaperConfig; dark: boolean; paletteName: string } {
  const r = Math.random
  const p = PALETTES[Math.floor(r() * PALETTES.length)]
  const dark = r() < 0.6
  return {
    dark,
    paletteName: p.name,
    cfg: {
      seed: Math.floor(r() * 0xffffffff),
      scene: SCENES[Math.floor(r() * SCENES.length)].value,
      pattern: PATTERNS[Math.floor(r() * PATTERNS.length)].value,
      bg: dark ? p.darkBg : p.lightBg,
      colors: [...p.colors],
      cell: 2 + Math.floor(r() * 11),
      blobs: 2 + Math.floor(r() * 7),
      grain: Math.floor(r() * 9) * 0.05,
    },
  }
}

// The URL always mirrors the full config (see the replaceState effect), so any
// copied/shared link reproduces the exact wallpaper. ?random = randomized start.
const params = new URLSearchParams(window.location.search)
const initRandom = params.has("random") ? randomConfig() : null
const initPattern = PATTERNS.some((p) => p.value === params.get("pattern"))
  ? (params.get("pattern") as Pattern)
  : "grid"
const initScene = SCENES.some((s) => s.value === params.get("scene"))
  ? (params.get("scene") as Scene)
  : "smoke"
const initSeed = Number(params.get("seed")) || 20260716

const hexParam = (v: string | null) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : null)
const intParam = (v: string | null, min: number, max: number) => {
  const n = Number(v)
  return v !== null && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
}
const initDark = params.get("dark") === null ? true : params.get("dark") !== "0"
const initPaletteName = PALETTES.some((p) => p.name === params.get("pal"))
  ? (params.get("pal") as string)
  : PALETTES[0].name
const initP = PALETTES.find((p) => p.name === initPaletteName)!
const paramColors = params.get("colors")?.split(",").map(hexParam)
const initColors =
  paramColors && paramColors.length > 0 && paramColors.every(Boolean)
    ? (paramColors as string[])
    : [...initP.colors]
const initBg = hexParam(params.get("bg")) ?? (initDark ? initP.darkBg : initP.lightBg)
const initCell = intParam(params.get("cell"), 2, 12) ?? 8
const initBlobs = intParam(params.get("blobs"), 2, 8) ?? 5
const initGrain = (intParam(params.get("grain"), 0, 100) ?? 15) / 100
const initRes = intParam(params.get("res"), 0, RESOLUTIONS.length - 1) ?? 3

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/** resolves after the browser has painted the current state */
const nextPaint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))

/**
 * Copy what the preview currently shows into its ghost layer. If a crossfade
 * is still running, blend the incoming frame in at the ghost's live opacity so
 * rapid regenerations hand off seamlessly instead of snapping.
 */
function snapshotInto(ghost: HTMLCanvasElement, main: HTMLCanvasElement) {
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
function liftAway(ghost: HTMLCanvasElement) {
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

/** keyed on value so each change ticks in, direction-aware for numbers */
function Ticker({ value, dir }: { value: string | number; dir?: "up" | "down" }) {
  return (
    <span key={value} className="tick tabular-nums" data-dir={dir}>
      {value}
    </span>
  )
}

function useDir(value: number) {
  const prev = useRef(value)
  const dir = useRef<"up" | "down">("up")
  if (value !== prev.current) {
    dir.current = value > prev.current ? "up" : "down"
    prev.current = value
  }
  return dir.current
}

function CheckDraw() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="check-draw pop-in"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" pathLength={1} />
    </svg>
  )
}

/** shared selection ring: snaps in from slightly larger, transform/opacity only */
const pickerClass = (selected: boolean) =>
  cn(
    "relative rounded-lg transition-[opacity,transform] motion-ui hover:-translate-y-0.5 active:scale-[0.96] active:duration-(--dur-fast)",
    "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-[calc(var(--radius-lg)+3px)] after:border-2 after:border-primary after:transition-[opacity,transform] after:duration-(--dur) after:ease-(--ease-out)",
    selected
      ? "after:scale-100 after:opacity-100"
      : "opacity-70 after:scale-[1.08] after:opacity-0 hover:opacity-100"
  )

/** live-rendered mini preview used as a picker button */
function Thumb({
  bg,
  colors,
  scene,
  pattern,
  selected,
  title,
  onClick,
}: {
  bg: string
  colors: string[]
  scene: Scene
  pattern: Pattern
  selected: boolean
  title: string
  onClick: () => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!ref.current) return
    renderWallpaper(
      ref.current,
      { seed: 7, scene, pattern, bg, colors, cell: 40, blobs: 5, grain: 0 },
      96,
      72
    )
  }, [bg, colors, scene, pattern])
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={selected}
      className={pickerClass(selected)}
    >
      <canvas ref={ref} className="block h-14 w-full rounded-lg border" />
    </button>
  )
}

export default function App() {
  const portraitRef = useRef<HTMLCanvasElement>(null)
  const landscapeRef = useRef<HTMLCanvasElement>(null)
  const [paletteName, setPaletteName] = useState(initRandom?.paletteName ?? initPaletteName)
  const [dark, setDark] = useState(initRandom?.dark ?? initDark)
  const [resIdx, setResIdx] = useState(initRes)
  const [exporting, setExporting] = useState<"portrait" | "landscape" | null>(null)
  const [copied, setCopied] = useState(false)
  const [cfg, setCfg] = useState<WallpaperConfig>(
    initRandom?.cfg ?? {
      seed: initSeed,
      scene: initScene,
      pattern: initPattern,
      bg: initBg,
      colors: initColors,
      cell: initCell,
      blobs: initBlobs,
      grain: initGrain,
    }
  )
  const res = RESOLUTIONS[resIdx]
  const portraitGhostRef = useRef<HTMLCanvasElement>(null)
  const landscapeGhostRef = useRef<HTMLCanvasElement>(null)
  // discrete changes (scene, palette, variation…) crossfade; continuous ones
  // (slider drags, color pickers) swap instantly so they track the pointer
  const fadeNext = useRef(false)
  const variationIcon = useRef<SVGSVGElement>(null)
  const shuffleIcon = useRef<SVGSVGElement>(null)
  const [saved, setSaved] = useState<"portrait" | "landscape" | null>(null)
  const cellDir = useDir(cfg.cell)
  const blobsDir = useDir(cfg.blobs)
  const grainDir = useDir(cfg.grain)

  const update = (fn: (c: WallpaperConfig) => WallpaperConfig) => {
    fadeNext.current = true
    setCfg(fn)
  }

  const spin = (el: SVGSVGElement | null, turn: number) => {
    if (!el || reducedMotion()) return
    el.animate([{ transform: "rotate(0)" }, { transform: `rotate(${turn}deg)` }], {
      duration: 600,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    })
  }

  useEffect(() => {
    const fade = fadeNext.current && !reducedMotion()
    fadeNext.current = false
    const views = [
      [portraitRef.current, portraitGhostRef.current, 480, 853],
      [landscapeRef.current, landscapeGhostRef.current, 853, 480],
    ] as const
    for (const [main, ghost, w, h] of views) {
      if (!main) continue
      if (fade && ghost) snapshotInto(ghost, main)
      renderWallpaper(main, cfg, w, h)
      if (fade && ghost) liftAway(ghost)
    }
  }, [cfg])

  // keep the address bar share-ready: the URL always encodes the current wallpaper
  useEffect(() => {
    const q = new URLSearchParams({
      scene: cfg.scene,
      pattern: cfg.pattern,
      seed: String(cfg.seed),
      bg: cfg.bg.replace("#", ""),
      colors: cfg.colors.map((c) => c.replace("#", "")).join(","),
      cell: String(cfg.cell),
      blobs: String(cfg.blobs),
      grain: String(Math.round(cfg.grain * 100)),
      dark: dark ? "1" : "0",
      pal: paletteName,
      res: String(resIdx),
    })
    window.history.replaceState(null, "", `?${q.toString()}`)
  }, [cfg, dark, paletteName, resIdx])

  const onShare = async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: "wallgen", text: "My wallpaper — open to tweak & download:", url })
        return
      } catch {
        return // user closed the share sheet
      }
    }
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const applyPalette = (name: string, isDark: boolean) => {
    const p = PALETTES.find((p) => p.name === name)!
    setPaletteName(name)
    update((c) => ({ ...c, bg: isDark ? p.darkBg : p.lightBg, colors: [...p.colors] }))
  }

  const setColor = (i: number, value: string) =>
    setCfg((c) => {
      const colors = [...c.colors]
      colors[i] = value
      return { ...c, colors }
    })

  const onDownload = async (orientation: "portrait" | "landscape") => {
    setExporting(orientation)
    setSaved(null)
    try {
      // let the "Rendering…" shimmer paint first; it runs on the compositor,
      // so it keeps moving while the main thread renders the full-size PNG
      await nextPaint()
      const w = orientation === "portrait" ? res.h : res.w
      const h = orientation === "portrait" ? res.w : res.h
      await downloadPNG(cfg, w, h)
      setSaved(orientation)
      setTimeout(() => setSaved((s) => (s === orientation ? null : s)), 1800)
    } finally {
      setExporting(null)
    }
  }

  const downloadLabel = (o: "portrait" | "landscape", label: string) => {
    if (exporting === o) return <><Download /> Rendering…</>
    if (saved === o) return <><CheckDraw /> Saved</>
    return <><Download /> {label}</>
  }

  return (
    <div className="dark flex h-svh flex-col overflow-hidden bg-background text-foreground md:h-auto md:min-h-svh md:overflow-visible">
      <header className="enter-rise shrink-0 px-6 py-3 text-center md:pb-2 md:pt-8" style={{ "--i": -2 } as CSSProperties}>
        <h1 className="text-lg font-bold uppercase tracking-[0.35em] md:text-2xl">wallgen</h1>
        <p className="mt-0.5 text-xs tracking-wide text-muted-foreground md:mt-1 md:text-sm">
          generate your dithered wallpaper
        </p>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:mx-auto md:w-full md:max-w-6xl md:flex-row md:items-start md:justify-center md:gap-8 md:p-6">
        {/* previews: swipeable pages on mobile, side-by-side on desktop */}
        <div className="min-h-0 flex-1 md:sticky md:top-0 md:flex md:h-svh md:items-center md:justify-center md:py-6">
          <div className="flex h-full snap-x snap-mandatory items-center gap-3 overflow-x-auto px-4 pb-1 md:h-auto md:w-full md:snap-none md:items-center md:justify-center md:gap-6 md:overflow-visible md:px-0">
            <figure style={{ "--i": 1 } as CSSProperties} className="enter-settle flex h-full w-[calc(100vw-3rem)] shrink-0 snap-center flex-col items-center gap-2 md:h-auto md:w-auto md:min-w-0 md:flex-1 md:shrink">
              <div className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center md:flex-none">
                <canvas
                  ref={portraitRef}
                  width={480}
                  height={853}
                  className="h-auto max-h-full w-auto max-w-full rounded-xl border shadow-2xl [grid-area:1/1] md:max-h-[62svh]"
                />
                {/* previous frame, faded out over the new one on discrete changes */}
                <canvas
                  ref={portraitGhostRef}
                  width={480}
                  height={853}
                  aria-hidden
                  className="pointer-events-none h-auto max-h-full w-auto max-w-full rounded-xl border opacity-0 [grid-area:1/1] md:max-h-[62svh]"
                />
              </div>
              <figcaption className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                Portrait
              </figcaption>
            </figure>
            <figure className="enter-settle flex h-full w-[calc(100vw-3rem)] shrink-0 snap-center flex-col items-center gap-2 md:order-first md:h-auto md:w-auto md:min-w-0 md:flex-[1.7] md:shrink">
              <div className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] place-items-center md:flex-none">
                <canvas
                  ref={landscapeRef}
                  width={853}
                  height={480}
                  className="h-auto max-h-full w-auto max-w-full rounded-xl border shadow-2xl [grid-area:1/1] md:w-full"
                />
                {/* previous frame, faded out over the new one on discrete changes */}
                <canvas
                  ref={landscapeGhostRef}
                  width={853}
                  height={480}
                  aria-hidden
                  className="pointer-events-none h-auto max-h-full w-auto max-w-full rounded-xl border opacity-0 [grid-area:1/1] md:w-full"
                />
              </div>
              <figcaption className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                Landscape
              </figcaption>
            </figure>
          </div>
        </div>

        {/* controls: bottom sheet on mobile, sidebar on desktop */}
        <aside className="z-10 flex h-[52svh] w-full shrink-0 flex-col gap-6 overflow-y-auto rounded-t-2xl border-t bg-background px-5 pb-10 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] md:h-auto md:max-w-sm md:gap-6 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:px-0 md:pb-0 md:shadow-none">
          <div className="sticky top-0 z-10 -mx-5 flex shrink-0 justify-center bg-background pb-2 pt-2.5 md:hidden">
            <div className="h-1.5 w-10 rounded-full bg-muted" />
          </div>

          <div style={{ "--i": 1 } as CSSProperties} className="enter-rise grid gap-2 md:mt-0 -mt-3">
            <div className="flex justify-between">
              <Label>Scene</Label>
              <span className="text-xs text-muted-foreground">
                <Ticker value={SCENES.find((s) => s.value === cfg.scene)?.label ?? ""} />
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {SCENES.map((s) => (
                <Thumb
                  key={s.value}
                  bg={cfg.bg}
                  colors={cfg.colors}
                  scene={s.value}
                  pattern="smooth"
                  selected={cfg.scene === s.value}
                  title={s.label}
                  onClick={() => update((c) => ({ ...c, scene: s.value }))}
                />
              ))}
            </div>
          </div>

          <div style={{ "--i": 2 } as CSSProperties} className="enter-rise grid gap-2">
            <div className="flex justify-between">
              <Label>Texture</Label>
              <span className="text-xs text-muted-foreground">
                <Ticker value={PATTERNS.find((p) => p.value === cfg.pattern)?.label ?? ""} />
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PATTERNS.map((p) => (
                <Thumb
                  key={p.value}
                  bg={cfg.bg}
                  colors={cfg.colors}
                  scene="blobs"
                  pattern={p.value}
                  selected={cfg.pattern === p.value}
                  title={p.label}
                  onClick={() => update((c) => ({ ...c, pattern: p.value }))}
                />
              ))}
            </div>
          </div>

          <div style={{ "--i": 3 } as CSSProperties} className="enter-rise grid gap-2">
            <div className="flex justify-between">
              <Label>Palette</Label>
              <span className="text-xs text-muted-foreground">
                <Ticker value={paletteName} />
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PALETTES.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  title={p.name}
                  onClick={() => applyPalette(p.name, dark)}
                  aria-pressed={paletteName === p.name}
                  className={pickerClass(paletteName === p.name)}
                >
                  <span className="flex h-9 overflow-hidden rounded-lg border">
                    <span className="flex-1" style={{ background: dark ? p.darkBg : p.lightBg }} />
                    {p.colors.map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ "--i": 4 } as CSSProperties} className="enter-rise grid gap-2">
            <Label>Mode</Label>
            <div className="relative grid grid-cols-2 gap-1 rounded-lg border p-1">
              {/* sliding pill: one element translated between the halves */}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-y-1 left-1 w-[calc(50%-0.375rem)] rounded-md bg-primary transition-transform duration-(--dur-slow) ease-(--ease-out)",
                  !dark && "translate-x-[calc(100%+0.25rem)]"
                )}
              />
              <button
                type="button"
                onClick={() => {
                  setDark(true)
                  applyPalette(paletteName, true)
                }}
                className={cn(
                  "relative flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-[color,transform] motion-ui active:scale-[0.97]",
                  dark ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Moon className="size-3.5" /> Dark
              </button>
              <button
                type="button"
                onClick={() => {
                  setDark(false)
                  applyPalette(paletteName, false)
                }}
                className={cn(
                  "relative flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-[color,transform] motion-ui active:scale-[0.97]",
                  !dark ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Sun className="size-3.5" /> Light
              </button>
            </div>
          </div>

          <div style={{ "--i": 5 } as CSSProperties} className="enter-rise grid gap-2">
            <Label>Colors</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                title="Background"
                value={cfg.bg}
                onChange={(e) => setCfg((c) => ({ ...c, bg: e.target.value }))}
                className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
              />
              <span className="text-xs text-muted-foreground">bg</span>
              {cfg.colors.map((color, i) => (
                <input
                  key={i}
                  type="color"
                  value={color}
                  onChange={(e) => setColor(i, e.target.value)}
                  className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
                />
              ))}
            </div>
          </div>

          <div style={{ "--i": 6 } as CSSProperties} className="enter-rise grid gap-2">
            <div className="flex justify-between">
              <Label>Texture size</Label>
              <span className="text-xs text-muted-foreground">
                <Ticker value={cfg.cell} dir={cellDir} />px
              </span>
            </div>
            <Slider
              min={2}
              max={12}
              step={1}
              value={[cfg.cell]}
              onValueChange={([v]) => setCfg((c) => ({ ...c, cell: v }))}
              disabled={cfg.pattern === "smooth"}
            />
          </div>

          <div style={{ "--i": 7 } as CSSProperties} className="enter-rise grid gap-2">
            <div className="flex justify-between">
              <Label>Complexity</Label>
              <span className="text-xs text-muted-foreground">
                <Ticker value={cfg.blobs} dir={blobsDir} />
              </span>
            </div>
            <Slider
              min={2}
              max={8}
              step={1}
              value={[cfg.blobs]}
              onValueChange={([v]) => setCfg((c) => ({ ...c, blobs: v }))}
            />
          </div>

          <div style={{ "--i": 8 } as CSSProperties} className="enter-rise grid gap-2">
            <div className="flex justify-between">
              <Label>Grain</Label>
              <span className="text-xs text-muted-foreground">
                <Ticker value={Math.round(cfg.grain * 100)} dir={grainDir} />%
              </span>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[Math.round(cfg.grain * 100)]}
              onValueChange={([v]) => setCfg((c) => ({ ...c, grain: v / 100 }))}
            />
          </div>

          <div style={{ "--i": 9 } as CSSProperties} className="enter-rise grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                spin(variationIcon.current, 360)
                update((c) => ({ ...c, seed: Math.floor(Math.random() * 0xffffffff) }))
              }}
            >
              <Dices ref={variationIcon} /> Variation
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                spin(shuffleIcon.current, 360)
                const r = randomConfig()
                setDark(r.dark)
                setPaletteName(r.paletteName)
                update(() => r.cfg)
              }}
            >
              <Shuffle ref={shuffleIcon} /> Random all
            </Button>
          </div>

          <div style={{ "--i": 10 } as CSSProperties} className="enter-rise grid gap-2">
            <Label>Export</Label>
            <Select value={String(resIdx)} onValueChange={(v) => setResIdx(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              {/* portalled outside the .dark root, so opt back into the dark tokens */}
              <SelectContent className="dark">
                {RESOLUTIONS.map((r, i) => (
                  <SelectItem key={r.name} value={String(i)}>
                    {r.name} — {r.w}×{r.h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={() => onDownload("portrait")}
                disabled={exporting !== null}
                className={cn(exporting === "portrait" && "shimmer relative overflow-hidden disabled:opacity-100")}
              >
                {downloadLabel("portrait", "Portrait")}
              </Button>
              <Button
                onClick={() => onDownload("landscape")}
                disabled={exporting !== null}
                className={cn(exporting === "landscape" && "shimmer relative overflow-hidden disabled:opacity-100")}
              >
                {downloadLabel("landscape", "Landscape")}
              </Button>
            </div>
            <Button variant="outline" onClick={onShare}>
              {copied ? (
                <>
                  <CheckDraw /> Link copied!
                </>
              ) : (
                <>
                  <Share2 /> Share this wallpaper
                </>
              )}
            </Button>
          </div>
        </aside>
      </main>
    </div>
  )
}

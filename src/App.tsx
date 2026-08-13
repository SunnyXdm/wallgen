import { useEffect, useRef, useState } from "react"
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
      className={cn(
        "overflow-hidden rounded-lg border transition-all",
        selected
          ? "border-primary ring-2 ring-primary"
          : "opacity-70 hover:opacity-100"
      )}
    >
      <canvas ref={ref} className="block h-14 w-full" />
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

  useEffect(() => {
    if (portraitRef.current) renderWallpaper(portraitRef.current, cfg, 480, 853)
    if (landscapeRef.current) renderWallpaper(landscapeRef.current, cfg, 853, 480)
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
    setCfg((c) => ({ ...c, bg: isDark ? p.darkBg : p.lightBg, colors: [...p.colors] }))
  }

  const setColor = (i: number, value: string) =>
    setCfg((c) => {
      const colors = [...c.colors]
      colors[i] = value
      return { ...c, colors }
    })

  const onDownload = async (orientation: "portrait" | "landscape") => {
    setExporting(orientation)
    try {
      const w = orientation === "portrait" ? res.h : res.w
      const h = orientation === "portrait" ? res.w : res.h
      await downloadPNG(cfg, w, h)
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="dark flex h-svh flex-col overflow-hidden bg-background text-foreground md:h-auto md:min-h-svh md:overflow-visible">
      <header className="shrink-0 px-6 py-3 text-center md:pb-2 md:pt-8">
        <h1 className="text-lg font-bold uppercase tracking-[0.35em] md:text-2xl">wallgen</h1>
        <p className="mt-0.5 text-xs tracking-wide text-muted-foreground md:mt-1 md:text-sm">
          generate your dithered wallpaper
        </p>
      </header>

      <main className="flex min-h-0 flex-1 flex-col md:mx-auto md:w-full md:max-w-6xl md:flex-row md:items-start md:justify-center md:gap-8 md:p-6">
        {/* previews: swipeable pages on mobile, side-by-side on desktop */}
        <div className="min-h-0 flex-1 md:sticky md:top-0 md:flex md:h-svh md:items-center md:justify-center md:py-6">
          <div className="flex h-full snap-x snap-mandatory items-center gap-3 overflow-x-auto px-4 pb-1 md:h-auto md:w-full md:snap-none md:items-center md:justify-center md:gap-6 md:overflow-visible md:px-0">
            <figure className="flex h-full w-[calc(100vw-3rem)] shrink-0 snap-center flex-col items-center gap-2 md:h-auto md:w-auto md:min-w-0 md:flex-1 md:shrink">
              <div className="flex min-h-0 w-full flex-1 items-center justify-center md:flex-none">
                <canvas
                  ref={portraitRef}
                  className="h-auto max-h-full w-auto max-w-full rounded-xl border shadow-2xl md:max-h-[62svh]"
                />
              </div>
              <figcaption className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
                Portrait
              </figcaption>
            </figure>
            <figure className="flex h-full w-[calc(100vw-3rem)] shrink-0 snap-center flex-col items-center gap-2 md:order-first md:h-auto md:w-auto md:min-w-0 md:flex-[1.7] md:shrink">
              <div className="flex min-h-0 w-full flex-1 items-center justify-center md:flex-none">
                <canvas
                  ref={landscapeRef}
                  className="h-auto max-h-full w-auto max-w-full rounded-xl border shadow-2xl md:w-full"
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

          <div className="grid gap-2 md:mt-0 -mt-3">
            <div className="flex justify-between">
              <Label>Scene</Label>
              <span className="text-xs text-muted-foreground">
                {SCENES.find((s) => s.value === cfg.scene)?.label}
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
                  onClick={() => setCfg((c) => ({ ...c, scene: s.value }))}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex justify-between">
              <Label>Texture</Label>
              <span className="text-xs text-muted-foreground">
                {PATTERNS.find((p) => p.value === cfg.pattern)?.label}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {PATTERNS.map((p) => (
                <Thumb
                  key={p.value}
                  bg={cfg.bg}
                  colors={cfg.colors}
                  scene="blobs"
                  pattern={p.value}
                  selected={cfg.pattern === p.value}
                  title={p.label}
                  onClick={() => setCfg((c) => ({ ...c, pattern: p.value }))}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex justify-between">
              <Label>Palette</Label>
              <span className="text-xs text-muted-foreground">{paletteName}</span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {PALETTES.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  title={p.name}
                  onClick={() => applyPalette(p.name, dark)}
                  className={cn(
                    "flex h-9 overflow-hidden rounded-md border transition-all",
                    paletteName === p.name
                      ? "border-primary ring-2 ring-primary"
                      : "opacity-70 hover:opacity-100"
                  )}
                >
                  <span className="flex-1" style={{ background: dark ? p.darkBg : p.lightBg }} />
                  {p.colors.map((c) => (
                    <span key={c} className="flex-1" style={{ background: c }} />
                  ))}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Mode</Label>
            <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
              <button
                type="button"
                onClick={() => {
                  setDark(true)
                  applyPalette(paletteName, true)
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors",
                  dark ? "bg-primary text-primary-foreground" : "text-muted-foreground"
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
                  "flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors",
                  !dark ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                )}
              >
                <Sun className="size-3.5" /> Light
              </button>
            </div>
          </div>

          <div className="grid gap-2">
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

          <div className="grid gap-2">
            <div className="flex justify-between">
              <Label>Texture size</Label>
              <span className="text-xs text-muted-foreground">{cfg.cell}px</span>
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

          <div className="grid gap-2">
            <div className="flex justify-between">
              <Label>Complexity</Label>
              <span className="text-xs text-muted-foreground">{cfg.blobs}</span>
            </div>
            <Slider
              min={2}
              max={8}
              step={1}
              value={[cfg.blobs]}
              onValueChange={([v]) => setCfg((c) => ({ ...c, blobs: v }))}
            />
          </div>

          <div className="grid gap-2">
            <div className="flex justify-between">
              <Label>Grain</Label>
              <span className="text-xs text-muted-foreground">
                {Math.round(cfg.grain * 100)}%
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

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                setCfg((c) => ({ ...c, seed: Math.floor(Math.random() * 0xffffffff) }))
              }
            >
              <Dices /> Variation
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const r = randomConfig()
                setDark(r.dark)
                setPaletteName(r.paletteName)
                setCfg(r.cfg)
              }}
            >
              <Shuffle /> Random all
            </Button>
          </div>

          <div className="grid gap-2">
            <Label>Export</Label>
            <Select value={String(resIdx)} onValueChange={(v) => setResIdx(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOLUTIONS.map((r, i) => (
                  <SelectItem key={r.name} value={String(i)}>
                    {r.name} — {r.w}×{r.h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => onDownload("portrait")} disabled={exporting !== null}>
                <Download /> {exporting === "portrait" ? "Rendering…" : "Portrait"}
              </Button>
              <Button onClick={() => onDownload("landscape")} disabled={exporting !== null}>
                <Download /> {exporting === "landscape" ? "Rendering…" : "Landscape"}
              </Button>
            </div>
            <Button variant="outline" onClick={onShare}>
              <Share2 /> {copied ? "Link copied!" : "Share this wallpaper"}
            </Button>
          </div>
        </aside>
      </main>
    </div>
  )
}

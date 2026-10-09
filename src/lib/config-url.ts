// URL ⇄ config: the one place that decides how a query string becomes a
// wallpaper. Shared by the app (initial state) and the link-preview server
// (og:image / meta), so a shared link previews exactly what it opens to.
// Plain .ts with explicit extensions so Node can run it via type stripping.
import {
  DEFAULT_OUTPUT,
  isPortrait,
  legacyOutput,
  legacyResIndex,
  outputFrom,
  parseSize,
  type OutputSpec,
} from "./output.ts"
import {
  PALETTES,
  RESOLUTIONS,
  SCENES,
  type Pattern,
  type Scene,
  type WallpaperConfig,
} from "./wallpaper.ts"

export const PATTERNS: { value: Pattern; label: string }[] = [
  { value: "grid", label: "Grid" },
  { value: "dots", label: "Dots" },
  { value: "softdots", label: "Soft dots" },
  { value: "bayer", label: "Dither" },
  { value: "smooth", label: "Smooth" },
]

/**
 * URL schema history — old links must keep opening the same look:
 *   v1 (no `ver`): `res` = index into RESOLUTIONS, both orientations offered;
 *       `pal` = palette, even when `colors` were edited.
 *   v2 (`ver=2`): `size` = WxH + `device` = preset id replace `res`; `pal` is
 *       written only while the colors match it, `base` names the palette that
 *       custom colors started from.
 * Readers accept both; writers emit v2.
 */
export const URL_VERSION = 2

/** every key the app writes into the URL (plus legacy `res`, still read) */
export const CONFIG_KEYS = [
  "scene",
  "pattern",
  "seed",
  "bg",
  "colors",
  "cell",
  "blobs",
  "grain",
  "dark",
  "pal",
  "base",
  "size",
  "device",
  "ver",
  "res",
] as const

export const DEFAULT_SEED = 20260716

export interface UrlState {
  cfg: WallpaperConfig
  dark: boolean
  /** the named palette, or the one custom colors are based on */
  paletteName: string
  /** legacy index into RESOLUTIONS, derived from `output` (3 = 4K when it isn't one) */
  res: number
  output: OutputSpec
}

const hexParam = (v: string | null) => (v && /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : null)

const intParam = (v: string | null, min: number, max: number) => {
  const n = Number(v)
  return v !== null && Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null
}

/** invalid or missing values fall back to defaults, never throw */
export function parseConfig(params: URLSearchParams): UrlState {
  const pattern = PATTERNS.some((p) => p.value === params.get("pattern"))
    ? (params.get("pattern") as Pattern)
    : "grid"
  const scene = SCENES.some((s) => s.value === params.get("scene"))
    ? (params.get("scene") as Scene)
    : "smoke"
  // any finite number renders deterministically; Infinity/NaN would not
  const seedN = Number(params.get("seed"))
  const seed = Number.isFinite(seedN) && seedN !== 0 ? seedN : DEFAULT_SEED

  const dark = params.get("dark") === null ? true : params.get("dark") !== "0"
  const named = (v: string | null) => (PALETTES.some((p) => p.name === v) ? v : null)
  const paletteName = named(params.get("pal")) ?? named(params.get("base")) ?? PALETTES[0].name
  const p = PALETTES.find((p) => p.name === paletteName)!
  const paramColors = params.get("colors")?.split(",").map(hexParam)
  const colors =
    paramColors && paramColors.length > 0 && paramColors.every(Boolean)
      ? (paramColors as string[])
      : [...p.colors]
  const bg = hexParam(params.get("bg")) ?? (dark ? p.darkBg : p.lightBg)

  const size = parseSize(params.get("size"))
  const legacyRes = intParam(params.get("res"), 0, RESOLUTIONS.length - 1)
  const output = size
    ? outputFrom(size, params.get("device"))
    : legacyRes !== null
      ? legacyOutput(legacyRes)
      : { ...DEFAULT_OUTPUT }

  return {
    dark,
    paletteName,
    res: legacyResIndex(output),
    output,
    cfg: {
      seed,
      scene,
      pattern,
      bg,
      colors,
      cell: intParam(params.get("cell"), 2, 12) ?? 8,
      blobs: intParam(params.get("blobs"), 2, 8) ?? 5,
      grain: (intParam(params.get("grain"), 0, 100) ?? 15) / 100,
    },
  }
}

/** do the colors still equal the named palette (in either background tone)? */
export function matchesPalette(cfg: WallpaperConfig, paletteName: string): boolean {
  const p = PALETTES.find((p) => p.name === paletteName)
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  return Boolean(
    p &&
      (same(cfg.bg, p.darkBg) || same(cfg.bg, p.lightBg)) &&
      cfg.colors.length === p.colors.length &&
      cfg.colors.every((c, i) => same(c, p.colors[i]))
  )
}

/** URL form of a state — the same keys and encoding the app keeps in the address bar */
export function stateToParams(s: UrlState): URLSearchParams {
  const { cfg } = s
  const custom = !matchesPalette(cfg, s.paletteName)
  return new URLSearchParams({
    scene: cfg.scene,
    pattern: cfg.pattern,
    seed: String(cfg.seed),
    bg: cfg.bg.replace("#", "").toLowerCase(),
    colors: cfg.colors.map((c) => c.replace("#", "").toLowerCase()).join(","),
    cell: String(cfg.cell),
    blobs: String(cfg.blobs),
    grain: String(Math.round(cfg.grain * 100)),
    dark: s.dark ? "1" : "0",
    // custom colors aren't the palette any more; keep where they came from
    [custom ? "base" : "pal"]: s.paletteName,
    size: `${s.output.w}x${s.output.h}`,
    device: s.output.preset,
    ver: String(URL_VERSION),
  })
}

/**
 * Canonical key for the rendered image: only what changes pixels, in a fixed
 * order, so equivalent URLs share one cache entry.
 */
export function renderKey(cfg: WallpaperConfig, output?: OutputSpec): string {
  const key = new URLSearchParams({
    scene: cfg.scene,
    pattern: cfg.pattern,
    seed: String(cfg.seed),
    bg: cfg.bg.replace("#", "").toLowerCase(),
    colors: cfg.colors.map((c) => c.replace("#", "").toLowerCase()).join(","),
    cell: String(cfg.cell),
    blobs: String(cfg.blobs),
    grain: String(Math.round(cfg.grain * 100)),
  })
  // portrait outputs get a different card composition (see server/og.ts);
  // landscape ones keep the v1 key, so existing cached cards stay valid
  if (output && isPortrait(output)) key.set("size", `${output.w}x${output.h}`)
  return key.toString()
}

const sceneName = (scene: Scene) =>
  (SCENES.find((s) => s.value === scene)?.label ?? scene).replace(/\s*\(.*\)$/, "")

const patternName = (pattern: Pattern) =>
  pattern === "smooth" ? "Smooth" : (PATTERNS.find((p) => p.value === pattern)?.label ?? pattern)

/** palette name, or "Custom" once the colors no longer match it */
function paletteLabel(s: UrlState): string {
  return matchesPalette(s.cfg, s.paletteName) ? s.paletteName : "Custom"
}

const DEVICE_NOUN: Record<string, string> = { phone: "phone ", tablet: "tablet ", desktop: "" }

/** human summary used for the page title and link previews */
export function describe(s: UrlState): { title: string; description: string } {
  const scene = sceneName(s.cfg.scene)
  const pattern = patternName(s.cfg.pattern)
  const palette = paletteLabel(s)
  const texture =
    s.cfg.pattern === "smooth" ? "a smooth finish" : `a ${pattern.toLowerCase()} texture`
  const colors = palette === "Custom" ? "custom colors" : `the ${palette} palette`
  return {
    title: `${scene} · ${pattern} · ${palette} — wallgen`,
    description:
      `A ${s.dark ? "dark" : "light"} ${scene.toLowerCase()} ${DEVICE_NOUN[s.output.kind] ?? ""}wallpaper with ${texture} in ${colors}. ` +
      "Open to tweak it and download up to 8K — free, no login.",
  }
}

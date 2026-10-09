// Curated starting points: complete looks (scene, colors, texture, seed and
// finish). Applying one keeps the chosen output target. Each is stored as a
// URL query so it goes through the same parser as shared links.
import { parseConfig } from "./config-url.ts"
import type { WallpaperConfig } from "./wallpaper.ts"

export interface Preset {
  id: string
  name: string
  cfg: WallpaperConfig
  dark: boolean
  paletteName: string
}

const LOOKS: [id: string, name: string, query: string][] = [
  ["lagoon-mist", "Lagoon mist", "scene=mist&pattern=softdots&pal=Lagoon&cell=11&seed=7"],
  ["sunrise-haze", "Sunrise haze", "scene=mist&pattern=bayer&pal=Sunrise&cell=5&seed=11&grain=0"],
  ["rose-smoke", "Rose smoke", "scene=smoke&pattern=softdots&pal=Rose&dark=0&cell=9&seed=8&grain=15"],
  ["pine-ridge", "Pine ridge", "scene=hills&pattern=softdots&pal=Forest&cell=7&seed=3&grain=10"],
  ["ember-dunes", "Ember dunes", "scene=dunes&pattern=dots&pal=Ember&cell=6&seed=4&grain=10"],
  ["paper-peaks", "Paper peaks", "scene=mountains&pattern=smooth&pal=Mono&dark=0&seed=5&grain=35&blobs=6"],
  ["neon-haze", "Neon haze", "scene=blobs&pattern=softdots&pal=Neon+Horizon&cell=9&seed=6&grain=10&blobs=6"],
  ["ocean-flow", "Ocean flow", "scene=flow&pattern=grid&pal=Ocean&cell=6&seed=31&grain=15&blobs=4"],
]

export const PRESETS: Preset[] = LOOKS.map(([id, name, query]) => {
  const s = parseConfig(new URLSearchParams(query))
  return { id, name, cfg: s.cfg, dark: s.dark, paletteName: s.paletteName }
})

const same = (a: WallpaperConfig, b: WallpaperConfig) =>
  a.scene === b.scene &&
  a.pattern === b.pattern &&
  a.seed === b.seed &&
  a.cell === b.cell &&
  a.blobs === b.blobs &&
  a.grain === b.grain &&
  a.bg.toLowerCase() === b.bg.toLowerCase() &&
  a.colors.length === b.colors.length &&
  a.colors.every((c, i) => c.toLowerCase() === b.colors[i].toLowerCase())

/** the preset the config still exactly equals, if any */
export const matchPreset = (cfg: WallpaperConfig) => PRESETS.find((p) => same(p.cfg, cfg))

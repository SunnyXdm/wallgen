// Per-wallpaper link previews: crawlers don't run JS, so the server writes the
// Open Graph / Twitter tags for the wallpaper a shared URL encodes.
import {
  CONFIG_KEYS,
  describe,
  parseConfig,
  renderKey,
  stateToParams,
  type UrlState,
} from "../src/lib/config-url.ts"
import { OG_H, OG_W, type OgFormat } from "./og.ts"

/** bump when the renderer's output changes: og images are cached as immutable */
export const RENDER_VERSION = "1"

const IMAGE_KEYS = new Set<string>([...CONFIG_KEYS, "v"])
const MAX_QUERY = 600
const MAX_VALUE = 120
const MAX_COLORS = 8

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** a page URL describes a specific wallpaper (?random is rolled client-side, so it doesn't) */
export function hasConfig(params: URLSearchParams): boolean {
  return !params.has("random") && CONFIG_KEYS.some((k) => params.has(k))
}

/**
 * Image requests are stricter than page loads: only known keys, once each, of
 * sane length. Values themselves are normalized by parseConfig like the app.
 * Returns an error message, or null when acceptable.
 */
export function checkImageQuery(rawQuery: string): string | null {
  if (rawQuery.length > MAX_QUERY) return "query too long"
  const params = new URLSearchParams(rawQuery)
  const seen = new Set<string>()
  for (const [k, v] of params) {
    if (!IMAGE_KEYS.has(k)) return `unknown parameter: ${k}`
    if (seen.has(k)) return `duplicate parameter: ${k}`
    seen.add(k)
    if (v.length > MAX_VALUE) return `parameter too long: ${k}`
  }
  if ((params.get("colors")?.split(",").length ?? 0) > MAX_COLORS) return "too many colors"
  return null
}

export function imageUrl(origin: string, state: UrlState, format: OgFormat): string {
  return `${origin}/og.${format}?v=${RENDER_VERSION}&${renderKey(state.cfg)}`
}

export interface Meta {
  title: string
  description: string
  url: string
  image: string
  imageType: string
  imageAlt: string
}

export function metaFor(params: URLSearchParams, origin: string, format: OgFormat): Meta {
  const state = parseConfig(params)
  const { title, description } = describe(state)
  return {
    title,
    description,
    url: `${origin}/?${stateToParams(state)}`,
    image: imageUrl(origin, state, format),
    imageType: format === "png" ? "image/png" : "image/jpeg",
    imageAlt: `${title.replace(/ — wallgen$/, "")} wallpaper preview`,
  }
}

// the head tags index.html ships with; replaced wholesale for a specific wallpaper
const REPLACED = [
  /<title>[\s\S]*?<\/title>\s*/g,
  /<meta\s+name="description"[\s\S]*?\/?>\s*/g,
  /<meta\s+property="og:[^"]*"[\s\S]*?\/?>\s*/g,
  /<meta\s+name="twitter:[^"]*"[\s\S]*?\/?>\s*/g,
]

export function injectMeta(html: string, m: Meta): string {
  const e = escapeHtml
  const tags = [
    `<title>${e(m.title)}</title>`,
    `<meta name="description" content="${e(m.description)}" />`,
    `<meta property="og:site_name" content="wallgen" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${e(m.title)}" />`,
    `<meta property="og:description" content="${e(m.description)}" />`,
    `<meta property="og:url" content="${e(m.url)}" />`,
    `<meta property="og:image" content="${e(m.image)}" />`,
    `<meta property="og:image:type" content="${e(m.imageType)}" />`,
    `<meta property="og:image:width" content="${OG_W}" />`,
    `<meta property="og:image:height" content="${OG_H}" />`,
    `<meta property="og:image:alt" content="${e(m.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${e(m.title)}" />`,
    `<meta name="twitter:description" content="${e(m.description)}" />`,
    `<meta name="twitter:image" content="${e(m.image)}" />`,
  ]
  let out = html
  for (const re of REPLACED) out = out.replace(re, "")
  return out.replace(/<\/head>/i, `  ${tags.join("\n    ")}\n  </head>`)
}

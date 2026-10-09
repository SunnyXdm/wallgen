import assert from "node:assert/strict"
import { test } from "node:test"
import { describe, parseConfig, renderKey, stateToParams } from "../src/lib/config-url.ts"
import { LruCache, Limiter, RateLimiter } from "./og.ts"
import { checkImageQuery, escapeHtml, hasConfig, injectMeta, metaFor } from "./preview.ts"

const q = (s: string) => new URLSearchParams(s)
const ORIGIN = "https://wallgen.sunnydx.dev"

test("parseConfig: defaults match the app's", () => {
  const s = parseConfig(q(""))
  assert.equal(s.cfg.scene, "smoke")
  assert.equal(s.cfg.pattern, "grid")
  assert.equal(s.cfg.seed, 20260716)
  assert.equal(s.cfg.cell, 8)
  assert.equal(s.cfg.blobs, 5)
  assert.equal(s.cfg.grain, 0.15)
  assert.equal(s.dark, true)
  assert.equal(s.paletteName, "Lagoon")
  assert.equal(s.cfg.bg, "#03161a") // Lagoon dark bg
  assert.equal(s.res, 3)
})

test("parseConfig: invalid values fall back, valid ones are clamped/rounded like the app", () => {
  const s = parseConfig(q("scene=nope&pattern=<b>&seed=Infinity&cell=99&blobs=3.6&grain=-1&bg=zzz&colors=ff0000,bad&pal=Nope&dark=0&res=9"))
  assert.equal(s.cfg.scene, "smoke")
  assert.equal(s.cfg.pattern, "grid")
  assert.equal(s.cfg.seed, 20260716)
  assert.equal(s.cfg.cell, 8)
  assert.equal(s.cfg.blobs, 4)
  assert.equal(s.cfg.grain, 0.15)
  assert.equal(s.dark, false)
  assert.equal(s.cfg.bg, "#e3eeec") // Lagoon light bg, since dark=0
  assert.deepEqual(s.cfg.colors, ["#06262c", "#0f4f5c", "#4a8088", "#c4ddd9"])
  assert.equal(s.res, 3)
})

test("parseConfig: explicit colors win over the palette", () => {
  const s = parseConfig(q("pal=Ember&bg=ABCDEF&colors=112233,445566"))
  assert.equal(s.cfg.bg, "#ABCDEF")
  assert.deepEqual(s.cfg.colors, ["#112233", "#445566"])
})

test("renderKey: equivalent URLs normalize to one key; non-visual params are ignored", () => {
  const a = parseConfig(q("seed=7&scene=mist&bg=ABCDEF&res=1&utm_source=x"))
  const b = parseConfig(q("bg=abcdef&scene=mist&seed=7.0&dark=1"))
  assert.equal(renderKey(a.cfg), renderKey(b.cfg))
  assert.match(renderKey(a.cfg), /^scene=mist&pattern=grid&seed=7&bg=abcdef&colors=/)
})

test("stateToParams round-trips through parseConfig", () => {
  const s = parseConfig(q("scene=hills&pattern=bayer&seed=42&pal=Deep+Teal&dark=0&cell=3&blobs=7&grain=40&res=5"))
  assert.deepEqual(parseConfig(stateToParams(s)), s)
})

test("describe: names the look, and says Custom once colors are edited", () => {
  const s = parseConfig(q("scene=mist&pattern=softdots&pal=Lagoon&cell=11&seed=7"))
  assert.equal(describe(s).title, "Mist · Soft dots · Lagoon — wallgen")
  assert.match(describe(s).description, /^A dark mist wallpaper with a soft dots texture in the Lagoon palette\./)
  const custom = parseConfig(q("scene=hills&pattern=smooth&colors=ff0000"))
  assert.equal(describe(custom).title, "Hills & pines · Smooth · Custom — wallgen")
})

test("hasConfig: plain and ?random pages keep the default card", () => {
  assert.equal(hasConfig(q("")), false)
  assert.equal(hasConfig(q("utm_source=x")), false)
  assert.equal(hasConfig(q("random")), false)
  assert.equal(hasConfig(q("scene=mist")), true)
})

test("checkImageQuery: rejects unknown, duplicate and oversized params", () => {
  assert.equal(checkImageQuery("v=1&scene=mist&seed=7"), null)
  assert.match(checkImageQuery("scene=mist&w=8000")!, /unknown parameter: w/)
  assert.match(checkImageQuery("seed=1&seed=2")!, /duplicate/)
  assert.match(checkImageQuery("seed=" + "9".repeat(200))!, /too long/)
  assert.match(checkImageQuery("x=" + "a".repeat(700))!, /query too long/)
  assert.match(checkImageQuery("colors=" + Array(9).fill("aaaaaa").join(","))!, /too many colors/)
})

test("escapeHtml covers attribute and text contexts", () => {
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;")
})

const HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>wallgen — minimal wallpaper generator</title>
    <meta
      name="description"
      content="default"
    />
    <meta property="og:title" content="default" />
    <meta property="og:image" content="https://wallgen.sunnydx.dev/og.jpg" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="module" src="/assets/index.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`

test("injectMeta replaces the default tags with escaped per-wallpaper ones", () => {
  const params = q("scene=arcs&pattern=dots&seed=5&pal=Ember")
  const html = injectMeta(HTML, metaFor(params, ORIGIN, "png"))
  assert.equal(html.match(/<title>/g)?.length, 1)
  assert.equal(html.match(/og:title/g)?.length, 1)
  assert.equal(html.match(/name="description"/g)?.length, 1)
  assert.equal(html.match(/twitter:card/g)?.length, 1)
  assert.ok(!html.includes('content="default"'))
  assert.ok(html.includes("<title>Arcs · Dots · Ember — wallgen</title>"))
  assert.ok(html.includes('<meta property="og:image" content="https://wallgen.sunnydx.dev/og.png?v=1&amp;scene=arcs&amp;pattern=dots&amp;seed=5&amp;'))
  assert.ok(html.includes('<meta property="og:image:width" content="1200" />'))
  assert.ok(html.includes('<meta name="twitter:image" content="https://wallgen.sunnydx.dev/og.png?'))
  assert.ok(html.includes('<meta property="og:url" content="https://wallgen.sunnydx.dev/?scene=arcs&amp;'))
  assert.ok(html.includes('<script type="module" src="/assets/index.js"></script>'))
})

test("injectMeta: hostile input can't break out of attributes", () => {
  const meta = metaFor(q("scene=mist"), ORIGIN, "jpg")
  meta.title = `"><script>alert(1)</script>`
  const html = injectMeta(HTML, meta)
  assert.ok(!html.includes("<script>alert"))
  assert.ok(html.includes("&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"))
})

test("metaFor: URL values never reach the page unnormalized", () => {
  const html = injectMeta(HTML, metaFor(q(`scene=mist&pal="><x>&bg="><y>`), ORIGIN, "jpg"))
  assert.ok(!/<x>|<y>/.test(html))
  assert.ok(html.includes("/og.jpg?v=1&amp;scene=mist"))
})

test("LruCache evicts least-recently-used by count and bytes", () => {
  const c = new LruCache(2, 10)
  c.set("a", Buffer.alloc(4))
  c.set("b", Buffer.alloc(4))
  c.get("a")
  c.set("c", Buffer.alloc(4)) // over count: evicts b
  assert.ok(c.get("a") && c.get("c") && !c.get("b"))
  c.set("d", Buffer.alloc(8)) // over bytes: evicts a, then c
  assert.equal(c.size, 1)
})

test("Limiter caps concurrency and refuses past its queue", async () => {
  const l = new Limiter(2, 1)
  let active = 0
  let peak = 0
  const job = () =>
    l.run(async () => {
      peak = Math.max(peak, ++active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      return true
    })
  const results = await Promise.all([job(), job(), job(), job()])
  assert.equal(peak, 2)
  assert.deepEqual(results, [true, true, true, null])
})

test("RateLimiter: burst then refill", () => {
  const r = new RateLimiter(2, 60) // 1 per second
  assert.equal(r.take("ip", 0), true)
  assert.equal(r.take("ip", 0), true)
  assert.equal(r.take("ip", 0), false)
  assert.equal(r.take("other", 0), true)
  assert.equal(r.take("ip", 1000), true)
})

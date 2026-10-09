// wallgen runtime: serves the static build and, for shared wallpaper links,
// per-wallpaper Open Graph tags plus a server-rendered preview image.
//   node server/index.ts      (Node ≥ 22.18 runs the TypeScript directly)
import { createHash } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname, join, relative, resolve, sep } from "node:path"
import { brotliCompressSync, gzipSync } from "node:zlib"
import { parseConfig, renderKey } from "../src/lib/config-url.ts"
import { LruCache, Limiter, MIME, RateLimiter, renderOg, type OgFormat } from "./og.ts"
import { checkImageQuery, hasConfig, injectMeta, metaFor } from "./preview.ts"

const PORT = Number(process.env.PORT ?? 8080)
const DIST = resolve(process.env.DIST_DIR ?? join(import.meta.dirname, "..", "dist"))
// never derived from the Host header: previews must point at the real site
const ORIGIN = (process.env.PUBLIC_ORIGIN ?? "https://wallgen.sunnydx.dev").replace(/\/+$/, "")
const OG_FORMAT: OgFormat = process.env.OG_FORMAT === "png" ? "png" : "jpg"

// --- static files: dist/ is small, so hold it (and its compressed forms) in memory

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
}
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest", ".txt"])

interface StaticFile {
  body: Buffer
  br?: Buffer
  gzip?: Buffer
  type: string
  etag: string
  cache: string
}

function loadDist(dir: string): Map<string, StaticFile> {
  const files = new Map<string, StaticFile>()
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const abs = join(entry.parentPath, entry.name)
    const rel = "/" + relative(dir, abs).split(sep).join("/")
    const ext = extname(rel).toLowerCase()
    const body = readFileSync(abs)
    const file: StaticFile = {
      body,
      type: TYPES[ext] ?? "application/octet-stream",
      etag: `"${createHash("sha1").update(body).digest("base64url").slice(0, 16)}"`,
      cache:
        rel === "/index.html"
          ? "no-cache"
          : rel.startsWith("/assets/") // content-hashed by Vite
            ? "public, max-age=31536000, immutable"
            : "public, max-age=3600",
    }
    if (COMPRESSIBLE.has(ext) && body.length > 512) {
      file.br = brotliCompressSync(body)
      file.gzip = gzipSync(body, { level: 9 })
    }
    files.set(rel, file)
  }
  return files
}

const files = loadDist(DIST)
const index = files.get("/index.html")
if (!index) throw new Error(`no index.html in ${DIST} — run \`npm run build\` first`)
const indexHtml = index.body.toString("utf8")

function sendStatic(req: IncomingMessage, res: ServerResponse, f: StaticFile) {
  res.setHeader("Content-Type", f.type)
  res.setHeader("Cache-Control", f.cache)
  res.setHeader("ETag", f.etag)
  if (req.headers["if-none-match"] === f.etag) {
    res.writeHead(304).end()
    return
  }
  let body = f.body
  if (f.br || f.gzip) {
    res.setHeader("Vary", "Accept-Encoding")
    const accept = String(req.headers["accept-encoding"] ?? "")
    if (f.br && /\bbr\b/.test(accept)) {
      body = f.br
      res.setHeader("Content-Encoding", "br")
    } else if (f.gzip && /\bgzip\b/.test(accept)) {
      body = f.gzip
      res.setHeader("Content-Encoding", "gzip")
    }
  }
  res.setHeader("Content-Length", body.length)
  res.writeHead(200).end(req.method === "HEAD" ? undefined : body)
}

function sendText(res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers })
  res.end(text + "\n")
}

// --- preview images

const cache = new LruCache(200, 64 * 1024 * 1024)
const limiter = new Limiter(2, 16)
const rate = new RateLimiter(20, 20) // cache misses per client: burst 20, then 20/min
const inflight = new Map<string, Promise<Buffer | null>>()
setInterval(() => rate.sweep(), 60_000).unref()

/** Pangolin (Traefik) appends the peer it saw, so only the rightmost entry is trustworthy */
function clientIp(req: IncomingMessage): string {
  const xff = req.headers["x-forwarded-for"]
  const last = (Array.isArray(xff) ? xff.join(",") : xff)?.split(",").pop()?.trim()
  return last || req.socket.remoteAddress || "unknown"
}

async function sendImage(req: IncomingMessage, res: ServerResponse, format: OgFormat, rawQuery: string) {
  const problem = checkImageQuery(rawQuery)
  if (problem) return sendText(res, 400, problem)

  const { cfg } = parseConfig(new URLSearchParams(rawQuery))
  const key = `${format}:${renderKey(cfg)}`
  let body = cache.get(key)
  const hit = Boolean(body)
  if (!body) {
    let job = inflight.get(key) // crawlers often fetch the same image several times at once
    if (!job) {
      if (!rate.take(clientIp(req))) return sendText(res, 429, "slow down", { "Retry-After": "30" })
      job = limiter.run(async () => {
        const t = performance.now()
        const png = await renderOg(cfg, format)
        console.log(`render ${key} ${png.length}B ${(performance.now() - t).toFixed(0)}ms`)
        return png
      })
      inflight.set(key, job)
      job
        .then((b) => b && cache.set(key, b))
        .catch(() => {})
        .finally(() => inflight.delete(key))
    }
    body = (await job) ?? undefined
    if (!body) return sendText(res, 503, "busy, try again", { "Retry-After": "5" })
  }
  res.writeHead(200, {
    "Content-Type": MIME[format],
    "Content-Length": body.length,
    // the query fully determines the pixels (and carries a renderer version)
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Cache": hit ? "HIT" : "MISS",
  })
  res.end(req.method === "HEAD" ? undefined : body)
}

// --- routing

function sendPage(req: IncomingMessage, res: ServerResponse, params: URLSearchParams) {
  if (!hasConfig(params)) return sendStatic(req, res, index!)
  const html = Buffer.from(injectMeta(indexHtml, metaFor(params, ORIGIN, OG_FORMAT)))
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.length,
    "Cache-Control": "no-cache",
  })
  res.end(req.method === "HEAD" ? undefined : html)
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "method not allowed", { Allow: "GET, HEAD" })
  }
  let url: URL
  let path: string
  try {
    url = new URL(req.url ?? "/", "http://localhost")
    path = decodeURIComponent(url.pathname)
  } catch {
    return sendText(res, 400, "bad request")
  }
  const rawQuery = url.search.slice(1)

  if (path === "/healthz") {
    return sendText(res, 200, JSON.stringify({ ok: true, cached: cache.size, hits: cache.hits, misses: cache.misses }))
  }
  if (path === "/og.png") return sendImage(req, res, "png", rawQuery)
  // a bare /og.jpg is the static default card from public/
  if (path === "/og.jpg" && rawQuery) return sendImage(req, res, "jpg", rawQuery)

  const file = files.get(path)
  if (file && path !== "/index.html") return sendStatic(req, res, file)
  // missing assets are real 404s; anything else is an SPA route
  if (extname(path) && path !== "/index.html") return sendText(res, 404, "not found")
  return sendPage(req, res, url.searchParams)
}

const server = createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err)
    if (!res.headersSent) sendText(res, 500, "internal error")
    else res.destroy()
  })
})
server.keepAliveTimeout = 65_000

server.listen(PORT, () => {
  console.log(`wallgen on :${PORT} — ${files.size} files from ${DIST}, origin ${ORIGIN}, og as ${OG_FORMAT}`)
})

// docker stop sends SIGTERM to PID 1 (node itself): finish in-flight requests, then exit
function shutdown(signal: string) {
  console.log(`${signal}: shutting down`)
  server.close(() => process.exit(0))
  server.closeIdleConnections()
  setTimeout(() => process.exit(0), 8_000).unref()
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))

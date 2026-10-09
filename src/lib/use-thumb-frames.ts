import { useEffect, useRef, useState } from "react"
import { renderer, type Frame } from "./render-client"
import type { ThumbJob } from "./render-jobs"

/**
 * Rendered thumbnails by key. Only keys not already cached are requested (one
 * batch, off the main thread), and while `settling` (a color drag) requests
 * wait until the edits pause, so the main preview gets the render time.
 */
export function useThumbFrames(jobs: ThumbJob[], settling: boolean, channel: string) {
  const cache = useRef(new Map<string, Frame>())
  const [, bump] = useState(0)
  const keys = jobs.map((j) => j.key).join("|")

  useEffect(() => {
    const missing = jobs.filter((j) => !cache.current.has(j.key))
    if (missing.length === 0) return
    let alive = true
    const t = setTimeout(
      () =>
        void renderer.thumbs(missing, channel).then((frames) => {
          if (!frames) return
          if (!alive) {
            for (const f of frames.values()) f.close()
            return
          }
          const wanted = new Set(jobs.map((j) => j.key))
          for (const [k, f] of frames) cache.current.set(k, f)
          for (const [k, f] of cache.current)
            if (!wanted.has(k)) {
              f.close()
              cache.current.delete(k)
            }
          bump((n) => n + 1)
        }),
      settling ? 220 : 0
    )
    return () => {
      alive = false
      clearTimeout(t)
    }
    // keys captures everything that changes the jobs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys, settling, channel])

  useEffect(
    () => () => {
      for (const f of cache.current.values()) f.close()
      cache.current.clear()
    },
    []
  )

  return cache.current
}

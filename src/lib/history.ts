// Undo/redo for the whole wallpaper document. Discrete edits (a preset, a
// scene, Surprise me) are one entry each; continuous edits (a slider drag, a
// color picker session) pass a gesture key and collapse into one entry until
// the gesture ends.
import { useCallback, useMemo, useState } from "react"
import type { OutputSpec } from "./output"
import type { WallpaperConfig } from "./wallpaper"

export interface WallDoc {
  cfg: WallpaperConfig
  /** wallpaper background tone (not the app theme) */
  dark: boolean
  /** palette the colors are, or were based on */
  paletteName: string
  output: OutputSpec
}

const LIMIT = 100

interface State {
  past: WallDoc[]
  present: WallDoc
  future: WallDoc[]
  /** gesture key of the entry being extended, if any */
  gesture: string | null
}

export interface EditOptions {
  /** collapse consecutive edits with the same key into one undo entry */
  gesture?: string
}

export function useWallHistory(initial: WallDoc) {
  const [state, setState] = useState<State>({ past: [], present: initial, future: [], gesture: null })

  const edit = useCallback((fn: (d: WallDoc) => WallDoc, opts: EditOptions = {}) => {
    setState((s) => {
      const next = fn(s.present)
      if (next === s.present) return s
      const gesture = opts.gesture ?? null
      if (gesture !== null && s.gesture === gesture) return { ...s, present: next }
      return { past: [...s.past, s.present].slice(-LIMIT), present: next, future: [], gesture }
    })
  }, [])

  /** the next edit starts a new undo entry even with the same gesture key */
  const endGesture = useCallback(() => {
    setState((s) => (s.gesture === null ? s : { ...s, gesture: null }))
  }, [])

  const undo = useCallback(() => {
    setState((s) =>
      s.past.length === 0
        ? s
        : {
            past: s.past.slice(0, -1),
            present: s.past[s.past.length - 1],
            future: [s.present, ...s.future],
            gesture: null,
          }
    )
  }, [])

  const redo = useCallback(() => {
    setState((s) =>
      s.future.length === 0
        ? s
        : { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1), gesture: null }
    )
  }, [])

  return useMemo(
    () => ({
      doc: state.present,
      edit,
      endGesture,
      undo,
      redo,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
    }),
    [state, edit, endGesture, undo, redo]
  )
}

/** keyboard undo should stay native inside text fields */
export function isTextEditing(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLInputElement)
    return !["button", "checkbox", "color", "radio", "range", "reset", "submit"].includes(el.type)
  return false
}

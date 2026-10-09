import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  ChevronsDown,
  ChevronsUp,
  Columns3,
  Maximize,
  Redo2,
  RotateCwSquare,
  SlidersHorizontal,
  Undo2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CompareView } from "@/components/compare-view"
import { Controls, type ControlActions } from "@/components/controls"
import { ExportActions } from "@/components/export-actions"
import { OutputPicker } from "@/components/output-picker"
import { PreviewStage, type StageMode } from "@/components/preview-stage"
import { describe, matchesPalette, parseConfig, PATTERNS, stateToParams } from "@/lib/config-url"
import { isTextEditing, useWallHistory, type WallDoc } from "@/lib/history"
import { reducedMotion } from "@/lib/motion"
import { dims, estimateScreen, outputLabel, parseSize, rotate, screenOutput, type OutputSpec } from "@/lib/output"
import { matchPreset, PRESETS } from "@/lib/presets"
import { SECTIONS, type SectionId } from "@/lib/sections"
import { toneBg } from "@/lib/tone"
import { PALETTES, SCENES } from "@/lib/wallpaper"

function randomDoc(output: OutputSpec): WallDoc {
  const r = Math.random
  const p = PALETTES[Math.floor(r() * PALETTES.length)]
  const dark = r() < 0.6
  return {
    dark,
    paletteName: p.name,
    output,
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

/**
 * Where the first render points. A link that names a size keeps it; otherwise
 * phones and tablets start from their own screen (estimated), and desktops
 * from the link's legacy `res` (4K by default) — the look is the same either way.
 */
function initialDoc(): WallDoc {
  // the URL always mirrors the full config (see the replaceState effect), so
  // any copied/shared link reproduces the exact wallpaper. ?random = randomized start.
  // Parsing is shared with the link-preview server (src/lib/config-url.ts).
  const params = new URLSearchParams(window.location.search)
  const s = parseConfig(params)
  let output = s.output
  if (!parseSize(params.get("size")) && window.matchMedia("(pointer: coarse)").matches) {
    const short = Math.min(window.screen.width, window.screen.height)
    output =
      short < 600
        ? { kind: "phone", preset: "screen", ...estimateScreen(window.screen, window.devicePixelRatio || 1, true) }
        : screenOutput()
  }
  if (params.has("random")) return randomDoc(output)
  return { cfg: s.cfg, dark: s.dark, paletteName: s.paletteName, output }
}

const INSPECTOR_W = 344
const TOOLBAR_H = 56

/**
 * Side-by-side (stage + inspector) when that leaves the preview at least as
 * much room as stacking would — measured as the biggest square each layout's
 * stage could hold, so a short landscape phone gets two panes and a portrait
 * tablet gets the big stacked preview.
 */
function pickLayout() {
  const w = window.innerWidth
  const h = window.innerHeight
  const side = Math.min(w - INSPECTOR_W, h - TOOLBAR_H)
  const stack = Math.min(w, h - TOOLBAR_H - 64 - 76)
  return { side: w >= 640 && side >= stack, short: h < 560 }
}

function useLayout() {
  const [layout, setLayout] = useState(pickLayout)
  useEffect(() => {
    const on = () =>
      setLayout((l) => {
        const n = pickLayout()
        return n.side === l.side && n.short === l.short ? l : n
      })
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  return layout
}

/** which section is in view inside a scroll container */
function useScrollSpy(root: React.RefObject<HTMLElement | null>, enabled = true) {
  const [active, setActive] = useState<SectionId>("looks")
  useEffect(() => {
    const el = root.current
    if (!el || !enabled) return
    const on = () => {
      const top = el.getBoundingClientRect().top
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
      const sections = [...el.querySelectorAll<HTMLElement>("[data-section]")]
      let current = sections[0]?.dataset.section as SectionId
      for (const s of sections) if (s.getBoundingClientRect().top - top < 80) current = s.dataset.section as SectionId
      if (atEnd) current = sections[sections.length - 1]?.dataset.section as SectionId
      setActive(current)
    }
    on()
    el.addEventListener("scroll", on, { passive: true })
    return () => el.removeEventListener("scroll", on)
  }, [root, enabled])
  return active
}

function SectionNav({
  active,
  scroller,
  className,
}: {
  active: SectionId
  scroller: React.RefObject<HTMLElement | null>
  className?: string
}) {
  const i = SECTIONS.findIndex((s) => s.id === active)
  return (
    <nav aria-label="Settings sections" className={cn("relative grid grid-cols-4 rounded-lg bg-muted/40 p-1", className)}>
      {/* sliding pill, as in the background switch */}
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-md bg-background shadow-sm ring-1 ring-white/5 transition-transform duration-(--dur-slow) ease-(--ease-out)"
        style={{ transform: `translateX(${i * 100}%)` }}
      />
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-current={active === s.id ? "true" : undefined}
          onClick={() => {
            const target = scroller.current?.querySelector<HTMLElement>(`#section-${s.id}`)
            const el = scroller.current
            if (!target || !el) return
            el.scrollTo({
              top: el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 12,
              behavior: reducedMotion() ? "auto" : "smooth",
            })
          }}
          className={cn(
            "relative h-9 rounded-md text-[13px] font-medium transition-colors motion-ui pointer-coarse:h-11",
            active === s.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {s.label}
        </button>
      ))}
    </nav>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
  className,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn("size-10 pointer-coarse:size-11", pressed && "bg-muted text-foreground", className)}
    >
      {children}
    </Button>
  )
}

function Wordmark({ small }: { small?: boolean }) {
  return (
    <h1 className={cn("font-bold uppercase", small ? "text-sm tracking-[0.3em]" : "text-base tracking-[0.35em]")}>
      wallgen
    </h1>
  )
}

const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform)
const mod = isMac ? "⌘" : "Ctrl+"

export default function App() {
  const hist = useWallHistory(useMemo(initialDoc, []))
  const { doc, edit, endGesture, undo, redo, canUndo, canRedo } = hist
  const { cfg, output } = doc
  const layout = useLayout()
  const [draft, setDraft] = useState(false)
  const [mode, setMode] = useState<StageMode>("fit")
  const [compare, setCompare] = useState(false)
  const [panel, setPanel] = useState<"closed" | "compact" | "expanded">("closed")
  // discrete changes (scene, palette, variation…) crossfade; continuous ones
  // (slider drags, color pickers) swap instantly so they track the pointer
  const fadeNext = useRef(false)
  const docRef = useRef(doc)
  docRef.current = doc

  const isCustom = !matchesPalette(cfg, doc.paletteName)
  const preset = matchPreset(cfg)
  const urlState = useMemo(
    () => ({ cfg, dark: doc.dark, paletteName: doc.paletteName, output, res: 3 }),
    [cfg, doc.dark, doc.paletteName, output]
  )
  const { title } = describe(urlState)
  const sceneLabel = SCENES.find((s) => s.value === cfg.scene)?.label ?? cfg.scene
  const textureLabel = PATTERNS.find((p) => p.value === cfg.pattern)?.label ?? cfg.pattern
  const paletteText = isCustom ? `Custom (based on ${doc.paletteName})` : doc.paletteName
  const summary = preset ? preset.name : `${sceneLabel} · ${textureLabel} · ${isCustom ? "Custom" : doc.paletteName}`
  const canvasLabel = `${sceneLabel} wallpaper, ${textureLabel.toLowerCase()} texture, ${paletteText} colors, ${outputLabel(output)} ${dims(output)}`

  // keep the address bar share-ready (throttled: Safari limits replaceState)
  useEffect(() => {
    const t = setTimeout(() => {
      window.history.replaceState(null, "", `?${stateToParams(urlState)}`)
      document.title = title
    }, 250)
    return () => clearTimeout(t)
  }, [urlState, title])

  const shareUrl = useCallback(() => {
    const d = docRef.current
    const q = stateToParams({ cfg: d.cfg, dark: d.dark, paletteName: d.paletteName, output: d.output, res: 3 })
    return `${window.location.origin}${window.location.pathname}?${q}`
  }, [])

  const discrete = useCallback(
    (fn: (d: WallDoc) => WallDoc) => {
      fadeNext.current = true
      edit(fn)
    },
    [edit]
  )

  const actions: ControlActions = useMemo(
    () => ({
      applyPreset: (id) => {
        const p = PRESETS.find((p) => p.id === id)!
        discrete((d) => ({ ...d, cfg: { ...p.cfg, colors: [...p.cfg.colors] }, dark: p.dark, paletteName: p.paletteName }))
      },
      surprise: () => discrete((d) => randomDoc(d.output)),
      setScene: (scene) => discrete((d) => (d.cfg.scene === scene ? d : { ...d, cfg: { ...d.cfg, scene } })),
      setPattern: (pattern) => discrete((d) => (d.cfg.pattern === pattern ? d : { ...d, cfg: { ...d.cfg, pattern } })),
      applyPalette: (name) =>
        discrete((d) => {
          // re-picking the palette the colors already are changes nothing
          if (d.paletteName === name && matchesPalette(d.cfg, name)) return d
          const p = PALETTES.find((p) => p.name === name)!
          return { ...d, paletteName: name, cfg: { ...d.cfg, bg: d.dark ? p.darkBg : p.lightBg, colors: [...p.colors] } }
        }),
      setTone: (dark) =>
        discrete((d) =>
          d.dark === dark ? d : { ...d, dark, cfg: { ...d.cfg, bg: toneBg(d.cfg.bg, d.paletteName, dark) } }
        ),
      setColor: (i, value) => {
        fadeNext.current = false
        setDraft(true)
        edit(
          (d) => {
            if (i < 0) return d.cfg.bg === value ? d : { ...d, cfg: { ...d.cfg, bg: value } }
            if (d.cfg.colors[i] === value) return d
            const colors = [...d.cfg.colors]
            colors[i] = value
            return { ...d, cfg: { ...d.cfg, colors } }
          },
          { gesture: `color${i}` }
        )
      },
      setNumber: (key, value) => {
        fadeNext.current = false
        edit((d) => (d.cfg[key] === value ? d : { ...d, cfg: { ...d.cfg, [key]: value } }), { gesture: key })
      },
      newVariation: () => discrete((d) => ({ ...d, cfg: { ...d.cfg, seed: Math.floor(Math.random() * 0xffffffff) } })),
      settle: () => {
        endGesture()
        setDraft(false)
      },
      unsettle: () => setDraft(true),
    }),
    [discrete, edit, endGesture]
  )

  const setOutput = useCallback(
    (o: OutputSpec) => {
      fadeNext.current = false
      edit((d) => (d.output.w === o.w && d.output.h === o.h && d.output.preset === o.preset ? d : { ...d, output: o }))
    },
    [edit]
  )

  const doUndo = useCallback(() => {
    fadeNext.current = true
    undo()
  }, [undo])
  const doRedo = useCallback(() => {
    fadeNext.current = true
    redo()
  }, [redo])

  // ⌘Z / ⌘⇧Z / Ctrl+Y, but never inside text fields (their own undo wins)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || isTextEditing(e.target)) return
      const k = e.key.toLowerCase()
      if (k === "z" && !e.shiftKey) doUndo()
      else if ((k === "z" && e.shiftKey) || (k === "y" && !isMac)) doRedo()
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [doUndo, doRedo])

  // a slider released outside the window never commits; don't stay in draft
  useEffect(() => {
    if (!draft) return
    const end = () => setTimeout(() => setDraft(false), 0)
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    return () => {
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
  }, [draft])

  const history = (
    <>
      <IconButton label={`Undo (${mod}Z)`} onClick={doUndo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label={`Redo (${mod}${isMac ? "⇧Z" : "Y"})`} onClick={doRedo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>
    </>
  )

  const stageTools = (
    <>
      <IconButton label="Rotate orientation" onClick={() => setOutput(rotate(output))}>
        <RotateCwSquare />
      </IconButton>
      <div role="group" aria-label="Zoom" className="flex rounded-lg bg-muted/40 p-0.5">
        <IconButton
          label="Fit to stage"
          pressed={mode === "fit"}
          onClick={() => setMode("fit")}
          className="size-9 pointer-coarse:size-11"
        >
          <Maximize />
        </IconButton>
        <IconButton
          label="Actual pixels"
          pressed={mode === "actual"}
          onClick={() => {
            setMode("actual")
            setCompare(false)
          }}
          className="size-9 text-xs font-semibold tabular-nums pointer-coarse:size-11"
        >
          1:1
        </IconButton>
      </div>
    </>
  )

  // tight layouts: one toggle (rotation lives in the output picker)
  const actualToggle = (
    <IconButton
      label="Actual pixels"
      pressed={mode === "actual"}
      onClick={() => setMode((m) => (m === "actual" ? "fit" : "actual"))}
      className="text-xs font-semibold tabular-nums"
    >
      1:1
    </IconButton>
  )

  const stage = (
    <PreviewStage
      cfg={cfg}
      output={output}
      mode={mode}
      draft={draft}
      fadeNext={fadeNext}
      label={canvasLabel}
      className="size-full"
    />
  )

  const controls = <Controls doc={doc} isCustom={isCustom} actions={actions} settling={draft} />
  const exportActions = (props: { showSummary?: boolean; className?: string }) => (
    <ExportActions cfg={cfg} output={output} shareUrl={shareUrl} {...props} />
  )

  const scrollerRef = useRef<HTMLDivElement>(null)
  const customizeRef = useRef<HTMLButtonElement>(null)
  const panelOpen = panel !== "closed"
  // closing the panel returns focus to the button that opened it
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !panelOpen) customizeRef.current?.focus()
    wasOpen.current = panelOpen
  }, [panelOpen])
  const active = useScrollSpy(scrollerRef, layout.side || panelOpen)

  if (layout.side) {
    return (
      <div className="dark flex h-dvh overflow-hidden bg-background text-foreground">
        <div className="stage-surface flex min-w-0 flex-1 flex-col">
          <header
            className="enter-rise flex shrink-0 items-center gap-1 px-3 sm:gap-2 sm:px-4"
            style={{ height: TOOLBAR_H, "--i": -2 } as CSSProperties}
          >
            <Wordmark small={layout.short} />
            {!layout.short && (
              <p className="ml-3 hidden min-w-0 truncate text-sm text-muted-foreground lg:block">{summary}</p>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">{history}</div>
            <OutputPicker output={output} onChange={setOutput} compact={layout.short || window.innerWidth < 1100} />
            <div className="flex shrink-0 items-center gap-0.5">
              {layout.short ? actualToggle : stageTools}
              {!layout.short && (
                <IconButton
                  label="Compare formats"
                  pressed={compare}
                  onClick={() => {
                    setCompare((c) => !c)
                    setMode("fit")
                  }}
                >
                  <Columns3 />
                </IconButton>
              )}
            </div>
          </header>
          <main
            className={cn("enter-settle relative min-h-0 flex-1", layout.short ? "px-3 pb-3" : "px-8 pb-8 pt-2")}
            style={{ "--i": 1 } as CSSProperties}
          >
            <h2 className="sr-only">Preview</h2>
            {compare ? (
              <div className="relative size-full">
                <CompareView
                  cfg={cfg}
                  output={output}
                  onPick={(o) => {
                    setOutput(o)
                    setCompare(false)
                  }}
                />
              </div>
            ) : (
              stage
            )}
          </main>
        </div>
        <aside
          aria-label="Wallpaper settings"
          className="flex shrink-0 flex-col border-l bg-background"
          style={{ width: INSPECTOR_W }}
        >
          <div className={cn("shrink-0 px-4", layout.short ? "py-2" : "py-3")}>
            <SectionNav active={active} scroller={scrollerRef} />
          </div>
          <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-3">
            {controls}
          </div>
          <footer className={cn("shrink-0 border-t px-4", layout.short ? "py-2.5" : "py-4")}>
            {exportActions({ showSummary: !layout.short })}
          </footer>
        </aside>
      </div>
    )
  }

  // stacked: big preview, look summary, a two-position Customize panel, and
  // the download bar pinned below everything that scrolls
  return (
    <div className="dark flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header
        className="enter-rise flex h-14 shrink-0 items-center gap-1 pl-4 pr-2"
        style={{ "--i": -2 } as CSSProperties}
      >
        <Wordmark small />
        <div className="ml-auto flex items-center">{history}</div>
        <OutputPicker output={output} onChange={setOutput} compact />
      </header>
      <main className="stage-surface relative flex min-h-0 flex-1 flex-col">
        <h2 className="sr-only">Preview</h2>
        <div className="enter-settle min-h-0 flex-1 px-5 pt-3 pb-2" style={{ "--i": 1 } as CSSProperties}>
          {stage}
        </div>
        {!panelOpen && (
          <div className="enter-rise flex shrink-0 items-center gap-3 px-4 pb-3" style={{ "--i": 3 } as CSSProperties}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{summary}</p>
              <p className="truncate text-xs text-muted-foreground tabular-nums">
                {outputLabel(output)} · {dims(output)}
              </p>
            </div>
            {actualToggle}
            <Button
              ref={customizeRef}
              variant="secondary"
              className="h-11 shrink-0 px-4"
              aria-expanded={false}
              aria-controls="customize-panel"
              onClick={() => setPanel("compact")}
            >
              <SlidersHorizontal /> Customize
            </Button>
          </div>
        )}
      </main>
      <section
        id="customize-panel"
        aria-label="Customize"
        hidden={!panelOpen}
        className={cn(
          "flex shrink-0 flex-col overflow-hidden rounded-t-2xl border-t bg-background shadow-[0_-12px_30px_rgba(0,0,0,0.45)] transition-[height] duration-(--dur-slow) ease-(--ease-out)",
          panel === "expanded" ? "h-[72dvh]" : "h-[44dvh]"
        )}
      >
        <PanelHandle
          expanded={panel === "expanded"}
          onExpand={() => setPanel("expanded")}
          onCollapse={() => setPanel("compact")}
          onClose={() => setPanel("closed")}
        >
          <SectionNav active={active} scroller={scrollerRef} className="min-w-0 flex-1" />
        </PanelHandle>
        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2">
          <div className="mx-auto max-w-xl">{controls}</div>
        </div>
      </section>
      <footer className="pb-safe shrink-0 border-t bg-background px-3 pt-3">
        <div className="mx-auto max-w-xl">{exportActions({})}</div>
      </footer>
    </div>
  )
}

/** grab bar plus explicit buttons: dragging is a shortcut, never the only way */
function PanelHandle({
  expanded,
  onExpand,
  onCollapse,
  onClose,
  children,
}: {
  expanded: boolean
  onExpand: () => void
  onCollapse: () => void
  onClose: () => void
  children: ReactNode
}) {
  const start = useRef<number | null>(null)
  return (
    <div
      className="shrink-0 touch-none px-3 pb-2"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = e.clientY
      }}
      onPointerUp={(e) => {
        if (start.current === null) return
        const dy = e.clientY - start.current
        start.current = null
        if (dy < -30) onExpand()
        else if (dy > 30) (expanded ? onCollapse : onClose)()
      }}
      onPointerCancel={() => (start.current = null)}
    >
      <div aria-hidden className="flex h-5 cursor-grab items-center justify-center">
        <span className="h-1.5 w-10 rounded-full bg-muted" />
      </div>
      <div className="mx-auto flex max-w-xl items-center gap-1">
        {children}
        <IconButton label={expanded ? "Collapse panel" : "Expand panel"} onClick={expanded ? onCollapse : onExpand}>
          {expanded ? <ChevronsDown /> : <ChevronsUp />}
        </IconButton>
        <IconButton label="Close panel" onClick={onClose}>
          <X />
        </IconButton>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { Check, Copy, Dices, RotateCcw, Shuffle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { PATTERNS } from "@/lib/config-url"
import type { WallDoc } from "@/lib/history"
import { dims } from "@/lib/output"
import { PRESETS } from "@/lib/presets"
import type { SectionId } from "@/lib/sections"
import type { Frame } from "@/lib/render-client"
import type { ThumbJob } from "@/lib/render-jobs"
import { toneBg } from "@/lib/tone"
import { exportCellPx, PALETTES, SCENES, type Pattern, type Scene } from "@/lib/wallpaper"
import { spin, useDir } from "@/lib/motion"
import { Ticker } from "./motion"
import { useThumbFrames } from "@/lib/use-thumb-frames"
import { ThumbCanvas } from "./thumbs"

export interface ControlActions {
  applyPreset: (id: string) => void
  surprise: () => void
  setScene: (s: Scene) => void
  setPattern: (p: Pattern) => void
  applyPalette: (name: string) => void
  setTone: (dark: boolean) => void
  /** continuous: one undo entry per picker session */
  setColor: (i: number, value: string) => void
  /** continuous: one undo entry per drag */
  setNumber: (key: "cell" | "blobs" | "grain", value: number) => void
  newVariation: () => void
  /** a drag or picker session ended */
  settle: () => void
  /** a drag or picker session started */
  unsettle: () => void
}

/** shared selection ring: snaps in from slightly larger, transform/opacity only */
const pickerClass = (selected: boolean) =>
  cn(
    "relative rounded-lg transition-[opacity,transform] motion-ui hover:-translate-y-0.5 active:scale-[0.96] active:duration-(--dur-fast)",
    "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-[calc(var(--radius-lg)+3px)] after:border-2 after:border-primary after:transition-[opacity,transform] after:duration-(--dur) after:ease-(--ease-out)",
    selected ? "after:scale-100 after:opacity-100" : "after:scale-[1.08] after:opacity-0"
  )

/** arrow keys move (and select) within a radiogroup; Tab enters at the checked one */
function onRadioKeys(e: KeyboardEvent<HTMLElement>) {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
  if (!(e.key in keys) && e.key !== "Home" && e.key !== "End") return
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])')]
  const i = radios.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  e.preventDefault()
  const next =
    e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1 : (i + keys[e.key] + radios.length) % radios.length
  radios[next].focus()
  radios[next].click()
}

/** roving tabindex: the checked radio (or the first) is the group's tab stop */
const tabStop = (checked: boolean, index: number, anyChecked: boolean) => (checked || (!anyChecked && index === 0) ? 0 : -1)

function Section({
  id,
  title,
  aside,
  children,
  index,
}: {
  id: SectionId
  title: string
  aside?: ReactNode
  children: ReactNode
  index: number
}) {
  return (
    <section
      id={`section-${id}`}
      data-section={id}
      aria-labelledby={`heading-${id}`}
      style={{ "--i": index } as CSSProperties}
      className="enter-rise grid scroll-mt-3 gap-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`heading-${id}`} className="text-sm font-semibold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function SubLabel({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-xs font-medium text-muted-foreground">
      {children}
    </h3>
  )
}

function Tile({
  checked,
  label,
  index,
  anyChecked,
  frame,
  aspect,
  onSelect,
  hint,
}: {
  checked: boolean
  label: string
  index: number
  anyChecked: boolean
  frame: Frame | undefined
  aspect: string
  onSelect: () => void
  hint?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={hint ? `${label}, ${hint}` : label}
      tabIndex={tabStop(checked, index, anyChecked)}
      onClick={onSelect}
      className="group/tile flex min-w-0 flex-col gap-1.5 text-left"
    >
      <span className={cn(pickerClass(checked), "block w-full")}>
        <span className="block overflow-hidden rounded-lg border" style={{ aspectRatio: aspect }}>
          <ThumbCanvas frame={frame} />
        </span>
      </span>
      <span
        className={cn(
          "truncate text-xs transition-colors motion-ui",
          checked ? "font-medium text-foreground" : "text-muted-foreground group-hover/tile:text-foreground"
        )}
      >
        {label}
      </span>
    </button>
  )
}

function SliderRow({
  label,
  value,
  display,
  valueText,
  min,
  max,
  step,
  onChange,
  actions,
  disabled,
  hint,
}: {
  label: string
  value: number
  display: ReactNode
  valueText: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  actions: ControlActions
  disabled?: boolean
  hint?: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className={cn(disabled && "text-muted-foreground")}>{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{display}</span>
      </div>
      <Slider
        label={label}
        valueText={valueText}
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        onPointerDown={actions.unsettle}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={actions.settle}
        className="py-2.5"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ColorSwatch({
  label,
  short,
  value,
  onInput,
  actions,
}: {
  label: string
  short: string
  value: string
  onInput: (v: string) => void
  actions: ControlActions
}) {
  const ref = useRef<HTMLInputElement>(null)
  // React's onChange is the input event; the native change event marks the end
  // of a picker session (one undo entry)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const end = () => actions.settle()
    el.addEventListener("change", end)
    return () => el.removeEventListener("change", end)
  }, [actions])
  return (
    <label className="flex flex-col items-center gap-1">
      <input
        ref={ref}
        type="color"
        aria-label={`${label} color`}
        value={value}
        onChange={(e) => {
          actions.unsettle()
          onInput(e.target.value)
        }}
        onBlur={actions.settle}
        className="size-11 cursor-pointer rounded-lg border bg-transparent p-1"
      />
      <span className="text-[11px] text-muted-foreground" aria-hidden>
        {short}
      </span>
    </label>
  )
}

export function Controls({
  doc,
  isCustom,
  actions,
  settling,
}: {
  doc: WallDoc
  isCustom: boolean
  actions: ControlActions
  /** a continuous edit is in progress (thumbnails wait) */
  settling: boolean
}) {
  const { cfg, dark, paletteName, output } = doc
  const cellDir = useDir(cfg.cell)
  const blobsDir = useDir(cfg.blobs)
  const grainDir = useDir(cfg.grain)
  const variationIcon = useRef<SVGSVGElement>(null)
  const shuffleIcon = useRef<SVGSVGElement>(null)
  const [seedCopied, setSeedCopied] = useState(false)

  const colorKey = `${cfg.bg}:${cfg.colors.join(",")}`
  const jobs: ThumbJob[] = [
    ...PRESETS.map((p) => ({
      key: `p:${p.id}`,
      cfg: p.cfg,
      w: 150,
      h: 200,
      cellPx: p.cfg.cell * 0.55,
    })),
    ...SCENES.map((s) => ({
      key: `s:${s.value}:${colorKey}`,
      cfg: { seed: 7, scene: s.value, pattern: "smooth" as Pattern, bg: cfg.bg, colors: cfg.colors, cell: 8, blobs: 5, grain: 0 },
      w: 160,
      h: 120,
    })),
    ...PATTERNS.map((p) => ({
      key: `t:${p.value}:${cfg.scene}:${cfg.seed}:${cfg.blobs}:${colorKey}`,
      cfg: { ...cfg, pattern: p.value, grain: 0 },
      w: 120,
      h: 120,
      cellPx: 10,
    })),
  ]
  const frames = useThumbFrames(jobs, settling, "thumbs")
  const presetChecked = PRESETS.findIndex(
    (p) =>
      p.cfg.scene === cfg.scene &&
      p.cfg.pattern === cfg.pattern &&
      p.cfg.seed === cfg.seed &&
      p.cfg.cell === cfg.cell &&
      p.cfg.blobs === cfg.blobs &&
      p.cfg.grain === cfg.grain &&
      p.cfg.bg === cfg.bg &&
      p.cfg.colors.join() === cfg.colors.join()
  )
  const exportCell = exportCellPx(cfg.cell, output.w)
  const palette = PALETTES.find((p) => p.name === paletteName)!

  return (
    <div className="grid gap-8">
      <Section
        id="looks"
        index={1}
        title="Looks"
        aside={<span className="text-xs text-muted-foreground">Start from a finished look</span>}
      >
        <div role="radiogroup" aria-labelledby="heading-looks" onKeyDown={onRadioKeys} className="grid grid-cols-3 gap-x-2.5 gap-y-3">
          {PRESETS.map((p, i) => (
            <Tile
              key={p.id}
              label={p.name}
              index={i}
              checked={presetChecked === i}
              anyChecked={presetChecked >= 0}
              frame={frames.get(`p:${p.id}`)}
              aspect="3 / 4"
              onSelect={() => actions.applyPreset(p.id)}
            />
          ))}
          <button
            type="button"
            onClick={() => {
              spin(shuffleIcon.current)
              actions.surprise()
            }}
            className="group/tile flex min-w-0 flex-col gap-1.5 text-left"
          >
            <span className="grid w-full place-items-center rounded-lg border border-dashed bg-muted/30 text-muted-foreground transition-[color,background-color,transform] motion-ui group-hover/tile:-translate-y-0.5 group-hover/tile:bg-muted/60 group-hover/tile:text-foreground group-active/tile:scale-[0.96]" style={{ aspectRatio: "3 / 4" }}>
              <Shuffle ref={shuffleIcon} className="size-5" />
            </span>
            <span className="truncate text-xs text-muted-foreground group-hover/tile:text-foreground">Surprise me</span>
          </button>
        </div>
      </Section>

      <Section
        id="scene"
        index={2}
        title="Scene"
        aside={
          <span className="text-xs text-muted-foreground">
            <Ticker value={SCENES.find((s) => s.value === cfg.scene)?.label ?? ""} />
          </span>
        }
      >
        <div role="radiogroup" aria-labelledby="heading-scene" onKeyDown={onRadioKeys} className="grid gap-3">
          {(["soft", "shapes"] as const).map((group) => (
            <div key={group} role="group" aria-labelledby={`scene-${group}`} className="grid gap-2">
              <SubLabel id={`scene-${group}`}>{group === "soft" ? "Soft" : "Shapes"}</SubLabel>
              <div className="grid grid-cols-4 gap-x-2 gap-y-3">
                {SCENES.filter((s) => s.group === group).map((s) => (
                  <Tile
                    key={s.value}
                    label={s.label}
                    index={SCENES.indexOf(s)}
                    checked={cfg.scene === s.value}
                    anyChecked
                    frame={frames.get(`s:${s.value}:${colorKey}`)}
                    aspect="4 / 3"
                    onSelect={() => actions.setScene(s.value)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <SliderRow
          label="Detail"
          value={cfg.blobs}
          display={<Ticker value={cfg.blobs} dir={blobsDir} />}
          valueText={`${cfg.blobs} of 8`}
          min={2}
          max={8}
          step={1}
          onChange={(v) => actions.setNumber("blobs", v)}
          actions={actions}
        />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-foreground" id="seed-label">
              Seed
            </div>
            <div className="truncate font-mono text-sm tabular-nums" aria-labelledby="seed-label">
              {cfg.seed}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label={seedCopied ? "Seed copied" : "Copy seed"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(String(cfg.seed))
                setSeedCopied(true)
                setTimeout(() => setSeedCopied(false), 1500)
              } catch {
                // clipboard blocked: the seed stays visible and selectable
              }
            }}
          >
            {seedCopied ? <Check className="pop-in" /> : <Copy />}
          </Button>
          <Button
            variant="secondary"
            className="h-11 px-3.5"
            onClick={() => {
              spin(variationIcon.current)
              actions.newVariation()
            }}
          >
            <Dices ref={variationIcon} /> New variation
          </Button>
        </div>
      </Section>

      <Section
        id="color"
        index={3}
        title="Color"
        aside={
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {isCustom ? (
              <>
                <span>
                  Custom · based on <span className="text-foreground">{paletteName}</span>
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-7 pointer-coarse:h-11"
                  onClick={() => actions.applyPalette(paletteName)}
                  aria-label={`Reset colors to ${paletteName}`}
                >
                  <RotateCcw /> Reset
                </Button>
              </>
            ) : (
              <Ticker value={paletteName} />
            )}
          </span>
        }
      >
        <div role="radiogroup" aria-labelledby="heading-color" onKeyDown={onRadioKeys} className="grid grid-cols-4 gap-x-2 gap-y-3">
          {PALETTES.map((p, i) => {
            const checked = !isCustom && paletteName === p.name
            const based = isCustom && paletteName === p.name
            return (
              <button
                key={p.name}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={based ? `${p.name} (custom colors are based on it)` : p.name}
                tabIndex={tabStop(checked, i, !isCustom)}
                onClick={() => actions.applyPalette(p.name)}
                className="group/tile flex min-w-0 flex-col gap-1.5 text-left"
              >
                <span className={cn(pickerClass(checked), "block w-full", based && "after:scale-100 after:border-dashed after:opacity-60")}>
                  <span className="flex h-8 overflow-hidden rounded-lg border">
                    <span className="flex-1" style={{ background: dark ? p.darkBg : p.lightBg }} />
                    {p.colors.map((c) => (
                      <span key={c} className="flex-1" style={{ background: c }} />
                    ))}
                  </span>
                </span>
                <span
                  className={cn(
                    "truncate text-xs",
                    checked ? "font-medium text-foreground" : "text-muted-foreground group-hover/tile:text-foreground"
                  )}
                >
                  {p.name}
                </span>
              </button>
            )
          })}
        </div>

        <div className="grid gap-2">
          <SubLabel id="background-label">Background</SubLabel>
          <div
            role="radiogroup"
            aria-labelledby="background-label"
            onKeyDown={onRadioKeys}
            className="relative grid grid-cols-2 gap-1 rounded-lg border p-1"
          >
            {/* sliding pill: one element translated between the halves */}
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-1 left-1 w-[calc(50%-0.375rem)] rounded-md bg-primary transition-transform duration-(--dur-slow) ease-(--ease-out)",
                !dark && "translate-x-[calc(100%+0.25rem)]"
              )}
            />
            {[true, false].map((d) => (
              <button
                key={String(d)}
                type="button"
                role="radio"
                aria-checked={dark === d}
                tabIndex={dark === d ? 0 : -1}
                onClick={() => actions.setTone(d)}
                className={cn(
                  "relative flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium pointer-coarse:h-11 transition-[color,transform] motion-ui active:scale-[0.97]",
                  dark === d ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {/* a swatch of the background it gives, not a sun/moon theme icon */}
                <span
                  aria-hidden
                  className="size-4 rounded-[5px] ring-1 ring-black/25 ring-inset"
                  style={{
                    background: dark === d ? cfg.bg : toneBg(cfg.bg, palette.name, d),
                  }}
                />
                {d ? "Dark" : "Light"}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <SubLabel>Colors</SubLabel>
          <div className="flex items-start justify-between gap-1">
            <ColorSwatch
              label="Background"
              short="Bg"
              value={cfg.bg}
              actions={actions}
              onInput={(v) => actions.setColor(-1, v)}
            />
            {cfg.colors.map((c, i) => (
              <ColorSwatch
                key={i}
                label={`Color ${i + 1}`}
                short={String(i + 1)}
                value={c}
                actions={actions}
                onInput={(v) => actions.setColor(i, v)}
              />
            ))}
          </div>
        </div>
      </Section>

      <Section
        id="texture"
        index={4}
        title="Texture"
        aside={
          <span className="text-xs text-muted-foreground">
            <Ticker value={PATTERNS.find((p) => p.value === cfg.pattern)?.label ?? ""} />
          </span>
        }
      >
        <div role="radiogroup" aria-labelledby="heading-texture" onKeyDown={onRadioKeys} className="grid grid-cols-5 gap-2">
          {PATTERNS.map((p, i) => (
            <Tile
              key={p.value}
              label={p.label}
              hint={p.value === "bayer" ? "8×8 Bayer ordered dither" : undefined}
              index={i}
              checked={cfg.pattern === p.value}
              anyChecked
              frame={frames.get(`t:${p.value}:${cfg.scene}:${cfg.seed}:${cfg.blobs}:${colorKey}`)}
              aspect="1 / 1"
              onSelect={() => actions.setPattern(p.value)}
            />
          ))}
        </div>
        <SliderRow
          label="Texture scale"
          value={cfg.cell}
          display={
            cfg.pattern === "smooth" ? (
              "—"
            ) : (
              <>
                <Ticker value={cfg.cell} dir={cellDir} />
              </>
            )
          }
          valueText={`${cfg.cell}, ${exportCell} pixel cells in the export`}
          min={2}
          max={12}
          step={1}
          disabled={cfg.pattern === "smooth"}
          onChange={(v) => actions.setNumber("cell", v)}
          actions={actions}
          hint={
            cfg.pattern === "smooth"
              ? "Smooth has no texture — pick another texture to scale it."
              : `${exportCell} px cells in the ${dims(output)} PNG`
          }
        />
        <SliderRow
          label="Grain"
          value={Math.round(cfg.grain * 100)}
          display={
            <>
              <Ticker value={Math.round(cfg.grain * 100)} dir={grainDir} />%
            </>
          }
          valueText={`${Math.round(cfg.grain * 100)}%`}
          min={0}
          max={100}
          step={5}
          onChange={(v) => actions.setNumber("grain", v / 100)}
          actions={actions}
        />
      </Section>
    </div>
  )
}

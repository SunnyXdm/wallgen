import { useState, type KeyboardEvent } from "react"
import { Check, ChevronDown, RectangleHorizontal, RectangleVertical, ScanLine } from "lucide-react"
import { KIND_ICON } from "@/lib/device-icons"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  aspectLabel,
  dims,
  fromPreset,
  isPortrait,
  KIND_LABEL,
  MAX_PIXELS,
  MAX_SIDE,
  MIN_SIDE,
  OUTPUT_PRESETS,
  outputLabel,
  rotate,
  screenOutput,
  validSize,
  type DeviceKind,
  type OutputSpec,
} from "@/lib/output"

const KINDS: DeviceKind[] = ["phone", "desktop", "tablet", "custom"]

function onArrows(e: KeyboardEvent<HTMLElement>) {
  const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
  if (!d) return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')]
  const i = items.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  e.preventDefault()
  items[(i + d + items.length) % items.length].focus()
}

export function OutputPicker({
  output,
  onChange,
  compact,
  className,
}: {
  output: OutputSpec
  onChange: (o: OutputSpec) => void
  /** short trigger for tight toolbars */
  compact?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<DeviceKind>(output.kind)
  const [w, setW] = useState(String(output.w))
  const [h, setH] = useState(String(output.h))
  const Icon = KIND_ICON[output.kind]
  const portrait = isPortrait(output)
  const nw = Number(w)
  const nh = Number(h)
  const valid = validSize(nw, nh)

  const openChange = (o: boolean) => {
    if (o) {
      setTab(output.preset === "screen" || output.preset === "custom" ? "custom" : output.kind)
      setW(String(output.w))
      setH(String(output.h))
    }
    setOpen(o)
  }

  const pick = (o: OutputSpec) => {
    onChange(o)
    setOpen(false)
  }

  const applyCustom = () => {
    if (!valid) return
    const keepScreen = output.preset === "screen" && nw === output.w && nh === output.h
    pick(keepScreen ? output : { kind: "custom", preset: "custom", w: nw, h: nh })
  }

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-10 max-w-full min-w-0 gap-2 px-3 pointer-coarse:h-11", className)}
          aria-label={`Output: ${outputLabel(output)}, ${output.w} by ${output.h} pixels. Change`}
        >
          <Icon className="text-muted-foreground" />
          {!compact && <span className="truncate">{outputLabel(output)}</span>}
          <span className={cn("tabular-nums", !compact && "text-muted-foreground")}>{dims(output)}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="dark w-[min(22rem,calc(100vw-1.5rem))] gap-3 p-3"
        aria-label="Output size"
      >
        <div role="tablist" aria-label="Device type" className="grid grid-cols-4 gap-1 rounded-lg bg-muted/50 p-1">
          {KINDS.map((k) => {
            const KIcon = KIND_ICON[k]
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "flex h-11 flex-col items-center justify-center gap-0.5 rounded-md text-xs transition-colors motion-ui",
                  tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <KIcon className="size-4" />
                {KIND_LABEL[k]}
              </button>
            )
          })}
        </div>

        {tab !== "custom" ? (
          <div
            role="radiogroup"
            aria-label={`${KIND_LABEL[tab]} sizes`}
            onKeyDown={onArrows}
            className="-mx-1 grid max-h-[min(19rem,45svh)] gap-0.5 overflow-y-auto px-1"
          >
            {OUTPUT_PRESETS.filter((p) => p.kind === tab).map((p) => {
              const naturalPortrait = p.h > p.w
              // keep the current orientation if it's within the same category
              const o = fromPreset(p, output.kind === tab ? portrait : naturalPortrait)
              const checked = output.preset === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked || (!OUTPUT_PRESETS.some((x) => x.kind === tab && x.id === output.preset) && p === OUTPUT_PRESETS.find((x) => x.kind === tab)) ? 0 : -1}
                  onClick={() => pick(o)}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-md px-2.5 text-left text-sm transition-colors motion-ui hover:bg-muted",
                    checked && "bg-muted"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.note}</span>
                  <span className="w-[5.5rem] text-right text-xs text-muted-foreground tabular-nums">{dims(o)}</span>
                  <Check className={cn("size-4 shrink-0", checked ? "opacity-100" : "opacity-0")} aria-hidden />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="grid min-w-0 gap-3">
            <Button
              variant="secondary"
              className="h-11 justify-start"
              onClick={() => {
                const s = screenOutput()
                setW(String(s.w))
                setH(String(s.h))
                onChange(s)
              }}
            >
              <ScanLine /> Use this screen
              <span className="ml-auto text-xs text-muted-foreground">estimated</span>
            </Button>
            <form
              className="grid min-w-0 gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                applyCustom()
              }}
            >
              <div className="flex items-end gap-2">
                <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground">
                  Width
                  <input
                    inputMode="numeric"
                    value={w}
                    onChange={(e) => setW(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    className="h-11 w-full min-w-0 rounded-md border bg-input/30 px-2.5 text-sm text-foreground tabular-nums"
                  />
                </label>
                <span className="pb-3 text-muted-foreground" aria-hidden>
                  ×
                </span>
                <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted-foreground">
                  Height
                  <input
                    inputMode="numeric"
                    value={h}
                    onChange={(e) => setH(e.target.value.replace(/\D/g, "").slice(0, 4))}
                    className="h-11 w-full min-w-0 rounded-md border bg-input/30 px-2.5 text-sm text-foreground tabular-nums"
                  />
                </label>
                <Button type="submit" className="h-11" disabled={!valid}>
                  Apply
                </Button>
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {valid
                  ? output.preset === "screen" && nw === output.w && nh === output.h
                    ? "Estimated from what the browser reports — correct it if your screen differs."
                    : `${aspectLabel({ w: nw, h: nh })} · ${((nw * nh) / 1e6).toFixed(1)} MP`
                  : `Each side ${MIN_SIDE}–${MAX_SIDE} px, up to ${Math.round(MAX_PIXELS / 1e6)} MP in total.`}
              </p>
            </form>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">Orientation</span>
          <div role="radiogroup" aria-label="Orientation" onKeyDown={onArrows} className="flex gap-1">
            {[true, false].map((p) => (
              <button
                key={String(p)}
                type="button"
                role="radio"
                aria-checked={portrait === p}
                tabIndex={portrait === p ? 0 : -1}
                onClick={() => portrait !== p && onChange(rotate(output))}
                className={cn(
                  "flex h-10 items-center gap-1.5 rounded-md px-3 text-sm transition-colors motion-ui",
                  portrait === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {p ? <RectangleVertical className="size-4" /> : <RectangleHorizontal className="size-4" />}
                {p ? "Portrait" : "Landscape"}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

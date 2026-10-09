/** keyed on value so each change ticks in, direction-aware for numbers */
export function Ticker({ value, dir }: { value: string | number; dir?: "up" | "down" }) {
  return (
    <span key={value} className="tick tabular-nums" data-dir={dir}>
      {value}
    </span>
  )
}

export function CheckDraw() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="check-draw pop-in"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" pathLength={1} />
    </svg>
  )
}

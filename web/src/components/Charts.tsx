import { useState } from "react";
import { cn } from "../lib/format";

// Small charts for the statistics, plain HTML: one series each, in the accent colour, values in text colours.
// Bars and cells answer a hover or a tap with their value; each chart has a text version for screen readers.

export interface Bar {
  label: string;
  value: number;
  /** What the tooltip says (defaults to the value). */
  hint?: string;
}

/** Vertical bars over time or categories; a few labels under them. */
export function BarChart({ bars, height = 140, labelEvery = 1, title }: { bars: Bar[]; height?: number; labelEvery?: number; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const shown = active != null ? bars[active] : null;
  return (
    <figure className="flex flex-col gap-2" onPointerLeave={() => setActive(null)}>
      <div className="h-5 text-xs text-fg-2 tabular-nums" aria-hidden="true">
        {shown ? `${shown.label}: ${shown.hint ?? shown.value}` : ""}
      </div>
      <div className="relative flex items-end gap-[2px] border-b border-line" style={{ height }} aria-hidden="true">
        {/* Recessive guides at half and full. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line/60" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line/40" />
        {bars.map((b, i) => (
          <div
            key={i}
            className="relative flex h-full min-w-0 flex-1 items-end"
            onPointerEnter={() => setActive(i)}
            onClick={() => setActive(i)}
          >
            <div
              className={cn("w-full rounded-t-[4px] transition-colors", active === i ? "bg-accent" : "bg-accent/70")}
              style={{ height: b.value ? `max(2px, ${(b.value / max) * 100}%)` : 0 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] text-[10px] text-fg-3" aria-hidden="true">
        {bars.map((b, i) => (
          <span key={i} className="min-w-0 flex-1 overflow-visible text-center whitespace-nowrap">
            {i % labelEvery === 0 ? b.label : ""}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        {title}: {bars.map((b) => `${b.label} ${b.hint ?? b.value}`).join(", ")}
      </figcaption>
    </figure>
  );
}

/** Weekdays by hours: the darker, the more you listen then. */
export function HeatMap({ grid, rows, title, hint }: { grid: number[][]; rows: string[]; title: string; hint: (row: number, hour: number, n: number) => string }) {
  const [active, setActive] = useState<[number, number] | null>(null);
  const max = Math.max(1, ...grid.flat());
  return (
    <figure className="flex flex-col gap-2" onPointerLeave={() => setActive(null)}>
      <div className="h-5 text-xs text-fg-2 tabular-nums" aria-hidden="true">
        {active ? hint(active[0], active[1], grid[active[0]][active[1]]) : ""}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-[2px]" aria-hidden="true">
        {grid.map((row, r) => (
          <div key={r} className="contents">
            <span className="text-[10px] leading-[14px] text-fg-3">{rows[r]}</span>
            <div className="grid grid-cols-24 gap-[2px]">
              {row.map((n, h) => (
                <div
                  key={h}
                  onPointerEnter={() => setActive([r, h])}
                  onClick={() => setActive([r, h])}
                  className={cn("h-[14px] rounded-[3px]", n ? "bg-accent" : "bg-surface-2", active?.[0] === r && active[1] === h && "ring-2 ring-fg")}
                  style={n ? { opacity: 0.18 + 0.82 * (n / max) } : undefined}
                />
              ))}
            </div>
          </div>
        ))}
        <span />
        <div className="grid grid-cols-24 gap-[2px] text-[10px] text-fg-3">
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center">
              {h % 6 === 0 ? h : ""}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">
        {title}: {grid.map((row, r) => `${rows[r]} ${row.map((n, h) => `${h}:00 ${n}`).join(", ")}`).join("; ")}
      </figcaption>
    </figure>
  );
}

/** A ranked list with a bar each: names in text colours, the bar beside carries the size. */
export function RankBars({ items }: { items: { key: string; label: string; sub?: string; value: number; hint: string; art?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="flex flex-col gap-2.5">
      {items.map((it, i) => (
        <li key={it.key} className="flex items-center gap-3">
          <span className="w-5 shrink-0 text-right text-xs text-fg-3 tabular-nums">{i + 1}</span>
          {it.art !== undefined && (
            <span className="size-9 shrink-0 overflow-hidden rounded-full bg-surface-2">
              {it.art && <img src={it.art} alt="" className="size-full object-cover" loading="lazy" />}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium">{it.label}</span>
              <span className="shrink-0 text-xs text-fg-2 tabular-nums">{it.hint}</span>
            </span>
            <span className="h-1.5 w-full rounded-full bg-surface-2">
              <span className="block h-full rounded-full bg-accent/80" style={{ width: `${(it.value / max) * 100}%` }} />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

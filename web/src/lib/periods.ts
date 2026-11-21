import type { getT } from "../i18n";

// The periods of the profile and the statistics: ready ones, all time, or a number of hours, days, weeks, months or
// years (never further back than the first play on record).

export type Preset = "7d" | "1m" | "3m" | "12m";
export type PeriodId = Preset | "all" | "custom";
export type Unit = "hours" | "days" | "weeks" | "months" | "years";

export const DAY = 86_400_000;
export const PRESET_MS: Record<Preset, number> = { "7d": 7 * DAY, "1m": 30 * DAY, "3m": 91 * DAY, "12m": 365 * DAY };
export const UNIT_MS: Record<Unit, number> = { hours: 3600_000, days: DAY, weeks: 7 * DAY, months: 30.44 * DAY, years: 365.25 * DAY };
export const PERIODS: PeriodId[] = ["7d", "1m", "3m", "12m", "all", "custom"];
/** What the profile can open on (Settings). */
export const DEFAULT_PERIODS: PeriodId[] = ["7d", "1m", "3m", "12m", "all"];

export const isPeriod = (v: unknown): v is PeriodId => typeof v === "string" && (PERIODS as string[]).includes(v);

export function periodName(t: ReturnType<typeof getT>, id: PeriodId): string {
  const p = t.stats.periods;
  return { "7d": p.days7, "1m": p.month1, "3m": p.months3, "12m": p.months12, all: p.all, custom: t.profile.custom }[id];
}

/** A custom period: how many, of what. */
export interface Custom {
  amount: number;
  unit: Unit;
}

/** The most a custom period's number can be, for its unit: back to the first play on record. */
export function maxAmount(unit: Unit, first: number | null, now = Date.now()): number {
  return Math.max(1, Math.ceil((first ? now - first : 0) / UNIT_MS[unit]));
}

/** Where the period starts (ms); 0 for all time. */
export function sinceOf(id: PeriodId, custom: Custom, first: number | null, now = Date.now()): number {
  if (id === "all") return 0;
  const span = id === "custom" ? Math.min(Math.max(1, custom.amount), maxAmount(custom.unit, first, now)) * UNIT_MS[custom.unit] : PRESET_MS[id];
  return Math.max(first ?? 0, now - span);
}

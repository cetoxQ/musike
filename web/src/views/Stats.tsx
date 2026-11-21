import { ShareNetworkIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AlbumRow } from "../components/AlbumTiles";
import { BarChart, HeatMap, RankBars } from "../components/Charts";
import { BackButton, PageHeader } from "../components/Page";
import { TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useI18n, useT } from "../i18n";
import { api, shareImage } from "../lib/api";
import type { PlayLog } from "../lib/apiTypes";
import { cn } from "../lib/format";
import { reportImage } from "../lib/report";
import { paths } from "../lib/routes";
import { computeStats, type Bucket, type Stats as Numbers } from "../lib/stats";
import { useAuth } from "../stores/auth";
import { useLibrary } from "../stores/library";
import { toast } from "../stores/ui";
import { RankedTracks } from "./Artist";

type Period = "7d" | "4w" | "3m" | "12m" | "all" | "custom";
type Unit = "hours" | "days" | "weeks" | "months" | "years";

const DAY = 86_400_000;
const PRESETS: Record<Exclude<Period, "all" | "custom">, number> = { "7d": 7 * DAY, "4w": 28 * DAY, "3m": 91 * DAY, "12m": 365 * DAY };
const UNIT_MS: Record<Unit, number> = { hours: 3600_000, days: DAY, weeks: 7 * DAY, months: 30.44 * DAY, years: 365.25 * DAY };

/** Your listening in numbers and charts, for a period of your choosing; and a picture of it to share. */
export default function Stats() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const user = useAuth((s) => s.user);
  const playsVersion = useLibrary((s) => s.playsVersion);
  const [period, setPeriod] = useState<Period>("4w");
  const [amount, setAmount] = useState(14);
  const [unit, setUnit] = useState<Unit>("days");
  const [first, setFirst] = useState<number | null>(null);

  const maxAmount = Math.max(1, Math.ceil((first ? Date.now() - first : 0) / UNIT_MS[unit]));
  const shownAmount = Math.min(Math.max(1, amount), maxAmount);
  const key = period === "custom" ? `custom:${shownAmount}:${unit}` : period;

  // The period and the same length just before it (to compare), in one request.
  const page = useRemote<{ log: PlayLog; since: number; until: number; compare: boolean }>(`stats:${key}:${playsVersion}`, async (signal) => {
    const until = Date.now();
    const span = period === "custom" ? shownAmount * UNIT_MS[unit] : period === "all" ? 0 : PRESETS[period];
    const since = period === "all" ? 0 : Math.max(first ?? 0, until - span);
    const compare = period !== "all";
    const log = await api.playLog(compare ? since - (until - since) : 0, until, signal);
    if (log.first != null) setFirst(log.first);
    return { log, since: period === "all" ? (log.first ?? since) : since, until, compare };
  });
  const stats = useMemo(
    () => (page.status === "ok" ? computeStats(page.data.log, page.data.since, page.data.until, page.data.compare) : null),
    [page],
  );

  const periods: [Period, string][] = [
    ["7d", t.stats.periods.days7],
    ["4w", t.stats.periods.weeks4],
    ["3m", t.stats.periods.months3],
    ["12m", t.stats.periods.months12],
    ["all", t.stats.periods.all],
    ["custom", t.profile.custom],
  ];
  const periodLabel =
    period === "custom" ? t.stats.lastN(shownAmount, t.profile.units[unit]) : (periods.find(([p]) => p === period)?.[1] ?? "");

  const share = async () => {
    if (!stats) return;
    try {
      const blob = await reportImage(stats, {
        title: t.stats.title,
        period: periodLabel,
        name: user?.username ?? t.profile.you,
        numbers: numbersOf(stats, t).map(([label, value]) => [value, label]),
        artists: t.stats.topArtists,
        tracks: t.stats.topTracks,
        overTime: t.stats.overTime,
        plays: t.stats.playsN,
      });
      const result = await shareImage(blob, `musike-${new Date().toISOString().slice(0, 10)}.png`, t.stats.title);
      if (result === "saved") toast(t.stats.reportSaved);
    } catch {
      toast(t.stats.reportFailed, "error");
    }
  };

  return (
    <div className="pb-10">
      <PageHeader
        title={t.stats.title}
        actions={
          <>
            {stats && stats.plays > 0 && (
              <button
                type="button"
                onClick={() => void share()}
                aria-label={t.stats.shareReport}
                className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-3 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] sm:pr-4"
              >
                <ShareNetworkIcon size={18} /> <span className="hidden sm:inline">{t.stats.shareReport}</span>
              </button>
            )}
            <BackButton fallback={paths.profile} />
          </>
        }
      />

      <div role="radiogroup" aria-label={t.stats.period} className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-1 md:px-6">
        {periods.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={period === value}
            onClick={() => setPeriod(value)}
            className={cn(
              "h-9 shrink-0 rounded-full px-4 text-sm font-medium ring-1 transition-colors",
              period === value ? "bg-fg text-bg ring-fg" : "bg-surface-1 text-fg-2 ring-line hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 md:px-6">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={maxAmount}
            value={shownAmount}
            aria-label={t.profile.amount}
            onChange={(e) => setAmount(Math.trunc(Number(e.target.value)) || 1)}
            className="h-9 w-20 rounded-full bg-surface-1 px-3 text-sm tabular-nums ring-1 ring-line focus:ring-accent focus:outline-none"
          />
          <select
            value={unit}
            aria-label={t.profile.unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className="h-9 rounded-full bg-surface-1 px-3 text-sm ring-1 ring-line focus:ring-accent focus:outline-none"
          >
            {(Object.keys(UNIT_MS) as Unit[]).map((u) => (
              <option key={u} value={u}>
                {t.profile.units[u]}
              </option>
            ))}
          </select>
          {first && <span className="text-xs text-fg-3">{t.profile.since(new Date(first).toLocaleDateString(lang, { dateStyle: "medium" }))}</span>}
        </div>
      )}

      {page.status === "loading" && <TrackListSkeleton rows={6} />}
      {page.status === "error" && (
        <p className="flex items-center gap-2 px-4 pt-6 text-sm text-fg-2 md:px-6">
          <WarningCircleIcon size={18} /> {page.message}
        </p>
      )}
      {stats && stats.plays === 0 && <p className="px-4 pt-6 text-sm text-fg-2 md:px-6">{t.stats.empty}</p>}
      {stats && stats.plays > 0 && <Report stats={stats} lang={lang} />}
    </div>
  );
}

type T = ReturnType<typeof useT>;

/** The big numbers: label and value. */
function numbersOf(s: Numbers, t: T): [string, string][] {
  const hours = s.minutes / 60;
  const rows: [string, string][] = [
    [t.stats.plays, s.plays.toLocaleString()],
    [t.stats.hours, hours >= 10 ? Math.round(hours).toLocaleString() : hours.toFixed(1)],
    [t.stats.tracks, s.tracks.toLocaleString()],
    [t.stats.artists, s.artists.toLocaleString()],
    [t.stats.albums, s.albums.toLocaleString()],
  ];
  if (s.dated) rows.push([t.stats.days, s.days.toLocaleString()]);
  return rows;
}

const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

function Report({ stats, lang }: { stats: Numbers; lang: string }) {
  const t = useT();
  const numbers = numbersOf(stats, t);
  const deltas: (number | null)[] = [
    stats.previous ? change(stats.plays, stats.previous.plays) : null,
    stats.previous ? change(stats.minutes, stats.previous.minutes) : null,
  ];
  const fmt = (start: number, bucket: Bucket) =>
    bucket === "hour"
      ? new Date(start).toLocaleTimeString(lang, { hour: "2-digit" })
      : bucket === "month"
        ? new Date(start).toLocaleDateString(lang, { month: "short", year: "2-digit" })
        : new Date(start).toLocaleDateString(lang, { day: "numeric", month: "numeric" });
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(lang, { weekday: "short" }));
  const peakHour = stats.hours.indexOf(Math.max(...stats.hours));
  const peakDay = stats.weekdays.indexOf(Math.max(...stats.weekdays));

  return (
    <>
      {!stats.dated && (
        <div className="mx-4 mt-4 flex gap-2 rounded-[14px] bg-surface-1 p-3 text-sm text-fg-2 ring-1 ring-line md:mx-6">
          <WarningCircleIcon size={18} className="mt-0.5 shrink-0" />
          <span>{t.stats.standalone}</span>
        </div>
      )}

      <section className="grid grid-cols-2 gap-2 px-4 pt-5 sm:grid-cols-3 lg:grid-cols-6 md:px-6">
        {numbers.map(([label, value], i) => (
          <div key={label} className="flex flex-col gap-1 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
            <span className="text-[28px] leading-none font-bold tracking-tight tabular-nums">{value}</span>
            <span className="text-xs text-fg-2">{label}</span>
            {deltas[i] != null && (
              <span className="text-[11px] text-fg-3 tabular-nums">
                {deltas[i]! >= 0 ? "+" : ""}
                {deltas[i]}% {t.stats.vsBefore}
              </span>
            )}
          </div>
        ))}
      </section>
      <p className="px-4 pt-2 text-[11px] text-fg-3 md:px-6">{t.stats.estimate}</p>

      {stats.dated && stats.series.length > 1 && (
        <Section title={t.stats.overTime}>
          <BarChart
            title={t.stats.overTime}
            bars={stats.series.map((s) => ({
              label: fmt(s.start, stats.bucket),
              value: s.plays,
              hint: `${t.stats.playsN(s.plays)} · ${Math.round(s.minutes)} min`,
            }))}
            labelEvery={Math.max(1, Math.ceil(stats.series.length / 7))}
          />
        </Section>
      )}

      {stats.dated && (
        <Section title={t.stats.when}>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-fg-2">{t.stats.byHour}</h3>
              <BarChart
                title={t.stats.byHour}
                height={110}
                labelEvery={6}
                bars={stats.hours.map((n, h) => ({ label: String(h), value: n, hint: t.stats.playsN(n) }))}
              />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-fg-2">{t.stats.byWeekday}</h3>
              <BarChart
                title={t.stats.byWeekday}
                height={110}
                bars={stats.weekdays.map((n, d) => ({ label: weekdayNames[d], value: n, hint: t.stats.playsN(n) }))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 pt-4">
            <h3 className="text-sm font-medium text-fg-2">{t.stats.heat}</h3>
            <HeatMap
              title={t.stats.heat}
              grid={stats.heat}
              rows={weekdayNames}
              hint={(d, h, n) => `${weekdayNames[d]} ${h}:00: ${t.stats.playsN(n)}`}
            />
          </div>
        </Section>
      )}

      {stats.dated && (
        <section className="grid grid-cols-2 gap-2 px-4 pt-6 sm:grid-cols-4 md:px-6">
          {stats.bestDay && (
            <Fact
              label={t.stats.bestDay}
              value={new Date(stats.bestDay.day).toLocaleDateString(lang, { day: "numeric", month: "short" })}
              sub={t.stats.playsN(stats.bestDay.plays)}
            />
          )}
          <Fact label={t.stats.peakHour} value={`${peakHour}:00`} sub={weekdayNames[peakDay]} />
          <Fact label={t.stats.longestStreak} value={t.stats.daysN(stats.streak.longest)} />
          <Fact label={t.stats.currentStreak} value={t.stats.daysN(stats.streak.current)} />
        </section>
      )}

      <Section title={t.stats.topArtists}>
        <RankBars
          items={stats.topArtists.slice(0, 10).map((a) => ({
            key: a.key,
            label: a.name,
            value: a.count,
            hint: `${t.stats.playsN(a.count)} · ${Math.round(a.minutes)} min`,
            art: a.art,
          }))}
        />
      </Section>

      <div className="pt-6">
        <h2 className="px-4 pb-1 text-xl font-semibold tracking-tight md:px-6">{t.stats.topTracks}</h2>
        <RankedTracks tracks={stats.topTracks.map((x) => ({ ...x.track, plays: t.artist.yourPlays(x.count) }))} />
      </div>

      {stats.topAlbums.length > 0 && (
        <AlbumRow
          title={t.stats.topAlbums}
          albums={stats.topAlbums
            .filter((a) => a.id)
            .map((a) => ({ id: a.id!, title: a.title, artist: `${a.artist} · ${t.stats.playsN(a.count)}`, year: "", thumb: a.art, art: a.art }))}
        />
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 px-4 pt-7 md:px-6">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
      <span className="text-xs text-fg-2">{label}</span>
      <span className="text-lg font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-fg-3">{sub}</span>}
    </div>
  );
}

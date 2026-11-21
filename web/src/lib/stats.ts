import type { PlayLog } from "./apiTypes";
import type { Track } from "./types";

// Your listening in numbers, worked out on the device from the play log of a period (api.playLog): totals,
// favourites, when you listen, streaks. Plays restored from a backup count in totals and favourites, but not in
// anything that needs the time of each play (their date is only the last play's); neither does a phone on its own.

export type Bucket = "hour" | "day" | "week" | "month";

export interface Stats {
  /** Each play has its time: the time-based parts exist. */
  dated: boolean;
  plays: number;
  /** Estimated: every play counted as the whole track. */
  minutes: number;
  tracks: number;
  artists: number;
  albums: number;
  /** Days with at least one play. */
  days: number;
  /** The same length of time just before, to compare with (none for all time). */
  previous: { plays: number; minutes: number } | null;
  topTracks: { track: Track; count: number; minutes: number }[];
  topArtists: { key: string; id?: string; name: string; count: number; minutes: number; art: string }[];
  topAlbums: { key: string; id?: string; title: string; artist: string; count: number; art: string }[];
  bucket: Bucket;
  series: { start: number; plays: number; minutes: number }[];
  /** Plays by hour of the day (0-23) and weekday (Monday first), and both together. */
  hours: number[];
  weekdays: number[];
  heat: number[][];
  bestDay: { day: number; plays: number } | null;
  streak: { longest: number; current: number };
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export function bucketFor(span: number): Bucket {
  if (span <= 2 * DAY) return "hour";
  if (span <= 92 * DAY) return "day";
  if (span <= 731 * DAY) return "week";
  return "month";
}

/** Where a time's bucket starts, in local time. */
export function bucketStart(t: number, bucket: Bucket): number {
  const d = new Date(t);
  if (bucket === "hour") return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
  if (bucket === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (bucket === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function nextBucket(t: number, bucket: Bucket): number {
  const d = new Date(t);
  if (bucket === "hour") return t + HOUR;
  if (bucket === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  if (bucket === "week") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
}

const dayOf = (t: number) => bucketStart(t, "day");

export function computeStats(log: PlayLog, since: number, until: number, compare: boolean): Stats {
  const minutesOf = (t: Track, n: number) => ((t.duration || 0) * n) / 60;
  let plays = 0;
  let minutes = 0;
  let previous = compare ? { plays: 0, minutes: 0 } : null;
  const byTrack = new Map<number, { count: number; minutes: number }>();
  const byArtist = new Map<string, Stats["topArtists"][number] & { best: number }>();
  const byAlbum = new Map<string, Stats["topAlbums"][number] & { best: number }>();
  const days = new Map<number, number>();
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  const bucket = bucketFor(until - since);
  const series = new Map<number, { plays: number; minutes: number }>();

  for (const [i, at, n, restored] of log.rows) {
    const track = log.tracks[i];
    if (!track || n <= 0) continue;
    const m = minutesOf(track, n);
    if (at < since) {
      if (previous && log.dated && !restored) {
        previous.plays += n;
        previous.minutes += m;
      }
      continue;
    }
    if (at > until) continue;
    plays += n;
    minutes += m;
    const tr = byTrack.get(i) ?? { count: 0, minutes: 0 };
    tr.count += n;
    tr.minutes += m;
    byTrack.set(i, tr);

    const artistKey = track.artistId || track.artist.toLowerCase();
    const ar = byArtist.get(artistKey) ?? { key: artistKey, id: track.artistId, name: track.artist, count: 0, minutes: 0, art: "", best: 0 };
    ar.count += n;
    ar.minutes += m;
    // The picture of their track you play most.
    if (tr.count > ar.best) {
      ar.best = tr.count;
      ar.art = track.art || track.thumb;
    }
    byArtist.set(artistKey, ar);

    if (track.album) {
      const albumKey = track.albumId || `${track.album.toLowerCase()}|${artistKey}`;
      const al = byAlbum.get(albumKey) ?? { key: albumKey, id: track.albumId, title: track.album, artist: track.artist, count: 0, art: "", best: 0 };
      al.count += n;
      if (tr.count > al.best) {
        al.best = tr.count;
        al.art = track.art || track.thumb;
      }
      byAlbum.set(albumKey, al);
    }

    if (!log.dated || restored) continue;
    const d = new Date(at);
    const wd = (d.getDay() + 6) % 7;
    hours[d.getHours()] += n;
    weekdays[wd] += n;
    heat[wd][d.getHours()] += n;
    days.set(dayOf(at), (days.get(dayOf(at)) ?? 0) + n);
    const b = bucketStart(at, bucket);
    const s = series.get(b) ?? { plays: 0, minutes: 0 };
    s.plays += n;
    s.minutes += m;
    series.set(b, s);
  }

  // Every bucket of the period, empty ones too (at most a few hundred).
  const timeline: Stats["series"] = [];
  if (log.dated) {
    for (let b = bucketStart(since, bucket); b <= until && timeline.length < 800; b = nextBucket(b, bucket)) {
      const s = series.get(b);
      timeline.push({ start: b, plays: s?.plays ?? 0, minutes: s?.minutes ?? 0 });
    }
  }

  // Streaks of days in a row with music.
  const sorted = [...days.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let prev = 0;
  for (const d of sorted) {
    run = prev && dayOf(prev + DAY + 2 * HOUR) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  const today = dayOf(Math.min(Date.now(), until));
  let current = 0;
  for (let d = days.has(today) ? today : dayOf(today - 12 * HOUR); days.has(d); d = dayOf(d - 12 * HOUR)) current++;

  let bestDay: Stats["bestDay"] = null;
  for (const [day, n] of days) if (!bestDay || n > bestDay.plays) bestDay = { day, plays: n };

  const topTracks = [...byTrack]
    .map(([i, v]) => ({ track: log.tracks[i], count: v.count, minutes: v.minutes }))
    .sort((a, b) => b.count - a.count || b.minutes - a.minutes);
  const strip = <T extends { best: number }>({ best: _b, ...rest }: T) => rest;

  return {
    dated: log.dated,
    plays,
    minutes,
    tracks: byTrack.size,
    artists: byArtist.size,
    albums: byAlbum.size,
    days: days.size,
    previous: previous && previous.plays > 0 ? previous : null,
    topTracks: topTracks.slice(0, 50),
    topArtists: [...byArtist.values()].sort((a, b) => b.count - a.count).slice(0, 20).map(strip),
    topAlbums: [...byAlbum.values()].sort((a, b) => b.count - a.count).slice(0, 20).map(strip),
    bucket,
    series: timeline,
    hours,
    weekdays,
    heat,
    bestDay,
    streak: { longest, current: Math.min(current, longest || current) },
  };
}

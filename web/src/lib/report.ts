import { accentOnDark, DEFAULT_ACCENT, isHex, withAlpha } from "./accent";
import type { Stats } from "./stats";

// The listening report as a picture to share, in the app's dark colours and the user's accent. As much as the
// numbers allow: on a phone on its own (no time per play) the totals and the top artists, tracks and albums; with a
// server, also the highlights, when you listen (by hour and weekday) and the plays over time, in a taller picture.

export interface ReportText {
  title: string;
  period: string;
  name: string;
  /** Up to 6: value, label and, against the period before, a change ("+12%"). */
  numbers: { value: string; label: string; delta?: string }[];
  /** Under the numbers when some have a change: what the change is against. */
  deltaNote: string;
  artists: string;
  tracks: string;
  albums: string;
  plays: (n: number) => string;
  /** With a time per play (a server): */
  facts?: { label: string; value: string; sub?: string }[];
  overTime?: string;
  byHour?: string;
  byWeekday?: string;
  weekdayNames?: string[];
}

const W = 1080;
const M = 72;
const BG = "#0d0f0c";
const CARD = "#171a15";
const INK = "#f2f4ef";
const INK2 = "#a9ae9f";
const INK3 = "#6f7466";

export async function reportImage(stats: Stats, text: ReportText, accentHex: string): Promise<Blob> {
  const accent = isHex(accentHex) ? accentHex : DEFAULT_ACCENT;
  const accentText = accentOnDark(accent);
  // Drawn on a tall canvas, then cut where the content ends.
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 2400;
  const c = canvas.getContext("2d")!;
  const font = (size: number, weight = 400) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const fit = (s: string, max: number) => {
    if (c.measureText(s).width <= max) return s;
    let t = s;
    while (t.length > 1 && c.measureText(`${t}...`).width > max) t = t.slice(0, -1);
    return `${t}...`;
  };
  const card = (x: number, y: number, w: number, h: number) => {
    c.fillStyle = CARD;
    c.beginPath();
    c.roundRect(x, y, w, h, 24);
    c.fill();
  };
  const heading = (s: string, x: number, y: number) => {
    c.fillStyle = accentText;
    c.font = font(28, 700);
    c.fillText(s, x, y);
  };
  const bars = (values: number[], x: number, y: number, w: number, h: number, labels?: (i: number) => string | null) => {
    const max = Math.max(1, ...values);
    const gap = values.length > 120 ? 0 : values.length > 40 ? 1 : 4;
    const bw = (w - gap * (values.length - 1)) / values.length;
    c.fillStyle = accent;
    values.forEach((v, i) => {
      if (!v) return;
      const bh = Math.max(3, (v / max) * h);
      const r = Math.min(4, bw / 2);
      c.beginPath();
      c.roundRect(x + i * (bw + gap), y + h - bh, Math.max(1, bw), bh, [r, r, 0, 0]);
      c.fill();
    });
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.fillRect(x, y + h, w, 2);
    if (!labels) return;
    c.fillStyle = INK3;
    c.font = font(20, 500);
    values.forEach((_, i) => {
      const label = labels(i);
      if (label) c.fillText(label, x + i * (bw + gap), y + h + 30);
    });
  };
  const list = (x: number, y: number, w: number, title: string, rows: [string, string][], step = 76) => {
    heading(title, x, y);
    rows.slice(0, 5).forEach(([name, sub], i) => {
      const ry = y + 56 + i * step;
      c.fillStyle = INK3;
      c.font = font(28, 700);
      c.fillText(String(i + 1), x, ry);
      c.fillStyle = INK;
      c.font = font(30, 600);
      c.fillText(fit(name, w - 50), x + 44, ry);
      c.fillStyle = INK2;
      c.font = font(22, 400);
      c.fillText(fit(sub, w - 50), x + 44, ry + 30);
    });
    return y + 56 + Math.min(5, rows.length) * step - 20;
  };

  c.fillStyle = BG;
  c.fillRect(0, 0, W, canvas.height);
  const glow = c.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, 760);
  glow.addColorStop(0, withAlpha(accent, 0.24));
  glow.addColorStop(1, withAlpha(accent, 0));
  c.fillStyle = glow;
  c.fillRect(0, 0, W, 900);

  c.fillStyle = accentText;
  c.font = font(30, 700);
  c.fillText("musike", M, 100);
  c.fillStyle = INK;
  c.font = font(64, 800);
  c.fillText(fit(text.title, W - 2 * M), M, 190);
  c.fillStyle = INK2;
  c.font = font(32, 500);
  c.fillText(fit(`${text.name} · ${text.period}`, W - 2 * M), M, 240);

  // The big numbers, three by row.
  let y = 290;
  const cols = 3;
  const cw = (W - 2 * M - (cols - 1) * 20) / cols;
  const numbers = text.numbers.slice(0, 6);
  const tileH = numbers.some((n) => n.delta) ? 160 : 130;
  numbers.forEach((n, i) => {
    const x = M + (i % cols) * (cw + 20);
    const ty = y + Math.floor(i / cols) * (tileH + 20);
    card(x, ty, cw, tileH);
    c.fillStyle = INK;
    c.font = font(52, 800);
    c.fillText(fit(n.value, cw - 48), x + 24, ty + 70);
    c.fillStyle = INK2;
    c.font = font(26, 500);
    c.fillText(fit(n.label, cw - 48), x + 24, ty + 108);
    if (n.delta) {
      c.fillStyle = n.delta.startsWith("-") ? INK3 : accentText;
      c.font = font(24, 700);
      c.fillText(n.delta, x + 24, ty + 142);
    }
  });
  y += Math.ceil(numbers.length / cols) * (tileH + 20);
  if (numbers.some((n) => n.delta)) {
    c.fillStyle = INK3;
    c.font = font(22, 400);
    c.fillText(fit(`%: ${text.deltaNote}`, W - 2 * M), M, y + 10);
    y += 30;
  }

  // Highlights: best day, peak hour, streaks.
  const facts = text.facts ?? [];
  if (facts.length) {
    y += 20;
    const fw = (W - 2 * M - (facts.length - 1) * 16) / facts.length;
    facts.forEach((f, i) => {
      const x = M + i * (fw + 16);
      card(x, y, fw, 140);
      c.fillStyle = INK2;
      c.font = font(22, 500);
      c.fillText(fit(f.label, fw - 40), x + 20, y + 40);
      c.fillStyle = INK;
      c.font = font(36, 800);
      c.fillText(fit(f.value, fw - 40), x + 20, y + 88);
      if (f.sub) {
        c.fillStyle = INK3;
        c.font = font(22, 400);
        c.fillText(fit(f.sub, fw - 40), x + 20, y + 120);
      }
    });
    y += 140;
  }

  // Top artists and tracks, side by side.
  const colW = (W - 2 * M - 40) / 2;
  y += 90;
  const endArtists = list(M, y, colW, text.artists, stats.topArtists.map((a) => [a.name, text.plays(a.count)]));
  const endTracks = list(M + colW + 40, y, colW, text.tracks, stats.topTracks.map((t) => [t.track.title, t.track.artist]));
  y = Math.max(endArtists, endTracks);

  // Top albums; with a server, when you listen beside them.
  const albums: [string, string][] = stats.topAlbums.map((a) => [a.title, `${a.artist} · ${text.plays(a.count)}`]);
  const when = stats.dated && text.byHour && text.byWeekday;
  if (albums.length || when) {
    y += 80;
    const start = y;
    let end = y;
    if (albums.length) end = list(M, start, when ? colW : W - 2 * M, text.albums, albums, 70);
    if (when) {
      const x = albums.length ? M + colW + 40 : M;
      const w = albums.length ? colW : W - 2 * M;
      heading(text.byHour!, x, start);
      bars(stats.hours, x, start + 24, w, 110, (h) => (h % 6 === 0 ? String(h) : null));
      heading(text.byWeekday!, x, start + 210);
      const names = text.weekdayNames ?? [];
      bars(stats.weekdays, x, start + 234, w, 110, (d) => names[d] ?? null);
      end = Math.max(end, start + 234 + 110 + 30);
    }
    y = end;
  }

  // Plays over time.
  if (stats.dated && text.overTime && stats.series.length > 1) {
    y += 80;
    heading(text.overTime, M, y);
    bars(
      stats.series.map((s) => s.plays),
      M,
      y + 24,
      W - 2 * M,
      150,
    );
    y += 24 + 150;
  }

  const height = Math.round(y + 72);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = height;
  out.getContext("2d")!.drawImage(canvas, 0, 0, W, height, 0, 0, W, height);
  return new Promise((done, fail) => out.toBlob((b) => (b ? done(b) : fail(new Error("image"))), "image/png"));
}

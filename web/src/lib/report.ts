import type { Stats } from "./stats";

// The listening report as a picture (1080 x 1350), to share: the period, the big numbers, top artists and tracks,
// and the plays over time. Drawn on a canvas, in the app's dark colours.

export interface ReportText {
  title: string;
  period: string;
  name: string;
  numbers: [string, string][];
  artists: string;
  tracks: string;
  overTime: string;
  plays: (n: number) => string;
}

const BG = "#0d0f0c";
const CARD = "#171a15";
const INK = "#f2f4ef";
const INK2 = "#a9ae9f";
const ACCENT = "#c3ec52";

export async function reportImage(stats: Stats, text: ReportText): Promise<Blob> {
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext("2d")!;
  const font = (size: number, weight = 400) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const fit = (s: string, max: number) => {
    if (c.measureText(s).width <= max) return s;
    let t = s;
    while (t.length > 1 && c.measureText(`${t}...`).width > max) t = t.slice(0, -1);
    return `${t}...`;
  };

  c.fillStyle = BG;
  c.fillRect(0, 0, W, H);
  const glow = c.createRadialGradient(W * 0.85, 0, 0, W * 0.85, 0, 700);
  glow.addColorStop(0, "rgba(195,236,82,0.22)");
  glow.addColorStop(1, "rgba(195,236,82,0)");
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  c.fillStyle = ACCENT;
  c.font = font(30, 700);
  c.fillText("musike", 72, 100);
  c.fillStyle = INK;
  c.font = font(64, 800);
  c.fillText(fit(text.title, W - 144), 72, 190);
  c.fillStyle = INK2;
  c.font = font(32, 500);
  c.fillText(fit(`${text.name} · ${text.period}`, W - 144), 72, 240);

  // The big numbers, three by row.
  const cols = 3;
  const cw = (W - 144 - (cols - 1) * 20) / cols;
  text.numbers.slice(0, 6).forEach(([value, label], i) => {
    const x = 72 + (i % cols) * (cw + 20);
    const y = 290 + Math.floor(i / cols) * 150;
    c.fillStyle = CARD;
    c.beginPath();
    c.roundRect(x, y, cw, 130, 24);
    c.fill();
    c.fillStyle = INK;
    c.font = font(52, 800);
    c.fillText(fit(value, cw - 48), x + 24, y + 70);
    c.fillStyle = INK2;
    c.font = font(26, 500);
    c.fillText(fit(label, cw - 48), x + 24, y + 108);
  });

  // Top 5 artists and tracks, side by side.
  const listY = 640;
  const colW = (W - 144 - 40) / 2;
  const list = (x: number, heading: string, rows: [string, string][]) => {
    c.fillStyle = ACCENT;
    c.font = font(28, 700);
    c.fillText(heading, x, listY);
    rows.slice(0, 5).forEach(([name, sub], i) => {
      const y = listY + 56 + i * 76;
      c.fillStyle = INK2;
      c.font = font(28, 700);
      c.fillText(String(i + 1), x, y);
      c.fillStyle = INK;
      c.font = font(30, 600);
      c.fillText(fit(name, colW - 50), x + 44, y);
      c.fillStyle = INK2;
      c.font = font(22, 400);
      c.fillText(fit(sub, colW - 50), x + 44, y + 30);
    });
  };
  list(72, text.artists, stats.topArtists.map((a) => [a.name, text.plays(a.count)]));
  list(72 + colW + 40, text.tracks, stats.topTracks.map((t) => [t.track.title, t.track.artist]));

  // Plays over time.
  const series = stats.series;
  if (series.length > 1) {
    const top = 1130;
    const height = 150;
    c.fillStyle = ACCENT;
    c.font = font(28, 700);
    c.fillText(text.overTime, 72, top - 20);
    const max = Math.max(1, ...series.map((s) => s.plays));
    const gap = series.length > 120 ? 0 : 2;
    const bw = (W - 144 - gap * (series.length - 1)) / series.length;
    c.fillStyle = ACCENT;
    series.forEach((s, i) => {
      if (!s.plays) return;
      const h = Math.max(3, (s.plays / max) * height);
      c.beginPath();
      c.roundRect(72 + i * (bw + gap), top + height - h, Math.max(1, bw), h, [Math.min(4, bw / 2), Math.min(4, bw / 2), 0, 0]);
      c.fill();
    });
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.fillRect(72, top + height, W - 144, 2);
  }

  return new Promise((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("image"))), "image/png"));
}

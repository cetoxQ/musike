import { fileURLToPath } from "node:url";
import path from "node:path";

// Folder of the server package (bundled builds pass every path through env instead).
const root = typeof import.meta.url === "string" ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") : process.cwd();

export const config = {
  port: Number(process.env.PORT ?? 4180),
  host: process.env.HOST ?? "0.0.0.0",
  /** Explicit yt-dlp executable. When unset it is located automatically (see tools.ts). */
  ytdlpPath: process.env.YTDLP_PATH || null,
  // Extra yt-dlp flags, e.g. YTDLP_EXTRA_ARGS="--cookies-from-browser firefox"
  ytdlpExtraArgs: (process.env.YTDLP_EXTRA_ARGS ?? "").split(" ").filter(Boolean),
  /**
   * YTDLP_CHANNEL=stable|nightly: keep yt-dlp on that channel and up to date, at start and once a day (a recreated
   * container comes back with the image's yt-dlp). Unset: yt-dlp changes only from Settings.
   */
  ytdlpChannel: (["stable", "nightly"].includes(process.env.YTDLP_CHANNEL ?? "") ? process.env.YTDLP_CHANNEL : null) as
    | "stable"
    | "nightly"
    | null,
  /**
   * MUSIKE_DIRECT_AUDIO=first: start audio from YouTube's API directly (in-process, about half a second, the way
   * the Android app plays), and use yt-dlp only when that fails. By default yt-dlp comes first (a few seconds).
   */
  directAudioFirst: process.env.MUSIKE_DIRECT_AUDIO === "first",
  dataDir: process.env.MUSIKE_DATA_DIR ?? path.join(root, "data"),
  /** MUSIKE_AUTH=on: accounts. Everyone signs in and has their own library; an admin manages the accounts. */
  auth: ["on", "true", "1"].includes((process.env.MUSIKE_AUTH ?? "").toLowerCase()),
  /**
   * Behind a reverse proxy, which proxies to believe for the client's address (X-Forwarded-For) and for HTTPS:
   * "true" (any), or addresses and ranges (e.g. "127.0.0.1,172.16.0.0/12"). Unset: none.
   */
  trustProxy: trustProxy(process.env.MUSIKE_TRUST_PROXY ?? ""),
  /**
   * Other addresses Musike's pages are opened from (e.g. "https://musike.example.com"), for proxies that don't
   * pass the original Host on: requests that change something are refused from any other origin.
   */
  allowedOrigins: (process.env.MUSIKE_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  /** Where the library lives: "sqlite" (data/musike.db) or "json" (data/library.json). Unset: SQLite when Node has it. */
  library: (["sqlite", "json"].includes(process.env.MUSIKE_LIBRARY ?? "") ? process.env.MUSIKE_LIBRARY : "auto") as "sqlite" | "json" | "auto",
  cacheDir: process.env.MUSIKE_CACHE_DIR ?? path.join(root, "cache"),
  /** HD video cache limit; least recently played videos are evicted first. */
  cacheMaxBytes: Number(process.env.MUSIKE_CACHE_MAX_MB ?? 2048) * 1024 * 1024,
  webDist: process.env.MUSIKE_WEB_DIST ?? path.resolve(root, "..", "web", "dist"),
  /**
   * Private folder for yt-dlp, Deno and FFmpeg downloaded by Musike itself (the desktop app sets it).
   * Searched before the system PATH, and where "Instalar" puts the tools when set.
   */
  binDir: process.env.MUSIKE_BIN_DIR || null,
  /** YouTube Music language when a request doesn't say (the app always does). */
  lang: process.env.MUSIKE_LANG ?? "en",
  location: process.env.MUSIKE_LOCATION ?? "BR",
  /** HTTP for youtubei.js; the platform's own fetch here (the Android app passes its native one). */
  fetch: undefined as typeof fetch | undefined,
};

function trustProxy(v: string): boolean | string[] {
  const list = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return false;
  return list.length === 1 && list[0] === "true" ? true : list;
}

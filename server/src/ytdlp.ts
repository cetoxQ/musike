import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureComponent } from "./bootstrap.js";
import { config } from "./config.js";
import { DEFAULT_CLIENTS, directAudio, fetchRemoteClients } from "./directAudio.js";
import { tools } from "./tools.js";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";

export interface StreamFormat {
  formatId: string;
  url: string;
  headers: Record<string, string>;
  mime: string;
  /**
   * When YouTube starts serving the URL (ms since epoch). Some streams are held back for as long as the pre-roll
   * ad would have played, and answer 403 until then; yt-dlp reports the moment as `available_at` and waits for it.
   */
  availableAt?: number;
}

export interface Resolved {
  id: string;
  title: string;
  duration: number;
  audio: StreamFormat;
  /** The ready-made SD stream (video and audio together, 360p), when YouTube has one. */
  video?: StreamFormat;
  /** The video qualities YouTube offers (lines, e.g. 720), each with the format to download. Unknown: empty. */
  qualities?: VideoChoice[];
  /** The audio to download with a video: AAC where there is one, so the MP4 plays everywhere. */
  audioFormatId?: string;
  expiresAt: number;
}

export interface VideoChoice {
  height: number;
  formatId: string;
}

interface RawFormat {
  format_id: string;
  url?: string;
  ext: string;
  acodec?: string;
  vcodec?: string;
  height?: number;
  width?: number;
  /** YouTube's own label for the quality, e.g. "720p60". */
  format_note?: string;
  fps?: number;
  tbr?: number;
  abr?: number;
  protocol?: string;
  http_headers?: Record<string, string>;
  /** Unix time (seconds) from which YouTube serves this format; see StreamFormat.availableAt. */
  available_at?: number;
}

const RESOLVE_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

let maintenance: Promise<unknown> | null = null;

/** While yt-dlp is being updated or installed, new runs wait instead of racing the executable swap. */
export function holdDuring<T>(job: Promise<T>): Promise<T> {
  const p = job.finally(() => {
    if (maintenance === p) maintenance = null;
  });
  maintenance = p;
  return p;
}

/**
 * How many yt-dlp processes run at once. Each is Python plus Deno for YouTube's challenges, a couple of hundred MB:
 * past these, requests wait their turn instead of filling the server's memory. HD downloads (minutes each) have
 * their own lane, so they never hold up a track that's about to start.
 */
const LANES = { quick: 4, download: 2 } as const;
type Lane = keyof typeof LANES;
const running: Record<Lane, number> = { quick: 0, download: 0 };
const waiting: Record<Lane, (() => void)[]> = { quick: [], download: [] };

/** Waits for a free place in the lane; the function it returns gives the place to the next in line. */
function turn(lane: Lane): Promise<() => void> {
  const release = () => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = waiting[lane].shift();
      if (next) next();
      else running[lane]--;
    };
  };
  if (running[lane] < LANES[lane]) {
    running[lane]++;
    return Promise.resolve(release());
  }
  return new Promise((resolve) => waiting[lane].push(() => resolve(release())));
}

async function run(args: string[], timeoutMs: number, lane: Lane = "quick"): Promise<string> {
  if (maintenance) await maintenance.catch(() => {});
  const { ytdlp, env } = tools();
  if (!ytdlp) {
    throw new HttpError(503, msg("ytdlpMissing"), "tool_missing");
  }
  const done = await turn(lane);
  try {
    return await spawnYtdlp(ytdlp, env, args, timeoutMs);
  } finally {
    done();
  }
}

function spawnYtdlp(ytdlp: string, env: NodeJS.ProcessEnv, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlp, [...config.ytdlpExtraArgs, ...args], { windowsHide: true, env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new HttpError(504, msg("ytdlpTimeout")));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new HttpError(503, msg("ytdlpCantRun", { error: err.message }), "tool_missing"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      reject(toHttpError(stderr));
    });
  });
}

// Failures that usually mean YouTube changed and yt-dlp needs an update.
const OUTDATED = /nsig|signature|n challenge|JavaScript runtime|Unable to extract|Failed to extract|player response|Requested format is not available|HTTP Error 403/i;

function toHttpError(stderr: string): HttpError {
  const line = stderr.split("\n").find((l) => l.includes("ERROR")) ?? stderr.trim().split("\n").pop() ?? "";
  if (/confirm you.re not a bot|Sign in to confirm/i.test(line)) {
    return new HttpError(503, msg("botCheck"), "bot_check");
  }
  if (/Video unavailable|video is unavailable|Private video|removed/i.test(line)) {
    return new HttpError(404, msg("videoUnavailable"));
  }
  if (/age-restricted|inappropriate|confirm your age/i.test(line)) {
    return new HttpError(403, msg("ageRestricted"));
  }
  // yt-dlp's own words stay as they are (English); only the advice around them is translated.
  const detail = line.replace(/^ERROR:\s*/, "").slice(0, 240);
  if (!detail) return new HttpError(502, msg("ytdlpFailed"), "maybe_outdated");
  if (OUTDATED.test(stderr)) return new HttpError(502, msg("ytdlpOutdated", { detail }), "maybe_outdated");
  return new HttpError(502, detail, "maybe_outdated");
}

/** Forget resolved stream URLs, e.g. after updating yt-dlp so the next play uses the new version. */
export function clearResolved() {
  resolvedAt.clear();
}

const isAudioOnly = (f: RawFormat) => !!f.url && f.vcodec === "none" && !!f.acodec && f.acodec !== "none";
const isMuxed = (f: RawFormat) => !!f.url && !!f.vcodec && f.vcodec !== "none" && !!f.acodec && f.acodec !== "none";
const isHttps = (f: RawFormat) => !f.protocol || f.protocol === "https";

function toStream(f: RawFormat, kind: "audio" | "video"): StreamFormat {
  const mime = kind === "audio" ? (f.ext === "webm" ? "audio/webm" : "audio/mp4") : "video/mp4";
  const availableAt = typeof f.available_at === "number" && f.available_at > 0 ? f.available_at * 1000 : undefined;
  return { formatId: f.format_id, url: f.url!, headers: f.http_headers ?? {}, mime, availableAt };
}

function pickAudio(formats: RawFormat[]): RawFormat | undefined {
  const audio = formats.filter((f) => isAudioOnly(f) && isHttps(f));
  // AAC in MP4 plays everywhere, including iOS Safari. Opus/WebM is the fallback.
  return (
    audio.find((f) => f.format_id === "140") ??
    audio.filter((f) => f.ext === "m4a").sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0] ??
    audio.sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0]
  );
}

function pickVideo(formats: RawFormat[]): RawFormat | undefined {
  const muxed = formats.filter((f) => isMuxed(f) && isHttps(f) && f.ext === "mp4");
  return muxed.find((f) => f.format_id === "18") ?? muxed.sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
}

/** H.264 plays everywhere; VP9 widely; AV1 is slow to decode on older devices. */
const codecRank = (v = "") => (v.startsWith("avc1") ? 3 : v.startsWith("vp09") || v.startsWith("vp9") ? 2 : v.startsWith("av01") ? 1 : 0);

/** The qualities a video comes in, by YouTube's label (a vertical 1080p clip is 1080, not 1920), best format each. */
function videoChoices(formats: RawFormat[]): VideoChoice[] {
  const best = new Map<number, RawFormat>();
  for (const f of formats) {
    if (!f.vcodec || f.vcodec === "none" || (f.acodec && f.acodec !== "none") || !isHttps(f)) continue;
    const label = Number(/^(\d{3,4})p/.exec(f.format_note ?? "")?.[1]) || Math.min(f.width ?? 0, f.height ?? 0);
    if (!label) continue;
    const prev = best.get(label);
    const better =
      !prev ||
      codecRank(f.vcodec) > codecRank(prev.vcodec) ||
      (codecRank(f.vcodec) === codecRank(prev.vcodec) && ((f.fps ?? 0) > (prev.fps ?? 0) || ((f.fps ?? 0) === (prev.fps ?? 0) && (f.tbr ?? 0) > (prev.tbr ?? 0))));
    if (better) best.set(label, f);
  }
  return [...best].map(([height, f]) => ({ height, formatId: f.format_id })).sort((a, b) => a.height - b.height);
}

/** The quality to download for a wish: the highest at or under it (and under the server's limit), else the lowest. */
function choiceFor(choices: VideoChoice[], wanted: number): VideoChoice | undefined {
  const cap = Math.min(wanted, config.videoMaxHeight);
  const under = choices.filter((c) => c.height <= cap);
  return under[under.length - 1] ?? choices[0];
}

/** The qualities a video can be played in here (under MUSIKE_VIDEO_MAX_HEIGHT), and that limit. */
export async function videoQualities(id: string): Promise<{ qualities: number[]; max: number }> {
  const r = await resolveStreams(id);
  const heights = new Set((r.qualities ?? []).map((c) => c.height).filter((h) => h <= config.videoMaxHeight));
  if (r.video) heights.add(360);
  return { qualities: [...heights].sort((a, b) => a - b), max: config.videoMaxHeight };
}

function expiryOf(url: string): number {
  const expire = Number(new URL(url).searchParams.get("expire"));
  const fallback = Date.now() + 4 * 3600_000;
  // Refresh 10 minutes before googlevideo URLs expire.
  return Number.isFinite(expire) && expire > 0 ? expire * 1000 - 10 * 60_000 : fallback;
}

const cache = new Map<string, Promise<Resolved>>();
const resolvedAt = new Map<string, Resolved>();

/** Resolutions are kept while their URLs work: the expired ones are dropped every hour, not kept forever. */
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of resolvedAt) if (r.expiresAt <= now) resolvedAt.delete(id);
  for (const [id, f] of directResolved) if (f.expiresAt <= now) directResolved.delete(id);
}, 3600_000).unref();

// When yt-dlp fails, the clients to ask YouTube directly (see directAudio.ts), refreshed from the repository.
// Read lazily: directAudio.ts and this module import each other through search.ts.
let directClients: string[] | null = null;
let directClientsAt = 0;

async function clientsForDirect(): Promise<string[]> {
  if (Date.now() - directClientsAt > 6 * 3600_000) {
    directClientsAt = Date.now();
    // Refreshed in the background: a slow GitHub mustn't hold back the track (up to 6 s). Only the very first
    // time waits, briefly, so a fix published there is used from the start.
    const refresh = fetchRemoteClients().then((clients) => {
      directClients = clients ?? directClients;
    });
    if (!directClients) await Promise.race([refresh, sleep(1_500)]);
  }
  return directClients ?? DEFAULT_CLIENTS;
}

/**
 * Plan B for audio: YouTube's bot check stops yt-dlp on some connections (VPNs, shared networks), and a YouTube
 * change can break it until it's updated. Asking YouTube for the audio directly often still works. Video stays
 * yt-dlp's job.
 */
async function resolveDirect(id: string, ytdlpError: unknown): Promise<Resolved> {
  // Removed, private or age-restricted videos won't play any other way either.
  if (ytdlpError instanceof HttpError && (ytdlpError.status === 403 || ytdlpError.status === 404)) throw ytdlpError;
  try {
    const direct = await directAudio(id, await clientsForDirect());
    return {
      id,
      title: direct.title,
      duration: direct.duration,
      audio: { formatId: "direct", url: direct.url, headers: {}, mime: direct.mime },
      expiresAt: direct.expiresAt - 10 * 60_000,
    };
  } catch {
    throw ytdlpError; // yt-dlp's error says more, and may offer the update
  }
}

/**
 * Plan B for the player itself: YouTube can accept the resolution and still refuse the bytes (bot checks,
 * VPNs), and then the cached yt-dlp URL keeps answering 403. Asking for the audio directly often works.
 */
export async function directAudioStream(id: string): Promise<StreamFormat | null> {
  try {
    const direct = await directAudio(id, await clientsForDirect());
    const audio: StreamFormat = { formatId: "direct", url: direct.url, headers: {}, mime: direct.mime };
    // Point the cache at the URL that works, so the next Range request doesn't go through this again.
    const expiresAt = direct.expiresAt - 10 * 60_000;
    const resolved = resolvedAt.get(id);
    if (resolved) resolvedAt.set(id, { ...resolved, audio, expiresAt: Math.min(resolved.expiresAt, expiresAt) });
    directResolved.set(id, { ...audio, expiresAt });
    return audio;
  } catch {
    return null;
  }
}

export function resolveStreams(id: string): Promise<Resolved> {
  const done = resolvedAt.get(id);
  if (done && done.expiresAt > Date.now()) return Promise.resolve(done);
  const inflight = cache.get(id);
  if (inflight) return inflight;

  const job = run(["-J", "--no-playlist", "--no-warnings", `https://www.youtube.com/watch?v=${id}`], RESOLVE_TIMEOUT_MS)
    .then((stdout): Resolved => {
      const info = JSON.parse(stdout) as { title: string; duration?: number; formats: RawFormat[] };
      const audio = pickAudio(info.formats);
      if (!audio) throw new HttpError(404, msg("noAudio"));
      const video = pickVideo(info.formats);
      return {
        id,
        title: info.title,
        duration: info.duration ?? 0,
        audio: toStream(audio, "audio"),
        video: video ? toStream(video, "video") : undefined,
        qualities: videoChoices(info.formats),
        audioFormatId: audio.format_id,
        expiresAt: expiryOf(audio.url!),
      };
    })
    .catch((err) => resolveDirect(id, err))
    .then((resolved) => {
      resolvedAt.set(id, resolved);
      return resolved;
    })
    .finally(() => cache.delete(id));

  cache.set(id, job);
  return job;
}

export function invalidate(id: string) {
  resolvedAt.delete(id);
  directResolved.delete(id);
}

const directResolved = new Map<string, StreamFormat & { expiresAt: number }>();

/**
 * The audio stream to play now. A full yt-dlp resolution already at hand (prefetched) is used as is. Otherwise,
 * with MUSIKE_DIRECT_AUDIO=first, YouTube's API is asked directly: no yt-dlp process to start, and the VISIONOS
 * client it uses isn't held back. yt-dlp remains the way when that fails, and for video.
 */
export async function resolveAudio(id: string): Promise<StreamFormat> {
  const full = resolvedAt.get(id);
  if (full && full.expiresAt > Date.now()) return full.audio;
  if (config.directAudioFirst) {
    const hit = directResolved.get(id);
    if (hit && hit.expiresAt > Date.now()) return hit;
    try {
      const d = await directAudio(id, await clientsForDirect());
      const fmt = { formatId: "direct", url: d.url, headers: {}, mime: d.mime, expiresAt: d.expiresAt - 10 * 60_000 };
      directResolved.set(id, fmt);
      return fmt;
    } catch {
      // yt-dlp below says more when it fails too
    }
  }
  return (await resolveStreams(id)).audio;
}

const downloads = new Map<string, Promise<string>>();

/** Keeps the video cache under `config.cacheMaxBytes`, evicting least recently played files first. */
export async function pruneCache(): Promise<void> {
  if (!existsSync(config.cacheDir)) return;
  const names = (await readdir(config.cacheDir)).filter((n) => /\.\d+\.mp4$/.test(n));
  const files = await Promise.all(
    names.map(async (n) => {
      const p = path.join(config.cacheDir, n);
      const s = await stat(p);
      return { p, size: s.size, used: s.mtimeMs };
    }),
  );
  let total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files.sort((a, b) => a.used - b.used)) {
    if (total <= config.cacheMaxBytes) break;
    await rm(f.p, { force: true });
    total -= f.size;
  }
}

/**
 * Downloads a video in the quality asked for (or the nearest under it) with its audio, merged into an MP4 in the
 * cache, for playback with seeking. The file is named after the quality it really has, so asking for 1080 on a video
 * that stops at 720 reuses the 720 file.
 */
export async function downloadVideo(id: string, wanted: number): Promise<string> {
  let resolved: Resolved | null = null;
  try {
    resolved = await resolveStreams(id);
  } catch {
    // yt-dlp below says why, if it fails too
  }
  const choice = choiceFor(resolved?.qualities ?? [], wanted);
  const height = choice?.height ?? Math.min(wanted, config.videoMaxHeight);
  const file = path.join(config.cacheDir, `${id}.${height}.mp4`);
  if (existsSync(file)) {
    // Mark as recently used for cache eviction.
    const now = new Date();
    utimes(file, now, now).catch(() => {});
    return file;
  }
  const key = `${id}.${height}`;
  const inflight = downloads.get(key);
  if (inflight) return inflight;

  // The format picked from the formats YouTube listed, then yt-dlp's own pick for that height as a fallback.
  const exact = choice && resolved?.audioFormatId ? `${choice.formatId}+${resolved.audioFormatId}/` : "";
  const formats =
    `${exact}bv*[height<=${height}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${height}]+ba[ext=m4a]/` +
    `bv*[height<=${height}]+ba/b[height<=${height}]/b`;
  const tmp = path.join(config.cacheDir, `${id}.${height}.part.mp4`);
  // Merging video + audio needs FFmpeg; the desktop app fetches it on first use if it isn't there yet.
  const job = (tools().ffmpeg || !config.binDir ? Promise.resolve() : ensureComponent("ffmpeg"))
    .then(() => mkdir(config.cacheDir, { recursive: true }))
    .then(() =>
      run(
        [
          "--no-playlist",
          "--no-warnings",
          "--no-part",
          "-N", "4",
          "-f", formats,
          "--merge-output-format", "mp4",
          "-o", tmp,
          `https://www.youtube.com/watch?v=${id}`,
        ],
        DOWNLOAD_TIMEOUT_MS,
        "download",
      ),
    )
    .then(async () => {
      await rename(tmp, file);
      pruneCache().catch(() => {});
      return file;
    })
    .catch(async (err) => {
      await rm(tmp, { force: true });
      throw err;
    })
    .finally(() => downloads.delete(key));

  downloads.set(key, job);
  return job;
}

export async function ytdlpSearch(query: string, limit = 20) {
  const stdout = await run(["-J", "--flat-playlist", "--no-warnings", `ytsearch${limit}:${query}`], RESOLVE_TIMEOUT_MS);
  const data = JSON.parse(stdout) as {
    entries: { id: string; title: string; duration?: number; channel?: string; uploader?: string }[];
  };
  return data.entries ?? [];
}

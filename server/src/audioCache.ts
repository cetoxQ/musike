import { existsSync } from "node:fs";
import { mkdir, open, rename, rm, utimes } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "./config.js";
import { invalidate, pruneCache, resolveAudio, type StreamFormat } from "./ytdlp.js";

/**
 * The audio of the tracks coming next in a queue, fetched ahead into the cache: the player asks for it as a track
 * starts (POST /api/prefetch/:id/audio), and the stream route then serves the file from disk. The next track starts
 * at once, seeks without asking YouTube, and doesn't depend on a URL that expires or is held back.
 */

/** A long mix isn't kept: the cache is for songs (a 5-minute track is about 5 MB). */
const MAX_BYTES = 60 * 1024 * 1024;
/** Asked in pieces, like a player does: some YouTube clients cut off a single request for a whole file. */
const PIECE = 4 * 1024 * 1024;
/** A held-back URL answers 403 at first (see stream.ts): retried this long. */
const HOLD_MS = 30_000;
/** Downloads at once: a few tracks ahead is all a queue needs, and the playing track's stream comes first. */
const AT_ONCE = 2;

const fileOf = (id: string, ext: string) => path.join(config.cacheDir, `${id}.audio.${ext}`);
const extFor = (mime: string) => (mime.includes("webm") ? "webm" : "m4a");

/** The track's audio in the cache, marked as just used; or null. */
export function cachedAudio(id: string): { file: string; mime: string } | null {
  for (const ext of ["m4a", "webm"]) {
    const file = fileOf(id, ext);
    if (!existsSync(file)) continue;
    const now = new Date();
    utimes(file, now, now).catch(() => {});
    return { file, mime: ext === "webm" ? "audio/webm" : "audio/mp4" };
  }
  return null;
}

const jobs = new Map<string, Promise<void>>();
let running = 0;
const waiting: (() => void)[] = [];

async function turn(): Promise<() => void> {
  if (running < AT_ONCE) running++;
  else await new Promise<void>((go) => waiting.push(go));
  return () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };
}

/** Fetches the track's audio into the cache, once (asked again meanwhile, the same download). */
export function cacheAudio(id: string): Promise<void> {
  if (cachedAudio(id)) return Promise.resolve();
  const inflight = jobs.get(id);
  if (inflight) return inflight;
  const job = (async () => {
    const done = await turn();
    try {
      if (cachedAudio(id)) return;
      await mkdir(config.cacheDir, { recursive: true });
      try {
        await fetchInto(id, await resolveAudio(id));
      } catch (err) {
        if (!(err instanceof Refused)) throw err;
        // The URL stopped working (expired, or refused on this connection): a fresh one, once.
        invalidate(id);
        await fetchInto(id, await resolveAudio(id));
      }
      pruneCache().catch(() => {});
    } finally {
      done();
    }
  })().finally(() => jobs.delete(id));
  jobs.set(id, job);
  return job;
}

class Refused extends Error {}

async function fetchInto(id: string, fmt: StreamFormat): Promise<void> {
  const ext = extFor(fmt.mime);
  const tmp = path.join(config.cacheDir, `${id}.audio.part`);
  const out = await open(tmp, "w");
  try {
    const deadline = Date.now() + HOLD_MS;
    let at = 0;
    let total = Infinity;
    while (at < total) {
      const res = await fetch(fmt.url, {
        headers: { ...fmt.headers, Range: `bytes=${at}-${at + PIECE - 1}` },
        signal: AbortSignal.timeout(60_000),
      });
      if ((res.status === 403 || res.status === 410) && at === 0 && Date.now() < deadline) {
        await res.body?.cancel();
        await sleep(500);
        continue;
      }
      if (res.status === 403 || res.status === 410) {
        await res.body?.cancel();
        throw new Refused(`HTTP ${res.status}`);
      }
      if (res.status !== 200 && res.status !== 206) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const whole = /\/(\d+)\s*$/.exec(res.headers.get("content-range") ?? "")?.[1];
      total = Number(whole ?? res.headers.get("content-length") ?? NaN);
      if (!(total > 0)) total = Infinity;
      if (total > MAX_BYTES) {
        await res.body?.cancel();
        throw new Error("too long to keep");
      }
      const piece = Buffer.from(await res.arrayBuffer());
      if (!piece.length) throw new Error("empty answer");
      await out.write(piece);
      at += piece.length;
      // The whole file in one answer (no ranges), or its length unknown: that's all there is.
      if (res.status === 200 || total === Infinity) break;
    }
    await out.close();
    await rename(tmp, fileOf(id, ext));
  } catch (err) {
    await out.close().catch(() => {});
    await rm(tmp, { force: true });
    throw err;
  }
}

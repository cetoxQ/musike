import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheAudio, cachedAudio } from "./audioCache.js";
import { config } from "./config.js";
import type { Track } from "./types.js";

/**
 * Tracks kept on this computer (the desktop app; MUSIKE_DOWNLOADS=on): fetched like the tracks coming next in a
 * queue (audioCache.ts), then copied out of the cache into <data>/downloads, where nothing prunes them. The stream
 * route serves a kept track from there, so it starts at once and plays without YouTube.
 */

export type DownloadState =
  | { status: "queued" }
  | { status: "downloading"; progress: number }
  | { status: "done"; bytes: number }
  | { status: "failed"; error: string };

interface Kept {
  track: Track;
  file: string;
  bytes: number;
  at: number;
}

const dir = () => path.join(config.dataDir, "downloads");
const indexFile = () => path.join(dir(), "downloads.json");

const kept = new Map<string, Kept>();
const states = new Map<string, DownloadState>();
const waiting: Track[] = [];
const cancelled = new Set<string>();
let running = 0;
let loaded: Promise<void> | null = null;

function load(): Promise<void> {
  loaded ??= (async () => {
    try {
      const list = JSON.parse(await readFile(indexFile(), "utf8")) as Kept[];
      for (const k of list) {
        if (!existsSync(path.join(dir(), k.file))) continue;
        kept.set(k.track.id, k);
        states.set(k.track.id, { status: "done", bytes: k.bytes });
      }
    } catch {
      // nothing kept yet
    }
  })();
  return loaded;
}

async function saveIndex() {
  await mkdir(dir(), { recursive: true });
  const tmp = `${indexFile()}.tmp`;
  await writeFile(tmp, JSON.stringify([...kept.values()]));
  await rename(tmp, indexFile());
}

async function download(track: Track) {
  states.set(track.id, { status: "downloading", progress: 0 });
  await cacheAudio(track.id);
  const cached = cachedAudio(track.id);
  if (!cached) throw new Error("no audio");
  if (cancelled.has(track.id)) throw new Error("cancelled");
  await mkdir(dir(), { recursive: true });
  const file = `${track.id}${path.extname(cached.file)}`;
  await copyFile(cached.file, path.join(dir(), file));
  const { size } = await stat(path.join(dir(), file));
  kept.set(track.id, { track, file, bytes: size, at: Date.now() });
  states.set(track.id, { status: "done", bytes: size });
  await saveIndex();
}

function pump() {
  // One at a time: audioCache runs its own two, and the playing track's prefetches share them.
  while (running < 1 && waiting.length) {
    const track = waiting.shift()!;
    running++;
    download(track)
      .catch((e: Error) => {
        if (cancelled.has(track.id)) states.delete(track.id);
        else states.set(track.id, { status: "failed", error: e.message || "download failed" });
      })
      .finally(() => {
        cancelled.delete(track.id);
        running--;
        pump();
      });
  }
}

/** The file a kept track plays from, or null. */
export function keptAudio(id: string): { file: string; mime: string } | null {
  const k = kept.get(id);
  if (!k) return null;
  const file = path.join(dir(), k.file);
  if (!existsSync(file)) return null;
  return { file, mime: k.file.endsWith(".webm") ? "audio/webm" : "audio/mp4" };
}

/** What's kept and what's on its way, for the app (GET /api/downloads). */
export async function downloadsInfo() {
  await load();
  return {
    tracks: [...kept.values()].sort((a, b) => b.at - a.at).map((k) => ({ track: k.track, bytes: k.bytes })),
    states: Object.fromEntries(states),
    pending: waiting.length + running,
  };
}

export async function addDownloads(tracks: Track[]) {
  await load();
  for (const track of tracks) {
    const s = states.get(track.id)?.status;
    if (s === "done" || s === "downloading" || s === "queued") continue;
    cancelled.delete(track.id);
    waiting.push(track);
    states.set(track.id, { status: "queued" });
  }
  pump();
  return downloadsInfo();
}

/** Deletes the tracks' files (all of them without ids), and stops the ones on their way. */
export async function removeDownloads(ids?: string[]) {
  await load();
  for (const id of ids ?? [...states.keys()]) {
    const i = waiting.findIndex((x) => x.id === id);
    if (i >= 0) waiting.splice(i, 1);
    if (states.get(id)?.status === "downloading") cancelled.add(id);
    else states.delete(id);
    const k = kept.get(id);
    kept.delete(id);
    if (k) await rm(path.join(dir(), k.file), { force: true });
  }
  await saveIndex();
  return downloadsInfo();
}

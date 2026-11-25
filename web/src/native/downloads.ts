import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { getT } from "../i18n";
import type { DownloadState, Downloads } from "../lib/apiTypes";
import type { Track } from "../lib/types";
import { toast } from "../stores/ui";
import { fileStorage } from "./storage";
import { forgetUrl, resolveAudio } from "./streams";

// Tracks kept on the phone: YouTube's own audio (m4a, or webm when that's all there is), saved as it comes, with no
// converting. The player plays the file instead of the network (see streamSource in native/api.ts), so a kept track
// starts at once and plays without a connection, in Android Auto too. The files are in the app's private storage:
// uninstalling the app deletes them.

const DIR = "downloads";
const where = { directory: Directory.Data } as const;
/** The tracks kept: written whenever one is added or removed. */
const index = fileStorage("downloads.json");
/** What's still on its way, so it goes on after the app restarts. */
const QUEUE_KEY = "musike:download-queue";
/** Downloaded in pieces, as the server does (server/src/audioCache.ts): YouTube slows down a stream asked whole. */
const PIECE = 2 * 1024 * 1024;
/** A track YouTube holds back for a few seconds answers 403 until then. */
const HOLD_MS = 30_000;
const MAX_BYTES = 60 * 1024 * 1024;
const AT_ONCE = 2;

interface Kept {
  track: Track;
  file: string;
  bytes: number;
  at: number;
}

const kept = new Map<string, Kept>();
const states = new Map<string, DownloadState>();
const waiting: Track[] = [];
const cancelled = new Set<string>();
/** The file URL a kept track plays from, once asked. */
const sources = new Map<string, string>();
const listeners = new Set<() => void>();
let version = 0;
let running = 0;
/** Tracks done and failed since the queue was last empty, for the message when it is. */
let batch = { done: 0, failed: 0 };

function changed() {
  version++;
  for (const fn of listeners) fn();
}

function saveQueue() {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(waiting));
  } catch {
    /* storage unavailable: the queue lasts this session */
  }
}

async function saveIndex() {
  await index.write(JSON.stringify([...kept.values()])).catch(() => {});
}

class Refused extends Error {}

const header = (headers: Record<string, string> | undefined, name: string) =>
  Object.entries(headers ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];

/** CapacitorHttp hands binary bodies over as base64. */
function base64Of(data: unknown): string {
  if (typeof data === "string") return data.replace(/\s/g, "");
  const bytes = new Uint8Array(data as ArrayBuffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const bytesIn = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One track's audio into its file, piece by piece; the progress shows as it goes. */
async function fetchInto(track: Track, url: string, file: string) {
  const part = `${file}.part`;
  const deadline = Date.now() + HOLD_MS;
  let at = 0;
  let total = Infinity;
  try {
    while (at < total) {
      if (cancelled.has(track.id)) throw new Error("cancelled");
      const res = await CapacitorHttp.request({
        url,
        method: "GET",
        headers: { Range: `bytes=${at}-${at + PIECE - 1}`, "User-Agent": navigator.userAgent },
        responseType: "arraybuffer",
        connectTimeout: 20_000,
        readTimeout: 60_000,
      });
      if ((res.status === 403 || res.status === 410) && at === 0 && Date.now() < deadline) {
        await sleep(500);
        continue;
      }
      if (res.status === 403 || res.status === 410) throw new Refused(`HTTP ${res.status}`);
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const whole = /\/(\d+)\s*$/.exec(header(res.headers, "content-range") ?? "")?.[1];
      total = Number(whole ?? header(res.headers, "content-length") ?? NaN);
      if (!(total > 0)) total = Infinity;
      if (total > MAX_BYTES) throw new Error(getT().downloads.tooLong);
      const data = base64Of(res.data);
      const n = bytesIn(data);
      if (!n) throw new Error("empty answer");
      if (at === 0) await Filesystem.writeFile({ path: part, data, recursive: true, ...where });
      else await Filesystem.appendFile({ path: part, data, ...where });
      at += n;
      if (total !== Infinity) {
        states.set(track.id, { status: "downloading", progress: Math.min(1, at / total) });
        changed();
      }
      // The whole file in one answer (no ranges), or its length unknown: that's all there is.
      if (res.status === 200 || total === Infinity) break;
    }
    await Filesystem.deleteFile({ path: file, ...where }).catch(() => {});
    await Filesystem.rename({ from: part, to: file, directory: Directory.Data, toDirectory: Directory.Data });
    return at;
  } catch (e) {
    await Filesystem.deleteFile({ path: part, ...where }).catch(() => {});
    throw e;
  }
}

async function download(track: Track) {
  states.set(track.id, { status: "downloading", progress: 0 });
  changed();
  let audio = await resolveAudio(track.id);
  const file = `${DIR}/${track.id}.${audio.mime === "audio/webm" ? "webm" : "m4a"}`;
  let bytes: number;
  try {
    bytes = await fetchInto(track, audio.url, file);
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    // The URL stopped working (expired, or refused on this connection): a fresh one, once.
    forgetUrl(audio.url);
    audio = await resolveAudio(track.id);
    bytes = await fetchInto(track, audio.url, file);
  }
  if (cancelled.has(track.id)) {
    await Filesystem.deleteFile({ path: file, ...where }).catch(() => {});
    throw new Error("cancelled");
  }
  kept.set(track.id, { track, file, bytes, at: Date.now() });
  states.set(track.id, { status: "done", bytes });
  await saveIndex();
}

function pump() {
  while (running < AT_ONCE && waiting.length) {
    const track = waiting.shift()!;
    saveQueue();
    running++;
    download(track)
      .then(
        () => batch.done++,
        (e: Error) => {
          if (cancelled.has(track.id)) states.delete(track.id);
          else {
            states.set(track.id, { status: "failed", error: e.message || getT().downloads.failed });
            batch.failed++;
          }
        },
      )
      .finally(() => {
        cancelled.delete(track.id);
        running--;
        changed();
        if (!running && !waiting.length) {
          const { done, failed } = batch;
          batch = { done: 0, failed: 0 };
          if (done || failed) toast(getT().downloads.finished(done, failed), failed ? "error" : undefined);
        }
        pump();
      });
  }
}

/** The kept tracks as last saved, minus any whose file is gone; then what was still on its way. */
async function load() {
  try {
    const list = JSON.parse((await index.read()) ?? "[]") as Kept[];
    const files = new Set(
      (await Filesystem.readdir({ path: DIR, ...where }).catch(() => ({ files: [] }))).files.map((f) => `${DIR}/${f.name}`),
    );
    for (const k of list) {
      if (!files.has(k.file)) continue;
      kept.set(k.track.id, k);
      states.set(k.track.id, { status: "done", bytes: k.bytes });
    }
    if (kept.size !== list.length) await saveIndex();
  } catch {
    /* no index yet */
  }
  try {
    const queued = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Track[];
    downloads.add(queued);
  } catch {
    /* nothing waiting */
  }
  changed();
}

export const downloads: Downloads & {
  /** The file a kept track plays from, or null. */
  source(id: string): Promise<string | null>;
  /** A kept file that wouldn't play: forgotten, so the track streams again. */
  broken(url: string): boolean;
} = {
  state: (id) => states.get(id),
  add(tracks) {
    let added = false;
    for (const track of tracks) {
      const s = states.get(track.id)?.status;
      if (s === "done" || s === "downloading" || s === "queued") continue;
      cancelled.delete(track.id);
      waiting.push(track);
      states.set(track.id, { status: "queued" });
      added = true;
    }
    if (!added) return;
    saveQueue();
    changed();
    pump();
  },
  async remove(ids) {
    // Forgotten at once (a retry right after must not find the file), deleted after.
    const files: string[] = [];
    for (const id of ids) {
      const i = waiting.findIndex((x) => x.id === id);
      if (i >= 0) waiting.splice(i, 1);
      if (states.get(id)?.status === "downloading") cancelled.add(id);
      else states.delete(id);
      const k = kept.get(id);
      if (k) files.push(k.file);
      kept.delete(id);
      sources.delete(id);
    }
    saveQueue();
    changed();
    for (const path of files) await Filesystem.deleteFile({ path, ...where }).catch(() => {});
    await saveIndex();
  },
  async removeAll() {
    await downloads.remove([...states.keys()]);
    await Filesystem.rmdir({ path: DIR, recursive: true, ...where }).catch(() => {});
  },
  tracks: () => [...kept.values()].sort((a, b) => b.at - a.at).map((k) => k.track),
  summary() {
    let bytes = 0;
    for (const k of kept.values()) bytes += k.bytes;
    return { count: kept.size, bytes, pending: waiting.length + running };
  },
  version: () => version,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async source(id) {
    const k = kept.get(id);
    if (!k) return null;
    let src = sources.get(id);
    if (!src) {
      const { uri } = await Filesystem.getUri({ path: k.file, ...where });
      src = Capacitor.convertFileSrc(uri);
      sources.set(id, src);
    }
    return src;
  },
  broken(url) {
    for (const [id, src] of sources) {
      if (src !== url) continue;
      void downloads.remove([id]);
      return true;
    }
    return false;
  },
};

void load();

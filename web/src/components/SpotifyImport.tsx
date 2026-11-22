import { ArrowSquareOutIcon, CaretDownIcon, FileArrowUpIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { restoreBackup } from "../lib/backup";
import { cn } from "../lib/format";
import {
  cachedMatches,
  cacheMatch,
  clearMatches,
  EXPORTIFY_URL,
  libraryMatcher,
  matchSong,
  readSpotifyFiles,
  sameSong,
  SpotifyFileError,
  toBackup,
  type SpotifyExport,
} from "../lib/spotify";
import type { Track } from "../lib/types";
import { getT, useT } from "../i18n";
import { useLibrary } from "../stores/library";
import { toast, useUi } from "../stores/ui";

/**
 * Searches at a time: six, about twice as fast as three without being a flood. A search that fails even after its
 * retry (YouTube pushing back) takes it down by two, to three at the least, for the rest of the run.
 */
const CONCURRENCY = 6;
const MIN_CONCURRENCY = 3;

interface SpotifyState {
  status: "idle" | "reading" | "matching" | "ready" | "importing";
  file: string;
  data: SpotifyExport | null;
  /** Filled in place while searching (a copy per song would get slow with thousands); `found` and the lists below follow it. */
  matches: Map<string, Track | null>;
  found: number;
  /** Songs searched with nothing close enough on YouTube Music. */
  missing: string[];
  /** Songs whose search failed (network, bot check): searched again with "Retry". */
  failed: string[];
  /** Songs left unsearched by "Stop": searched with "Continue". */
  stopped: string[];
  done: number;
  /** How many songs the current run searches (all of them, or only the ones to retry). */
  queued: number;
  pick: (files: File[]) => Promise<void>;
  match: (keys: string[]) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

// Bumped by every new run and by Stop, so answers from an older run never land in the new one.
let runId = 0;
// Settings opened from the "search finished" notice: the section scrolls to its card.
let reveal = false;

const empty = { data: null, matches: new Map<string, Track | null>(), found: 0, missing: [], failed: [], stopped: [], done: 0, queued: 0 };

// Module-level store: matching a big library takes minutes and keeps going if Settings is closed.
const useSpotify = create<SpotifyState>((set, get) => ({
  status: "idle",
  file: "",
  ...empty,

  pick: async (files) => {
    if (!files.length) return;
    const id = ++runId;
    set({ status: "reading", file: files.length === 1 ? files[0].name : getT().spotify.files(files.length) });
    try {
      const data = await readSpotifyFiles(files);
      if (id !== runId) return;
      set({ ...empty, data, matches: new Map() });
      await get().match([...data.songs.keys()]);
    } catch (e) {
      if (id !== runId) return;
      const t = getT().spotify;
      toast(e instanceof SpotifyFileError ? t[e.reason] : (e as Error).message, "error");
      set({ status: "idle", ...empty });
    }
  },

  match: async (keys) => {
    const { data, matches } = get();
    if (!data) return;
    const id = ++runId;
    const retrying = new Set(keys);
    set((s) => ({
      status: "matching",
      done: 0,
      queued: keys.length,
      failed: s.failed.filter((k) => !retrying.has(k)),
      stopped: s.stopped.filter((k) => !retrying.has(k)),
    }));
    // No search for what is known already: songs searched before the app closed (same file picked again), songs
    // already in the library, and the same song under another Spotify id (searched once, for all of them).
    const lib = useLibrary.getState();
    const inLibrary = libraryMatcher([...lib.favorites, ...lib.playlists.flatMap((p) => p.tracks), ...lib.history]);
    const cached = await cachedMatches();
    if (id !== runId) return;
    const searching = new Map<string, Promise<Track | null | undefined>>();
    const find = (key: string): Track | null | undefined | Promise<Track | null | undefined> => {
      if (cached.has(key)) return cached.get(key);
      const song = data.songs.get(key)!;
      const known = inLibrary(song);
      if (known) return known;
      const same = sameSong(song);
      let pending = searching.get(same);
      if (!pending) {
        pending = matchSong(song).then(
          (track) => (cacheMatch(key, track), track),
          () => undefined, // the search failed: "Retry" later
        );
        searching.set(same, pending);
      } else pending = pending.then((track) => (track !== undefined && cacheMatch(key, track), track));
      return pending;
    };
    let next = 0;
    let limit = Math.min(CONCURRENCY, keys.length);
    let running = 0;
    const worker = async () => {
      running++;
      try {
        while (id === runId && next < keys.length && running <= limit) {
          const key = keys[next++];
          const found = await find(key);
          if (id !== runId) return; // Stop already counted this song as unsearched
          if (found !== undefined) matches.set(key, found);
          else limit = Math.max(MIN_CONCURRENCY, limit - 2);
          set((s) => ({
            done: s.done + 1,
            found: s.found + (found ? 1 : 0),
            missing: found === null ? [...s.missing, key] : s.missing,
            failed: found === undefined ? [...s.failed, key] : s.failed,
          }));
        }
      } finally {
        running--;
      }
    };
    await Promise.all(Array.from({ length: limit }, worker));
    if (id !== runId) return;
    set({ status: "ready" });
    // Settings closed meanwhile: say it's done, and open it on the card to import.
    if (!useUi.getState().settingsOpen) {
      const t = getT().spotify;
      toast(t.done(get().found), "info", {
        label: t.review,
        run: () => {
          reveal = true;
          useUi.getState().setSettingsOpen(true);
        },
      });
    }
  },

  cancel: () => {
    runId++;
    // Keep what was found so far: it can still be imported, and "Continue" searches the rest.
    const { data, matches, failed, stopped } = get();
    const searched = new Set([...failed, ...stopped]);
    const rest = data ? [...data.songs.keys()].filter((k) => !matches.has(k) && !searched.has(k)) : [];
    set({ status: data ? "ready" : "idle", stopped: [...stopped, ...rest] });
  },

  reset: () => {
    runId++;
    set({ status: "idle", file: "", ...empty, matches: new Map() });
  },
}));

/** Settings section: open Exportify, pick what it saved, and every playlist lands in the library. */
export function SpotifyImport() {
  const input = useRef<HTMLInputElement>(null);
  const { status, file, data, matches, found, missing, failed, stopped, done, queued, pick, match, cancel, reset } = useSpotify();
  const [showMissing, setShowMissing] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const t = useT();

  // Settings scrolls: a file picked near the bottom of it would get its card out of sight. Brought into view as soon as
  // the file is being read, and when Settings opens from the "search finished" notice.
  useEffect(() => {
    if (status === "reading" || status === "matching" || reveal) card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    reveal = false;
  }, [status]);

  const total = data?.songs.size ?? 0;
  const busy = status === "reading" || status === "matching" || status === "importing";

  const onImport = async () => {
    if (!data) return;
    useSpotify.setState({ status: "importing" });
    try {
      const r = await restoreBackup(toBackup(data, matches, t.spotify.untitled), "merge", false);
      const parts = [
        r.playlistsAdded && t.backup.newPlaylists(r.playlistsAdded),
        r.playlistsMerged && t.backup.updatedPlaylists(r.playlistsMerged),
        r.tracksAdded && t.backup.addedTracks(r.tracksAdded),
        r.favoritesAdded && t.backup.addedFavorites(r.favoritesAdded),
      ].filter((p): p is string => !!p);
      toast(parts.length ? t.backup.imported(parts) : t.backup.nothingNew);
      clearMatches();
      reset();
    } catch (e) {
      toast((e as Error).message, "error");
      useSpotify.setState({ status: "ready" });
    }
  };

  const action = "flex h-11 items-center justify-center gap-2 rounded-full text-sm font-medium transition-[transform,background-color] active:scale-[0.98] disabled:opacity-50";

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-fg-3">{t.spotify.title}</h3>
      <p className="text-sm text-fg-2">{t.spotify.body}</p>

      <div className="grid grid-cols-2 gap-2">
        <a href={EXPORTIFY_URL} target="_blank" rel="noopener noreferrer" className={cn(action, "bg-surface-1 ring-1 ring-line hover:bg-surface-3")}>
          <ArrowSquareOutIcon size={18} /> {t.spotify.open}
        </a>
        <button type="button" onClick={() => input.current?.click()} disabled={busy} className={cn(action, "bg-surface-1 ring-1 ring-line hover:bg-surface-3")}>
          <FileArrowUpIcon size={18} /> {status === "reading" ? t.spotify.reading : t.spotify.pick}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".zip,.csv,application/zip,text/csv"
          className="hidden"
          aria-label={t.spotify.pickLabel}
          onChange={(e) => {
            void pick([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {status === "reading" && (
        <div ref={card} className="flex flex-col gap-1 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line" role="status" aria-live="polite">
          <p className="truncate text-sm font-medium" title={file}>
            {file}
          </p>
          <p className="text-xs text-fg-2">{t.spotify.readingFile}</p>
        </div>
      )}

      {data && status !== "reading" && (
        <div ref={card} className="flex flex-col gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
          <div>
            <p className="truncate text-sm font-medium" title={file}>
              {file}
            </p>
            <p className="text-xs text-fg-2">{t.spotify.summary(data.playlists.length, total)}</p>
          </div>

          {status === "matching" ? (
            <div className="flex flex-col gap-2" role="status" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${queued ? (done / queued) * 100 : 0}%` }} />
              </div>
              <p className="font-mono text-xs text-fg-2 tabular-nums">{t.spotify.matching(done, queued, found)}</p>
              <p className="text-xs text-fg-3">{t.spotify.keepOpen}</p>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ["found", found, t.spotify.found],
                  ["missing", missing.length, t.spotify.notFound],
                  ["failed", failed.length, t.spotify.failed],
                ] as const
              ).map(([key, n, label]) => (
                <li key={key} className="rounded-[12px] bg-surface-2 px-2 py-2.5">
                  <span className="block font-mono text-lg font-semibold tabular-nums">{n}</span>
                  <span className="block text-xs text-fg-2">{label}</span>
                </li>
              ))}
            </ul>
          )}

          {status !== "matching" && missing.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowMissing((o) => !o)}
                aria-expanded={showMissing}
                className="flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg"
              >
                <WarningCircleIcon size={16} /> {t.spotify.showMissing}
                <CaretDownIcon size={12} className={cn("transition-transform", showMissing && "rotate-180")} />
              </button>
              {showMissing && (
                <ul className="scroll-area mt-2 max-h-48 overflow-y-auto rounded-[12px] bg-surface-2 p-2 text-[13px] text-fg-2">
                  {missing.map((key) => {
                    const song = data.songs.get(key)!;
                    return (
                      <li key={key} className="truncate px-1 py-0.5">
                        {song.title} <span className="text-fg-3">· {song.artist}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          <p className="text-xs text-fg-3">{t.spotify.mergeNote}</p>

          <div className="flex flex-wrap justify-end gap-2">
            {status === "matching" ? (
              <button type="button" onClick={cancel} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
                {t.spotify.stop}
              </button>
            ) : (
              <>
                <button type="button" onClick={reset} disabled={status === "importing"} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
                  {t.common.cancel}
                </button>
                {failed.length + stopped.length > 0 && (
                  <button
                    type="button"
                    onClick={() => void match([...stopped, ...failed])}
                    disabled={status === "importing"}
                    className="h-11 rounded-full bg-surface-3 px-5 text-sm font-medium hover:bg-surface-4"
                  >
                    {stopped.length ? t.spotify.continueN(stopped.length + failed.length) : t.common.retry}
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              disabled={!found || busy}
              onClick={() => void onImport()}
              className="h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
            >
              {status === "importing" ? t.backup.importing : t.spotify.importN(found)}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

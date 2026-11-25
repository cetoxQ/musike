import type { DownloadState, Downloads } from "./apiTypes";
import type { Track } from "./types";

/**
 * The desktop app's downloads: kept by its own server, on this computer (server/src/downloads.ts), and played from
 * there by the stream route. This side mirrors what the server says, asking again while something is on its way.
 */
export function desktopDownloads(): Downloads {
  let kept: { track: Track; bytes: number }[] = [];
  let states: Record<string, DownloadState> = {};
  let pending = 0;
  let version = 0;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  type Info = { tracks: typeof kept; states: typeof states; pending: number };

  const apply = (info: Info) => {
    kept = info.tracks;
    states = info.states;
    pending = info.pending;
    version++;
    for (const fn of listeners) fn();
    if (timer) clearTimeout(timer);
    timer = pending ? setTimeout(() => void refresh(), 1500) : null;
  };

  const call = async (path: string, body?: unknown) => {
    const res = await fetch(`/api/downloads${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) apply((await res.json()) as Info);
  };

  let asked = 0;
  const refresh = () => {
    asked = Date.now();
    return call("").catch(() => {});
  };
  void refresh();

  return {
    state: (id) => states[id],
    add(tracks) {
      void call("", { tracks }).catch(() => {});
    },
    remove: (ids) => call("/remove", { ids }).catch(() => {}),
    removeAll: () => call("/remove", {}).catch(() => {}),
    tracks: () => kept.map((k) => k.track),
    summary: () => ({ count: kept.length, bytes: kept.reduce((sum, k) => sum + k.bytes, 0), pending }),
    version: () => version,
    subscribe(fn) {
      // A page or Settings showing downloads: what the server has now (at most every few seconds).
      if (Date.now() - asked > 3000) void refresh();
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

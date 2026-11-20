import { create } from "zustand";
import { api } from "./api";
import type { AlbumPage } from "./types";

// Albums, singles and EPs: what YouTube Music calls each saved album. A saved album doesn't say, so it's learnt from
// the album's page (when it's opened, or in the background for the profile) and kept on this device.

export type AlbumType = "album" | "single" | "ep";

/** YouTube Music's own word first ("EP • 2019"), otherwise its rule: up to 3 tracks a single, up to 6 an EP, under 30 min. */
export function albumTypeOf(page: Pick<AlbumPage, "kind" | "tracks">): AlbumType {
  const word = page.kind.trim().toLowerCase();
  if (/^ep\b/.test(word)) return "ep";
  if (/^(single|singolo)\b/.test(word)) return "single";
  if (/^(album|álbum)\b/.test(word)) return "album";
  const minutes = page.tracks.reduce((s, t) => s + (t.duration || 0), 0) / 60;
  if (minutes >= 30) return "album";
  if (page.tracks.length <= 3) return "single";
  if (page.tracks.length <= 6) return "ep";
  return "album";
}

const KEY = "musike:album-types";

function stored(): Record<string, AlbumType> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, AlbumType>) : {};
  } catch {
    return {};
  }
}

export const useAlbumTypes = create<{ types: Record<string, AlbumType>; learn: (id: string, type: AlbumType) => void }>((set, get) => ({
  types: stored(),
  learn: (id, type) => {
    if (get().types[id] === type) return;
    const types = { ...get().types, [id]: type };
    set({ types });
    try {
      localStorage.setItem(KEY, JSON.stringify(types));
    } catch {
      /* this session only */
    }
  },
}));

/** Saved albums not told apart yet: their pages, one every couple of seconds, while the profile is open. */
export async function learnTypes(ids: string[], signal: AbortSignal) {
  for (const id of ids) {
    if (signal.aborted) return;
    if (useAlbumTypes.getState().types[id]) continue;
    try {
      useAlbumTypes.getState().learn(id, albumTypeOf(await api.album(id, signal)));
    } catch {
      /* next time */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

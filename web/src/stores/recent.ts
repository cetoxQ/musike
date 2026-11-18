import { create } from "zustand";
import { api } from "../lib/api";
import type { RecentInput, RecentItem, RecentKind } from "../lib/types";

/** Searches kept by older versions in this browser only; moved into the list once. */
const OLD_KEY = "musike:recent-searches";

/** The id the server gives an entry (a search's is its lowercase text). */
function idOf(item: RecentInput): string {
  switch (item.kind) {
    case "query":
      return item.q.trim().toLocaleLowerCase();
    case "track":
      return item.track.id;
    default:
      return item.id;
  }
}

interface RecentState {
  items: RecentItem[];
  loaded: boolean;
  load: () => Promise<void>;
  /** On top of the list right away; the server's answer then replaces the list. Failures are ignored. */
  push: (item: RecentInput) => void;
  remove: (kind: RecentKind, id: string) => void;
  clear: () => void;
}

/**
 * The Search page's "Recent" list: searches, and the tracks, artists, albums and playlists you opened or played.
 * Kept with the library (on the server, per account; in the app's storage on Android), so every device sees it.
 */
export const useRecent = create<RecentState>((set, get) => {
  const settle = (p: Promise<RecentItem[]>) =>
    p.then((items) => set({ items })).catch(() => {
      /* the list is a convenience: a failed update just isn't saved */
    });

  return {
    items: [],
    loaded: false,

    load: async () => {
      try {
        let items = await api.recent();
        // Searches from before this list existed (text only, in this browser): oldest first, so the order stays.
        let old: string[] = [];
        try {
          old = JSON.parse(localStorage.getItem(OLD_KEY) ?? "[]") as string[];
        } catch {
          /* unreadable: dropped */
        }
        if (Array.isArray(old) && old.length) {
          for (const q of old.slice(0, 20).reverse()) {
            if (typeof q === "string" && q.trim()) items = await api.pushRecent({ kind: "query", q });
          }
        }
        try {
          localStorage.removeItem(OLD_KEY);
        } catch {
          /* private mode */
        }
        set({ items, loaded: true });
      } catch {
        set({ loaded: true });
      }
    },

    push: (item) => {
      const id = idOf(item);
      if (!id) return;
      const entry = { ...item, id, at: Date.now() } as RecentItem;
      set({ items: [entry, ...get().items.filter((x) => x.kind !== item.kind || x.id !== id)].slice(0, 50) });
      void settle(api.pushRecent(item));
    },

    remove: (kind, id) => {
      set({ items: get().items.filter((x) => x.kind !== kind || x.id !== id) });
      void settle(api.removeRecent(kind, id));
    },

    clear: () => {
      set({ items: [] });
      void settle(api.clearRecent());
    },
  };
});

import type { ArtistCard, ArtistPage } from "./browse.js";
import type { PlayEntry, SavedArtist, Track } from "./types.js";

// The profile's "You might also like" and its Live shelf: worked out from the artist pages of the artists you
// play most and follow. Shared by the server and the Android app on its own.

/** A title or album that says it's live: "(Live)", "[Live at ...]", "- Live", "Live at/in/from/on", "ao vivo"... */
const LIVE = /\((?:live|ao vivo|en vivo|dal vivo)\b[^)]*\)|\[(?:live|ao vivo|en vivo|dal vivo)\b[^\]]*\]|\s[-\u2013]\s*live\b|\blive\s+(?:at|in|from|on)\b|\b(?:ao|en|dal)\s+vivo\b/i;

export const saysLive = (t: Pick<Track, "title" | "album">) => LIVE.test(t.title) || LIVE.test(t.album ?? "");

/** An artist page's shelf of live performances (titles are translated: "Live performances", "Ao vivo"...). */
const LIVE_SHELF = /\blive\b|\bvivo\b/i;

export interface Discover {
  /** Artists to try, best first: named by more of yours, and by the ones you play most. */
  artists: ArtistCard[];
  /** Tracks the artists' pages list as live performances. */
  live: string[];
}

/** Artists to start from: the most played, then the followed ones, at most this many pages fetched. */
const SOURCES = 12;
/** Played at least this many times: you know them already, not a suggestion. */
const KNOWN_PLAYS = 3;
const SUGGESTIONS = 20;

export async function discover(
  plays: PlayEntry[],
  followed: SavedArtist[],
  artistPage: (id: string) => Promise<ArtistPage>,
): Promise<Discover> {
  const played = new Map<string, number>();
  for (const p of plays) {
    const id = p.track.artistId;
    if (id) played.set(id, (played.get(id) ?? 0) + p.count);
  }
  const top = [...played].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => id);
  const follows = followed.map((a) => a.id);
  const sources = [...new Set([...top, ...follows.slice(0, 8)])].slice(0, SOURCES);
  const known = new Set([...sources, ...follows, ...[...played].filter(([, n]) => n >= KNOWN_PLAYS).map(([id]) => id)]);

  // A few pages at a time: YouTube doesn't like a burst.
  const pages: (ArtistPage | null)[] = [];
  for (let i = 0; i < sources.length; i += 3) {
    const batch = await Promise.allSettled(sources.slice(i, i + 3).map((id) => artistPage(id)));
    pages.push(...batch.map((r) => (r.status === "fulfilled" ? r.value : null)));
  }

  const scores = new Map<string, { card: ArtistCard; score: number; by: number }>();
  const live = new Set<string>();
  pages.forEach((page, i) => {
    if (!page) return;
    const from = sources[i];
    const weight = 1 + Math.log1p(played.get(from) ?? 0) + (follows.includes(from) ? 1 : 0);
    for (const shelf of page.shelves ?? []) {
      if (shelf.kind === "videos" && LIVE_SHELF.test(shelf.title)) shelf.tracks.forEach((t) => live.add(t.id));
    }
    // The first shelf of artists is "Fans might also like"; the higher on it, the more it counts.
    const similar = page.shelves?.find((s) => s.kind === "artists");
    if (similar?.kind !== "artists") return;
    similar.artists.forEach((card, k) => {
      if (known.has(card.id)) return;
      const s = scores.get(card.id) ?? { card, score: 0, by: 0 };
      s.score += weight * (1 - k / (similar.artists.length + 1));
      s.by++;
      scores.set(card.id, s);
    });
  });

  const artists = [...scores.values()]
    .sort((a, b) => b.by - a.by || b.score - a.score)
    .slice(0, SUGGESTIONS)
    .map((s) => s.card);
  return { artists, live: [...live] };
}

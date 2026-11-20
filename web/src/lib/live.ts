import type { Track } from "./types";

/** A title or album that says it's live (the same test as the server's, server/src/profile.ts). */
const LIVE = /\((?:live|ao vivo|en vivo|dal vivo)\b[^)]*\)|\[(?:live|ao vivo|en vivo|dal vivo)\b[^\]]*\]|\s[-–]\s*live\b|\blive\s+(?:at|in|from|on)\b|\b(?:ao|en|dal)\s+vivo\b/i;

export const saysLive = (t: Pick<Track, "title" | "album">) => LIVE.test(t.title) || LIVE.test(t.album ?? "");

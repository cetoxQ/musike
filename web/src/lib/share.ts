import { create } from "zustand";
import { getT } from "../i18n";
import { toast } from "../stores/ui";
import { shareLink } from "./api";

// Sharing: a link to the track, album, artist or playlist on YouTube or YouTube Music (not Musike: whoever gets it
// may not have it). Which of the two is asked the first time, and kept; Settings changes it.

export type ShareSite = "youtube" | "ytmusic";

export type Shareable =
  | { kind: "track"; id: string; title: string; artist?: string }
  | { kind: "album"; id: string; title: string; artist?: string; playlistId?: string }
  | { kind: "artist"; id: string; name: string }
  | { kind: "playlist"; id: string; title: string };

const KEY = "musike:share";

function stored(): ShareSite | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "youtube" || v === "ytmusic" ? v : null;
  } catch {
    return null;
  }
}

interface ShareState {
  /** Where links point; null until chosen (the first share asks). */
  site: ShareSite | null;
  /** What waits for that choice. */
  asking: Shareable | null;
  setSite: (site: ShareSite) => void;
}

export const useShare = create<ShareState>((set) => ({
  site: stored(),
  asking: null,
  setSite: (site) => {
    try {
      localStorage.setItem(KEY, site);
    } catch {
      /* this session only */
    }
    set({ site });
  },
}));

const YT = "https://www.youtube.com";
const YTM = "https://music.youtube.com";

export function linkFor(item: Shareable, site: ShareSite): string {
  const base = site === "ytmusic" ? YTM : YT;
  switch (item.kind) {
    case "track":
      return `${base}/watch?v=${item.id}`;
    case "artist":
      return `${base}/channel/${item.id}`;
    case "playlist":
      return `${base}/playlist?list=${item.id.replace(/^VL/, "")}`;
    case "album":
      // On YouTube an album is a playlist; without its id (an older server), YouTube Music's page.
      return site === "youtube" && item.playlistId ? `${YT}/playlist?list=${item.playlistId}` : `${YTM}/browse/${item.id}`;
  }
}

const titleOf = (item: Shareable) =>
  item.kind === "artist" ? item.name : item.kind !== "playlist" && item.artist ? `${item.title} - ${item.artist}` : item.title;

/** Shares it where links point; the first time, asks where first. */
export function share(item: Shareable) {
  const { site } = useShare.getState();
  if (site) void send(item, site);
  else useShare.setState({ asking: item });
}

export async function send(item: Shareable, site: ShareSite) {
  try {
    if ((await shareLink(titleOf(item), linkFor(item, site))) === "copied") toast(getT().share.copied);
  } catch {
    toast(getT().share.failed, "error");
  }
}

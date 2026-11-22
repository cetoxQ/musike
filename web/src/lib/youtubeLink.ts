import { getT } from "../i18n";
import { usePlayer } from "../player/player";
import { toast } from "../stores/ui";
import { api } from "./api";
import { paths } from "./routes";
import type { Track } from "./types";

/** The video in a YouTube link (youtube.com, music.youtube.com, youtu.be, Shorts), or null. */
export function videoIdFromUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (!/(^|\.)youtube\.com$|^youtu\.be$/.test(url.hostname)) return null;
    const id = url.hostname === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") ?? url.pathname.split("/shorts/")[1];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id.slice(0, 11)) ? id.slice(0, 11) : null;
  } catch {
    return null;
  }
}

/**
 * The YouTube playlist in a link (youtube.com or music.youtube.com, ?list=), as Musike names it ("VL" + its id), or
 * null. Mixes (RD...) are made on the fly for whoever opens them, and Liked/Watch later (LL, WL) are private: neither
 * can be opened from here.
 */
export function playlistIdFromUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
    const list = url.searchParams.get("list") ?? "";
    if (!/^[\w-]{10,80}$/.test(list) || /^(RD|LL$|WL$)/.test(list)) return null;
    return `VL${list}`;
  } catch {
    return null;
  }
}

/** The track a YouTube link points to, as search shows it. */
export async function trackFromLink(id: string, signal?: AbortSignal): Promise<Track> {
  const r = await api.prepare(id, signal);
  return {
    id: r.id,
    title: r.title,
    artist: getT().search.youtubeLink,
    duration: r.duration,
    thumb: `https://i.ytimg.com/vi/${r.id}/mqdefault.jpg`,
    art: `https://i.ytimg.com/vi/${r.id}/hq720.jpg`,
    kind: "video",
  };
}

/** A YouTube link opened with the app or shared to it: a video or song plays now, a playlist opens. */
export async function playLink(url: string, go: (path: string) => void): Promise<void> {
  const id = videoIdFromUrl(url);
  const list = playlistIdFromUrl(url);
  if (!id && list) return go(paths.ytPlaylist(list));
  if (!id) return toast(getT().search.notVideoLink, "error");
  try {
    usePlayer.getState().playTrack(await trackFromLink(id));
  } catch {
    toast(getT().search.linkError, "error");
  }
}

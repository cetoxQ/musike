import { getT } from "../i18n";
import { usePlayer } from "../player/player";
import { toast } from "../stores/ui";
import { api } from "./api";
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

/** A YouTube link opened with the app or shared to it: plays it now. */
export async function playLink(url: string): Promise<void> {
  const id = videoIdFromUrl(url);
  if (!id) return toast(getT().search.notVideoLink, "error");
  try {
    usePlayer.getState().playTrack(await trackFromLink(id));
  } catch {
    toast(getT().search.linkError, "error");
  }
}

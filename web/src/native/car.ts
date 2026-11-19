import { getT } from "../i18n";
import { api } from "../lib/api";
import type { Track } from "../lib/types";
import { locally, usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { useRecent } from "../stores/recent";
import { Playback } from "./media";

// Android Auto (PlaybackService.java browses through here): the car's screen lists the queue, favorites,
// playlists and recent items, and plays what is picked; voice and keyboard searches play the first results.
// The car is this phone: what it starts plays here, even while the phone controls another device.

/** What the car lists: a folder (browsable) or a track (playable). */
interface CarItem {
  id: string;
  title: string;
  subtitle?: string;
  browsable?: boolean;
}

/** Tracks shown in the car, by list, to play the one picked (and the rest after it). */
const lists = new Map<string, Track[]>();
/** At most this many tracks per list in the car (Android Auto shows only so many anyway). */
const MAX = 200;

const tracksOf = (prefix: string, tracks: Track[]): CarItem[] => {
  lists.set(prefix, tracks.slice(0, MAX));
  return tracks.slice(0, MAX).map((t, i) => ({ id: `${prefix}:${i}`, title: t.title, subtitle: t.artist }));
};

/** The list behind a folder id (fetched for albums, playlists from YouTube and artists). */
async function tracksFor(folder: string): Promise<Track[] | null> {
  const [kind, id] = [folder.slice(0, folder.indexOf(":")), folder.slice(folder.indexOf(":") + 1)];
  switch (kind) {
    case "p":
      return useLibrary.getState().playlists.find((p) => p.id === id)?.tracks ?? [];
    case "a":
      return (await api.album(id)).tracks;
    case "y":
      return (await api.ytPlaylist(id)).tracks;
    case "ar":
      return (await api.artist(id)).tracks;
    default:
      return null;
  }
}

async function browse(parent: string): Promise<CarItem[]> {
  const t = getT().car;
  const lib = useLibrary.getState();
  if (parent === "root") {
    return [
      { id: "queue", title: t.queue, browsable: true },
      { id: "favorites", title: t.favorites, browsable: true },
      { id: "playlists", title: t.playlists, browsable: true },
      { id: "recent", title: t.recent, browsable: true },
    ];
  }
  if (parent === "queue") {
    const { queue, index } = usePlayer.getState();
    // From the current track on (the queue's start is history).
    const from = Math.max(0, index);
    lists.set("q", queue);
    return queue.slice(from, from + MAX).map((tr, i) => ({ id: `q:${from + i}`, title: tr.title, subtitle: tr.artist }));
  }
  if (parent === "favorites") return tracksOf("f", lib.favorites);
  if (parent === "playlists") {
    return [
      ...lib.playlists.map((p) => ({ id: `p:${p.id}`, title: p.name, subtitle: t.songs(p.tracks.length), browsable: true })),
      ...lib.albums.map((a) => ({ id: `a:${a.id}`, title: a.title, subtitle: a.artist, browsable: true })),
      ...lib.ytPlaylists.map((p) => ({ id: `y:${p.id}`, title: p.title, subtitle: p.author, browsable: true })),
    ];
  }
  if (parent === "recent") {
    const items = useRecent.getState().items;
    const tracks = items.flatMap((r) => (r.kind === "track" ? [r.track] : []));
    lists.set("rt", tracks);
    let n = 0;
    return items.flatMap((r): CarItem[] => {
      switch (r.kind) {
        case "track":
          return [{ id: `rt:${n++}`, title: r.track.title, subtitle: r.track.artist }];
        case "album":
          return [{ id: `a:${r.id}`, title: r.title, subtitle: r.artist, browsable: true }];
        case "playlist":
          return [{ id: `y:${r.id}`, title: r.title, subtitle: r.author, browsable: true }];
        case "artist":
          return [{ id: `ar:${r.id}`, title: r.name, browsable: true }];
        default:
          return [];
      }
    });
  }
  if (parent.startsWith("search:")) {
    const results = await api.search(parent.slice("search:".length), "song");
    return tracksOf("s", results);
  }
  const tracks = await tracksFor(parent);
  return tracks ? tracksOf(parent, tracks) : [];
}

/** A track picked in the car: "<list>:<position>". */
async function play(id: string) {
  const at = id.lastIndexOf(":");
  const list = id.slice(0, at);
  const index = Number(id.slice(at + 1));
  if (!Number.isInteger(index)) return;
  if (list === "q") return locally(() => usePlayer.getState().jumpTo(index));
  const tracks = lists.get(list) ?? (await tracksFor(list));
  if (tracks?.length) locally(() => usePlayer.getState().playList(tracks, Math.min(index, tracks.length - 1)));
}

/** "Hey Google, play ... on Musike": the first results; nothing said, the music goes on. */
async function search(query: string) {
  const q = query.trim();
  if (!q) {
    return locally(() => usePlayer.getState().status !== "playing" && usePlayer.getState().toggle());
  }
  const results = await api.search(q, "song");
  if (results.length) locally(() => usePlayer.getState().playList(results.slice(0, MAX), 0));
}

let started = false;

/** Answers the car (Android only; the service asks only while Android Auto is connected). */
export function startCar() {
  if (started) return;
  started = true;
  void Playback.addListener("browse", (e) => {
    browse(e.parent)
      .catch(() => [] as CarItem[])
      .then((items) => Playback.browseResult({ request: e.request, items }))
      .catch(() => {});
  });
  void Playback.addListener("action", (e) => {
    if (e.action === "playItem" && e.value) void play(e.value).catch(() => {});
    else if (e.action === "search") void search(e.value ?? "").catch(() => {});
  });
}

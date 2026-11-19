import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  album as albumPage,
  ALBUM_ID,
  artist as artistPage,
  ARTIST_ID,
  GENRE_ID,
  genre as genrePage,
  genreArtists,
  genres,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  ytPlaylist as ytPlaylistPage,
  YT_PLAYLIST_ID,
} from "../../../server/src/browse";
import { msg, tr, type MsgKey } from "../../../server/src/i18n";
import * as library from "../../../server/src/library";
import { findVideoFor, radio, search, suggestions } from "../../../server/src/search";
import { HttpError, VIDEO_ID } from "../../../server/src/types";
import { getLang, getT } from "../i18n";
import { ApiError, type Connection, type MusikeApi, type SystemInfo } from "../lib/apiTypes";
import "./android";
import { makeConnection, savedConnection, serverBackend } from "./connection";
import { media } from "./media";
import { nativeStorage } from "./storage";
import { forgetUrl, resolveAudio } from "./streams";

// The Android backend: the Musike server's own code (search, genres, artists, albums, library), running on the
// phone instead of behind HTTP. The build swaps lib/api.ts for this module (see vite.config.ts).
// Connected to a Musike server instead (Settings > Server), every request goes to that server (connection.ts).
export * from "../lib/apiTypes";

const saved = savedConnection();
const server = saved.mode === "server" ? serverBackend(saved.url) : null;

// On the phone the library is one JSON document in the app's storage.
const lib = library.jsonLibrary(nativeStorage);

const fail = (status: number, key: MsgKey) => new ApiError(status, tr(getLang(), msg(key)));

/** Runs a server function and turns its errors into what the app expects, in the app's language. */
async function call<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  try {
    const result = await fn();
    // The work can't be cancelled midway, but a caller that gave up must not get the result.
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  } catch (e) {
    if (e instanceof HttpError) throw new ApiError(e.status, tr(getLang(), e.text), e.code);
    if (e instanceof ApiError || (e as Error).name === "AbortError") throw e;
    throw new ApiError(500, (e as Error).message || getT().player.serverDown);
  }
}

const tracks = (list: unknown[]) => list.slice(0, 500).map(library.sanitizeTrack);

async function noAccounts(): Promise<never> {
  throw new ApiError(400, tr(getLang(), msg("accountsOff")));
}

const SYSTEM: SystemInfo = {
  ytdlp: { path: "built-in", version: null, channel: "stable", latest: { stable: null, nightly: null }, updateAvailable: false },
  deno: "built-in",
  ffmpeg: null,
  canInstall: false,
  job: null,
};

const onThePhone: MusikeApi = {
  search: (q, type, signal) =>
    call(async () => {
      if (!q.trim()) throw fail(400, "emptyQuery");
      return search(q.trim().slice(0, 200), type, getLang());
    }, signal),
  suggest: (q, signal) => call(() => suggestions(q.trim().slice(0, 100), getLang()).catch(() => []), signal),
  radio: (id) => call(() => radio(id)),
  genres: () => call(() => genres(getLang())),
  genre: (id, signal) =>
    call(async () => {
      if (!GENRE_ID.test(id)) throw fail(400, "invalidGenre");
      return genrePage(id, getLang());
    }, signal),
  genreArtists: (id, offset) => call(() => genreArtists(id, offset, getLang())),
  artist: (id, signal) =>
    call(async () => {
      if (!ARTIST_ID.test(id)) throw fail(400, "invalidArtist");
      return artistPage(id, getLang());
    }, signal),
  album: (id, signal) =>
    call(async () => {
      if (!ALBUM_ID.test(id)) throw fail(400, "invalidAlbum");
      return albumPage(id, getLang());
    }, signal),
  searchAlbums: (q, signal) => call(() => searchAlbums(q.trim().slice(0, 200), getLang()), signal),
  searchArtists: (q, signal) => call(() => searchArtists(q.trim().slice(0, 200), getLang()), signal),
  searchPlaylists: (q, signal) => call(() => searchPlaylists(q.trim().slice(0, 200), getLang()), signal),
  ytPlaylist: (id, signal) =>
    call(async () => {
      if (!YT_PLAYLIST_ID.test(id)) throw fail(400, "invalidYtPlaylist");
      return ytPlaylistPage(id, getLang());
    }, signal),
  videoFor: (t) => call(() => findVideoFor(t.id, t.title, t.artist, t.duration)),
  prepare: (id, signal) =>
    call(async () => {
      if (!VIDEO_ID.test(id)) throw fail(400, "invalidVideoId");
      const r = await resolveAudio(id);
      return { id, title: r.title, duration: r.duration, hasSdVideo: false };
    }, signal),

  library: () => call(() => lib.getLibraryLite()),
  addFavorite: (t) => call(async () => ({ favorites: await lib.addFavorite(library.sanitizeTrack(t)) })),
  addFavorites: (list) => call(async () => ({ favorites: await lib.addFavorites(tracks(list)) })),
  removeFavorite: (id) => call(async () => ({ favorites: await lib.removeFavorite(id) })),
  pushHistory: (t) => call(async () => ({ history: await lib.pushHistory(library.sanitizeTrack(t)) })),
  plays: (artistId, name, signal) =>
    call(async () => {
      if (artistId === undefined) return lib.allPlays();
      if (!ARTIST_ID.test(artistId)) throw fail(400, "invalidArtist");
      return lib.playsFor(artistId, (name ?? "").slice(0, 300));
    }, signal),
  saveArtist: (a) => call(async () => ({ artists: await lib.saveArtist(library.sanitizeArtist(a)) })),
  removeArtist: (id) => call(async () => ({ artists: await lib.removeArtist(id) })),
  saveAlbum: (a) => call(async () => ({ albums: await lib.saveAlbum(library.sanitizeAlbum(a)) })),
  removeAlbum: (id) => call(async () => ({ albums: await lib.removeAlbum(id) })),
  saveYtPlaylist: (p) => call(async () => ({ ytPlaylists: await lib.saveYtPlaylist(library.sanitizeYtPlaylist(p)) })),
  removeYtPlaylist: (id) => call(async () => ({ ytPlaylists: await lib.removeYtPlaylist(id) })),
  createPlaylist: (name, list = []) => call(() => lib.createPlaylist(name, tracks(list))),
  renamePlaylist: (id, name) => call(() => lib.renamePlaylist(id, name)),
  deletePlaylist: (id) => call(() => lib.deletePlaylist(id)),
  addToPlaylist: (id, t) => call(() => lib.addToPlaylist(id, Array.isArray(t) ? tracks(t) : library.sanitizeTrack(t))),
  removeFromPlaylist: (id, trackId) => call(() => lib.removeFromPlaylist(id, trackId)),
  recent: (signal) => call(() => lib.recent(), signal),
  pushRecent: (item) => call(async () => lib.pushRecent(library.sanitizeRecent(item))),
  removeRecent: (kind, id) => call(() => lib.removeRecent(kind, id)),
  clearRecent: () => call(() => lib.clearRecent()),
  importLibrary: (backup, mode) =>
    call(async () => {
      const b = (backup ?? {}) as { format?: unknown; version?: unknown; library?: unknown };
      if (b.format !== "musike-backup") throw fail(400, "notBackup");
      if (typeof b.version !== "number" || b.version > 1) throw fail(400, "newerBackup");
      return lib.importLibrary(b.library, mode);
    }),

  system: async () => SYSTEM,
  updateYtdlp: async () => {
    throw new ApiError(400, "yt-dlp isn't used on this device.");
  },

  // Accounts are a server thing: the phone's own library has none.
  authStatus: async () => ({ enabled: false, setup: false, user: null }),
  setup: noAccounts,
  login: noAccounts,
  logout: noAccounts,
  changePassword: noAccounts,
  users: noAccounts,
  createUser: noAccounts,
  setUserRole: noAccounts,
  resetUserPassword: noAccounts,
  deleteUser: noAccounts,
};

export const api: MusikeApi = server ? server.api : onThePhone;

/**
 * On the phone, the media element plays YouTube's stream directly: resolved here, no proxy needed. Connected to a
 * server, it plays the server's stream proxy.
 */
export const streamSource = (id: string, kind: "audio" | "video" = "audio", quality: "sd" | "hd" = "sd"): Promise<string> =>
  server ? server.streamUrl(id, kind, quality) : resolveAudio(id).then((r) => r.url);

export async function explainStreamError(url: string, error?: MediaError | null): Promise<{ message: string }> {
  if (server) return server.explain(url, error);
  forgetUrl(url);
  return { message: navigator.onLine ? getT().player.streamFailed : getT().player.offline };
}

/** Where the library and the music come from: this phone, or a Musike server (Settings > Server). */
export const connection: Connection = makeConnection(saved, api, () => lib.getLibrary());

/** Backups are shared through Android's share sheet (save to Files, Drive, send to the computer…). */
export async function saveFile(name: string, text: string) {
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  await Share.share({ title: name, files: [uri] });
}

export const systemMedia = media;

/**
 * On the phone alone there's no video (videos play as audio). Connected to a server, the server streams the video
 * too, as in the browser.
 */
export const capabilities = { video: !!server, engineSettings: false, retryOnError: true };

/** Android Auto's lists and searches (native/car.ts), loaded only in the app. */
export const startCar: (() => void) | null = () => void import("./car").then((m) => m.startCar());

/** Devices in step: only connected to a Musike server over https (see native/connection.ts). */
export const syncAddress: (() => Promise<string>) | null = server?.syncAddress ?? null;

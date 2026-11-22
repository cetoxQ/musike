export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  /** YouTube Music channel of the main artist, when known: opens their artist page. */
  artistId?: string;
  /** YouTube Music album the track belongs to, when known: opens the album page. */
  albumId?: string;
  /** YouTube Music's play count as it words it ("235M plays"), on an artist's top songs. Not saved. */
  plays?: string;
  duration: number;
  thumb: string;
  art: string;
  kind: "song" | "video";
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tracks: Track[];
  /** A radio playlist not saved yet (see RadioInfo); absent on a playlist of yours. */
  radio?: RadioInfo;
}

/**
 * The radio playlist: made with the tracks a radio queued, one at a time (starting another radio replaces it). Tracks
 * can be kept; regenerating swaps the others for new ones from the radio of the kept ones. Saved, it becomes a
 * playlist like the others.
 */
export interface RadioInfo {
  /** The track the radio started from. */
  seed: string;
  /** Tracks marked to keep (ids). */
  kept: string[];
  /** Tracks regenerating took out: not brought back. */
  discarded: string[];
  /** Changed since it was made (kept tracks, regenerated, renamed, tracks added, taken out or moved): starting another
   * radio asks before deleting it. */
  edited: boolean;
}

/** An artist kept in the library. */
export interface SavedArtist {
  id: string;
  name: string;
  thumb: string;
  art: string;
  savedAt: number;
}

/** An album kept in the library. */
export interface SavedAlbum {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  year: string;
  thumb: string;
  art: string;
  savedAt: number;
}

/** A YouTube Music playlist kept in the library: a link, it shows whatever the playlist holds when opened. */
export interface SavedYtPlaylist {
  id: string;
  title: string;
  author: string;
  thumb: string;
  art: string;
  savedAt: number;
}

/**
 * Something you searched for, opened or played, for the Search page's "Recent" list: a search, a track, an artist,
 * an album or a YouTube Music playlist. Newest first; one entry per thing (opening it again moves it on top).
 */
export type RecentItem =
  | { kind: "query"; id: string; q: string; at: number }
  | { kind: "track"; id: string; track: Track; at: number }
  | { kind: "artist"; id: string; name: string; thumb: string; at: number }
  | { kind: "album"; id: string; title: string; artist: string; artistId?: string; thumb: string; at: number }
  | { kind: "playlist"; id: string; title: string; author: string; thumb: string; at: number };

/** What the app sends to add one: the server sets the id and the time. */
export type RecentInput =
  | { kind: "query"; q: string }
  | { kind: "track"; track: Track }
  | { kind: "artist"; id: string; name: string; thumb: string }
  | { kind: "album"; id: string; title: string; artist: string; artistId?: string; thumb: string }
  | { kind: "playlist"; id: string; title: string; author: string; thumb: string };

export type RecentKind = RecentItem["kind"];

/** How often a track was played here, and when last. */
export interface PlayEntry {
  track: Track;
  count: number;
  lastPlayed: number;
}

export interface Library {
  favorites: Track[];
  playlists: Playlist[];
  history: Track[];
  /** Newest first. Missing in libraries saved before artists and albums could be kept. */
  artists: SavedArtist[];
  albums: SavedAlbum[];
  ytPlaylists: SavedYtPlaylist[];
  /** Play counts, most recently played first. Kept apart from the rest: GET /api/library leaves it out. */
  plays: PlayEntry[];
}

import { tr, type Text } from "./i18n.js";

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** A YouTube Music artist page (a channel ID). */
export const ARTIST_ID = /^UC[\w-]{22}$/;
/** A YouTube Music album page. */
export const ALBUM_ID = /^MPRE[\w-]{6,60}$/;
/** A YouTube (Music) playlist page, as its browse ID: "VL" and the playlist ID. */
export const YT_PLAYLIST_ID = /^VL[\w-]{10,80}$/;

/** Machine-readable reason so the web app can offer the right fix (e.g. "update yt-dlp"). */
export type ErrorCode = "tool_missing" | "maybe_outdated" | "bot_check" | "auth_required" | "password_change_required";

/** An error for the person using the app: its text is translated into each request's language when sent. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public text: Text,
    public code?: ErrorCode,
  ) {
    super(tr("en", text));
  }
}

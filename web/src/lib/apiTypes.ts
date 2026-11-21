import type {
  AlbumCard,
  AlbumPage,
  ArtistCard,
  ArtistPage,
  Discover,
  Genre,
  GenreArtist,
  GenrePage,
  Library,
  PlayEntry,
  Playlist,
  PlaylistCard,
  RecentInput,
  RecentItem,
  RecentKind,
  SavedAlbum,
  SavedArtist,
  SavedYtPlaylist,
  Track,
  YtPlaylistPage,
} from "./types";

/**
 * What the app needs from a backend. The web app and the desktop app talk to the Musike server over HTTP
 * (lib/api.ts); the Android app does the same work on the phone (native/api.ts). The build picks one.
 */

export type ErrorCode = "tool_missing" | "maybe_outdated" | "bot_check" | "auth_required" | "password_change_required";

export type Role = "admin" | "user";

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
  /** The first admin: other admins can't demote, reset or delete them. */
  owner: boolean;
  mustChangePassword: boolean;
}

/** Accounts on this server: off (everyone shares one library), or on, maybe still waiting for the admin. */
export interface AuthStatus {
  enabled: boolean;
  /** No password set yet: the first visit creates the admin. */
  setup: boolean;
  user: AuthUser | null;
}

export interface UserInfo extends AuthUser {
  createdAt: number;
  lastSeen: number | null;
}

/**
 * Told when the server says the session ended or a new password is due, wherever that happens (lib/api.ts calls
 * it, the auth store listens). Here so that both backends share it.
 */
export const authEvents: { listener: ((code: "auth_required" | "password_change_required") => void) | null } = { listener: null };

/**
 * The Android app connected to a server: whether the server answers. While it doesn't, the app goes on from the
 * phone with a copy of the account's library, and queues what changes (native/offline.ts).
 */
export interface ServerLink {
  online: boolean;
  /** Since when the server hasn't answered (ms), while offline. */
  since: number | null;
  /** Changes waiting for the server. */
  pending: number;
  subscribe(fn: () => void): () => void;
  /** Try the server now; true once it answers. */
  retry(): Promise<boolean>;
  /** Connected: is the server still there? If not, the app goes on from the phone (false). */
  check(): Promise<boolean>;
}

/** Settings > Android Auto (the Android app only). */
export interface CarSettings {
  /** Whether the app may open itself from the car, and what happened with the car lately. */
  info(): Promise<{ background: boolean; xiaomi: boolean; log: string[] }>;
  /** The system page where that's allowed. */
  openBackgroundSettings(): Promise<void>;
  /** Sends the car's log through the share sheet. */
  shareLog(text: string): Promise<void>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: ErrorCode) {
    super(message);
  }
}

export type Channel = "stable" | "nightly";

export interface ImportResult {
  playlistsAdded: number;
  playlistsMerged: number;
  tracksAdded: number;
  favoritesAdded: number;
  /** Missing when talking to an older server. */
  artistsAdded?: number;
  albumsAdded?: number;
  ytPlaylistsAdded?: number;
  playsAdded?: number;
}

export interface SystemJob {
  kind: "update" | "install";
  channel: Channel;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  from: string | null;
  to: string | null;
  message: string;
  log: string[];
}

export interface SystemInfo {
  ytdlp: {
    path: string | null;
    version: string | null;
    channel: Channel;
    latest: Record<Channel, string | null>;
    updateAvailable: boolean;
  };
  deno: string | null;
  ffmpeg: string | null;
  canInstall: boolean;
  job: SystemJob | null;
}

export interface Prepared {
  id: string;
  title: string;
  duration: number;
  hasSdVideo: boolean;
}

/**
 * The operating system's media controls (notification, lock screen, headphone buttons) when the browser's
 * Media Session can't reach them: the Android app. Absent elsewhere.
 */
export interface SystemMedia {
  /** duration: the track's own (seconds), so the car and lock screen show the progress bar at once. */
  setTrack(track: { title: string; artist: string; album: string; artwork: string; duration?: number }): void;
  setState(state: { playing: boolean; position: number; duration: number }): void;
  onAction(handler: (action: "play" | "pause" | "next" | "previous" | "seek", position?: number) => void): void;
}

/**
 * The Android app: where its library and music come from. "device": the phone itself (YouTube straight from the
 * phone, the library in the app's storage). "server": a Musike server, with an account; every request goes there.
 */
export interface Connection {
  mode: "device" | "server";
  /** The server's address (kept when switching back to the phone, to reconnect easily). */
  url: string;
  /** Checks that a Musike server answers at the address, then switches to it (the app restarts). */
  connect(url: string): Promise<void>;
  /** Back to the phone's own library (signs out of the server; the app restarts). */
  useDevice(): Promise<void>;
  /** The phone's own library, merged into the account on the server (like importing a backup). */
  uploadLocalLibrary(): Promise<ImportResult>;
}

export interface MusikeApi {
  search(q: string, type: "song" | "video", signal?: AbortSignal): Promise<Track[]>;
  suggest(q: string, signal?: AbortSignal): Promise<string[]>;
  radio(id: string): Promise<Track[]>;
  genres(): Promise<Genre[]>;
  genre(id: string, signal?: AbortSignal): Promise<GenrePage>;
  genreArtists(id: string, offset: number): Promise<{ artists: GenreArtist[]; hasMore: boolean }>;
  artist(id: string, signal?: AbortSignal): Promise<ArtistPage>;
  album(id: string, signal?: AbortSignal): Promise<AlbumPage>;
  searchAlbums(q: string, signal?: AbortSignal): Promise<AlbumCard[]>;
  searchArtists(q: string, signal?: AbortSignal): Promise<ArtistCard[]>;
  searchPlaylists(q: string, signal?: AbortSignal): Promise<PlaylistCard[]>;
  ytPlaylist(id: string, signal?: AbortSignal): Promise<YtPlaylistPage>;
  /** The music video matching a song, or null when YouTube has none. */
  videoFor(t: Track): Promise<Track | null>;
  prepare(id: string, signal?: AbortSignal): Promise<Prepared>;

  library(): Promise<Library>;
  addFavorite(t: Track): Promise<{ favorites: Track[] }>;
  addFavorites(tracks: Track[]): Promise<{ favorites: Track[] }>;
  removeFavorite(id: string): Promise<{ favorites: Track[] }>;
  /** `at`: when it was played (ms), for a play sent later; otherwise now. */
  pushHistory(t: Track, at?: number): Promise<{ history: Track[] }>;
  /** One artist's tracks played here, most played first; without an artist, the whole play log. */
  plays(artistId?: string, name?: string, signal?: AbortSignal): Promise<PlayEntry[]>;
  /** The profile: the most played in the last 3 months, or ever. */
  topPlays(range: "3m" | "all", limit?: number, signal?: AbortSignal): Promise<PlayEntry[]>;
  /** The profile: artists to try, from the pages of the ones you play and follow. */
  discover(signal?: AbortSignal): Promise<Discover>;
  saveArtist(a: SavedArtist): Promise<{ artists: SavedArtist[] }>;
  removeArtist(id: string): Promise<{ artists: SavedArtist[] }>;
  saveAlbum(a: SavedAlbum): Promise<{ albums: SavedAlbum[] }>;
  removeAlbum(id: string): Promise<{ albums: SavedAlbum[] }>;
  saveYtPlaylist(p: SavedYtPlaylist): Promise<{ ytPlaylists: SavedYtPlaylist[] }>;
  removeYtPlaylist(id: string): Promise<{ ytPlaylists: SavedYtPlaylist[] }>;
  createPlaylist(name: string, tracks?: Track[]): Promise<Playlist>;
  renamePlaylist(id: string, name: string): Promise<Playlist>;
  deletePlaylist(id: string): Promise<void>;
  addToPlaylist(id: string, t: Track | Track[]): Promise<Playlist>;
  removeFromPlaylist(id: string, trackId: string): Promise<Playlist>;
  importLibrary(backup: unknown, mode: "merge" | "replace"): Promise<ImportResult>;
  /** The Search page's "Recent" list, newest first. */
  recent(signal?: AbortSignal): Promise<RecentItem[]>;
  pushRecent(item: RecentInput): Promise<RecentItem[]>;
  removeRecent(kind: RecentKind, id: string): Promise<RecentItem[]>;
  clearRecent(): Promise<RecentItem[]>;

  system(): Promise<SystemInfo>;
  updateYtdlp(channel: Channel): Promise<SystemJob>;

  authStatus(): Promise<AuthStatus>;
  setup(username: string, password: string): Promise<{ user: AuthUser }>;
  login(username: string, password: string): Promise<{ user: AuthUser }>;
  logout(): Promise<void>;
  changePassword(current: string, password: string): Promise<{ user: AuthUser }>;
  users(): Promise<UserInfo[]>;
  /** The new account and its temporary password (shown once). */
  createUser(username: string, role: Role): Promise<{ user: AuthUser; password: string }>;
  setUserRole(id: number, role: Role): Promise<{ user: AuthUser }>;
  /** A new temporary password; the user's devices are signed out. */
  resetUserPassword(id: number): Promise<{ password: string }>;
  deleteUser(id: number): Promise<void>;
}

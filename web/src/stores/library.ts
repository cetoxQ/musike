import { create } from "zustand";
import { getT } from "../i18n";
import { api } from "../lib/api";
import type { Library, Playlist, SavedAlbum, SavedArtist, SavedYtPlaylist, Track } from "../lib/types";
import { toast } from "./ui";

interface LibraryState extends Library {
  status: "idle" | "loading" | "ready" | "error";
  load: () => Promise<void>;
  /** Fetches it again without showing it as loading (another device changed it). */
  refresh: () => Promise<void>;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (t: Track) => Promise<void>;
  addFavorites: (tracks: Track[]) => Promise<void>;
  recordPlay: (t: Track) => void;
  /** Bumped whenever your plays change (a play, one removed or forgotten): what shows them fetches again. */
  playsVersion: number;
  /** Off Recently played only. */
  removeFromHistory: (id: string) => Promise<void>;
  /** Damnatio memoriae: every trace of the track's plays, gone. */
  forget: (id: string) => Promise<void>;
  toggleArtist: (a: SavedArtist) => Promise<void>;
  toggleAlbum: (a: SavedAlbum) => Promise<void>;
  toggleYtPlaylist: (p: SavedYtPlaylist) => Promise<void>;
  createPlaylist: (name: string, tracks?: Track[]) => Promise<Playlist | null>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  addToPlaylist: (id: string, t: Track | Track[]) => Promise<void>;
  removeFromPlaylist: (id: string, trackId: string) => Promise<void>;
  /** Many at once (picked in a list): one notice for all. */
  removeFavorites: (ids: string[]) => Promise<void>;
  removeManyFromPlaylist: (id: string, trackIds: string[]) => Promise<void>;
}

const replacePlaylist = (list: Playlist[], p: Playlist) => list.map((x) => (x.id === p.id ? p : x));

export const useLibrary = create<LibraryState>((set, get) => ({
  favorites: [],
  playlists: [],
  history: [],
  artists: [],
  albums: [],
  ytPlaylists: [],
  status: "idle",

  load: async () => {
    set({ status: "loading" });
    try {
      const lib = await api.library();
      // An older server sends no artists or albums.
      set({ ...lib, artists: lib.artists ?? [], albums: lib.albums ?? [], ytPlaylists: lib.ytPlaylists ?? [], status: "ready" });
    } catch {
      set({ status: "error" });
    }
  },

  refresh: async () => {
    try {
      const lib = await api.library();
      set({ ...lib, artists: lib.artists ?? [], albums: lib.albums ?? [], ytPlaylists: lib.ytPlaylists ?? [], status: "ready" });
    } catch {
      /* the next change, or the next start, brings it */
    }
  },

  isFavorite: (id) => get().favorites.some((t) => t.id === id),

  toggleFavorite: async (track) => {
    const prev = get().favorites;
    const on = !prev.some((t) => t.id === track.id);
    // Optimistic: the heart responds instantly, then reconciles with the server.
    set({ favorites: on ? [track, ...prev] : prev.filter((t) => t.id !== track.id) });
    try {
      const { favorites } = on ? await api.addFavorite(track) : await api.removeFavorite(track.id);
      set({ favorites });
      toast(on ? getT().toasts.addedFavorite : getT().toasts.removedFavorite);
    } catch (e) {
      set({ favorites: prev });
      toast((e as Error).message, "error");
    }
  },

  addFavorites: async (tracks) => {
    const prev = get().favorites;
    const fresh = tracks.filter((t) => !prev.some((f) => f.id === t.id));
    if (!fresh.length) return toast(getT().toasts.allAlreadyFavorites);
    set({ favorites: [...fresh, ...prev] });
    try {
      const { favorites } = await api.addFavorites(fresh);
      set({ favorites });
      toast(fresh.length === 1 ? getT().toasts.addedFavorite : getT().toasts.addedFavorites(fresh.length));
    } catch (e) {
      set({ favorites: prev });
      toast((e as Error).message, "error");
    }
  },

  toggleArtist: async (artist) => {
    const prev = get().artists;
    const on = !prev.some((a) => a.id === artist.id);
    set({ artists: on ? [artist, ...prev] : prev.filter((a) => a.id !== artist.id) });
    try {
      const { artists } = on ? await api.saveArtist(artist) : await api.removeArtist(artist.id);
      set({ artists });
      toast(on ? getT().toasts.savedToLibrary(artist.name) : getT().toasts.removedFromLibrary(artist.name));
    } catch (e) {
      set({ artists: prev });
      toast((e as Error).message, "error");
    }
  },

  toggleAlbum: async (album) => {
    const prev = get().albums;
    const on = !prev.some((a) => a.id === album.id);
    set({ albums: on ? [album, ...prev] : prev.filter((a) => a.id !== album.id) });
    try {
      const { albums } = on ? await api.saveAlbum(album) : await api.removeAlbum(album.id);
      set({ albums });
      toast(on ? getT().toasts.savedToLibrary(album.title) : getT().toasts.removedFromLibrary(album.title));
    } catch (e) {
      set({ albums: prev });
      toast((e as Error).message, "error");
    }
  },

  toggleYtPlaylist: async (playlist) => {
    const prev = get().ytPlaylists;
    const on = !prev.some((p) => p.id === playlist.id);
    set({ ytPlaylists: on ? [playlist, ...prev] : prev.filter((p) => p.id !== playlist.id) });
    try {
      const { ytPlaylists } = on ? await api.saveYtPlaylist(playlist) : await api.removeYtPlaylist(playlist.id);
      set({ ytPlaylists });
      toast(on ? getT().toasts.savedToLibrary(playlist.title) : getT().toasts.removedFromLibrary(playlist.title));
    } catch (e) {
      set({ ytPlaylists: prev });
      toast((e as Error).message, "error");
    }
  },

  recordPlay: (track) => {
    set((s) => ({ history: [track, ...s.history.filter((t) => t.id !== track.id)].slice(0, 60), playsVersion: s.playsVersion + 1 }));
    api.pushHistory(track).catch(() => {});
  },

  playsVersion: 0,

  removeFromHistory: async (id) => {
    const before = get().history;
    set((s) => ({ history: s.history.filter((t) => t.id !== id), playsVersion: s.playsVersion + 1 }));
    try {
      set({ history: (await api.removeFromHistory(id)).history });
      toast(getT().forget.removed);
    } catch (e) {
      set({ history: before });
      toast((e as Error).message || getT().forget.failed, "error");
    }
  },

  forget: async (id) => {
    const before = get().history;
    set((s) => ({ history: s.history.filter((t) => t.id !== id), playsVersion: s.playsVersion + 1 }));
    try {
      const { history } = await api.forget(id);
      set((s) => ({ history, playsVersion: s.playsVersion + 1 }));
      toast(getT().forget.forgotten);
    } catch (e) {
      set({ history: before });
      toast((e as Error).message || getT().forget.failed, "error");
    }
  },

  createPlaylist: async (name, tracks = []) => {
    try {
      const p = await api.createPlaylist(name, tracks);
      set((s) => ({ playlists: [p, ...s.playlists] }));
      toast(getT().toasts.playlistCreated(p.name));
      return p;
    } catch (e) {
      toast((e as Error).message, "error");
      return null;
    }
  },

  renamePlaylist: async (id, name) => {
    try {
      const p = await api.renamePlaylist(id, name);
      set((s) => ({ playlists: replacePlaylist(s.playlists, p) }));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  },

  deletePlaylist: async (id) => {
    const prev = get().playlists;
    set({ playlists: prev.filter((p) => p.id !== id) });
    try {
      await api.deletePlaylist(id);
      toast(getT().toasts.playlistDeleted);
    } catch (e) {
      set({ playlists: prev });
      toast((e as Error).message, "error");
    }
  },

  addToPlaylist: async (id, tracks) => {
    try {
      const before = get().playlists.find((p) => p.id === id)?.tracks.length ?? 0;
      const p = await api.addToPlaylist(id, tracks);
      set((s) => ({ playlists: replacePlaylist(s.playlists, p) }));
      const added = p.tracks.length - before;
      const t = getT();
      if (!Array.isArray(tracks) || added === 1) toast(t.toasts.addedTo(p.name));
      else toast(added ? t.toasts.addedManyTo(added, p.name) : t.toasts.allAlreadyIn(p.name));
    } catch (e) {
      toast((e as Error).message, "error");
    }
  },

  removeFavorites: async (ids) => {
    const prev = get().favorites;
    const gone = new Set(ids);
    set({ favorites: prev.filter((t) => !gone.has(t.id)) });
    try {
      let favorites = prev;
      for (const id of ids) ({ favorites } = await api.removeFavorite(id));
      set({ favorites });
      toast(getT().toasts.removedFavorites(ids.length));
    } catch (e) {
      toast((e as Error).message, "error");
      void get().load(); // some may be gone already: show what the server has
    }
  },

  removeManyFromPlaylist: async (id, trackIds) => {
    const prev = get().playlists;
    const gone = new Set(trackIds);
    set({ playlists: prev.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((t) => !gone.has(t.id)) } : p)) });
    try {
      let last: Playlist | null = null;
      for (const trackId of trackIds) last = await api.removeFromPlaylist(id, trackId);
      if (last) set((s) => ({ playlists: replacePlaylist(s.playlists, last!) }));
      toast(getT().toasts.removedFromPlaylist(trackIds.length));
    } catch (e) {
      toast((e as Error).message, "error");
      void get().load();
    }
  },

  removeFromPlaylist: async (id, trackId) => {
    const prev = get().playlists;
    set({
      playlists: prev.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p)),
    });
    try {
      const p = await api.removeFromPlaylist(id, trackId);
      set((s) => ({ playlists: replacePlaylist(s.playlists, p) }));
    } catch (e) {
      set({ playlists: prev });
      toast((e as Error).message, "error");
    }
  },
}));

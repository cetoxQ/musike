import { existsSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { DEFAULT_USER, openDb } from "./db.js";
import { jsonLibrary, type LibraryStore } from "./library.js";
import { fileStorage } from "./libraryFile.js";
import { sqliteLibraries } from "./librarySqlite.js";

export interface ServerLibrary {
  library: LibraryStore;
  /** Where it lives: data/musike.db, or data/library.json. */
  kind: "sqlite" | "json";
  close: () => void;
}

/**
 * The library for this server: SQLite when this Node has it (MUSIKE_LIBRARY=sqlite to require it), library.json
 * otherwise or with MUSIKE_LIBRARY=json (the desktop app keeps that file).
 */
export async function openServerLibrary(dir = config.dataDir, want = config.library): Promise<ServerLibrary> {
  if (want !== "json") {
    try {
      const db = await openDb(path.join(dir, "musike.db"));
      const library = sqliteLibraries(db).forUser(DEFAULT_USER);
      try {
        await importJsonFile(dir, library);
      } catch (e) {
        db.close();
        throw e;
      }
      return { library, kind: "sqlite", close: () => db.close() };
    } catch (e) {
      const missing = (e as NodeJS.ErrnoException).code === "ERR_UNKNOWN_BUILTIN_MODULE";
      if (want === "sqlite" || !missing) throw e;
      console.warn("  This Node has no SQLite (22.13 or later needed): the library stays in library.json.");
    }
  }
  return { library: jsonLibrary(fileStorage(dir)), kind: "json", close: () => {} };
}

/**
 * The library.json of an earlier version moves into the database on the first start. The file is then renamed
 * (library.json.imported, or with the date when that exists), never deleted. A library.json that shows up again later (MUSIKE_LIBRARY=json was
 * used for a while) is merged in the same way: nothing in the database is lost.
 */
async function importJsonFile(dir: string, library: LibraryStore) {
  const file = path.join(dir, "library.json");
  if (!existsSync(file)) return;
  let old: unknown;
  try {
    old = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} can't be read (${(e as Error).message}). Fix or move it away, then start again.`);
  }
  const now = await library.getLibrary();
  const empty = !now.favorites.length && !now.playlists.length && !now.history.length && !now.artists.length && !now.albums.length && !now.ytPlaylists.length && !now.plays.length;
  const r = await library.importLibrary(old, empty ? "replace" : "merge");
  // An earlier copy is never overwritten.
  const kept = existsSync(`${file}.imported`) ? `${file}.imported-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}` : `${file}.imported`;
  await rename(file, kept);
  console.log(
    `  Library moved from library.json into musike.db (favorites: ${r.favoritesAdded}, playlists: ${r.playlistsAdded}, ` +
      `artists: ${r.artistsAdded}, albums: ${r.albumsAdded}, saved playlists: ${r.ytPlaylistsAdded}, played tracks: ${r.playsAdded}). ` +
      `The file is kept as ${path.basename(kept)}.`,
  );
}

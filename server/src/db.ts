import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

// The server's database: one SQLite file (data/musike.db), through Node's built-in node:sqlite (Node 22.13+).

export type Db = DatabaseSync;
export type Param = SQLInputValue;
export type Row = Record<string, Param>;

/** The user that owns the library until accounts exist: the first admin. */
export const DEFAULT_USER = 1;

/**
 * Schema changes, in order. The database remembers how many it has applied (PRAGMA user_version), so each runs
 * once. Never edit one that was released: add the next.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id         INTEGER PRIMARY KEY,
    username   TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    role       TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    created_at INTEGER NOT NULL
  );
  INSERT INTO users (id, username, role, created_at)
    VALUES (1, 'admin', 'admin', CAST(strftime('%s', 'now') AS INTEGER) * 1000);

  -- What YouTube says about a track, shared by every list that holds it (the latest copy seen wins).
  CREATE TABLE tracks (
    id        TEXT    PRIMARY KEY,
    title     TEXT    NOT NULL,
    artist    TEXT    NOT NULL,
    album     TEXT,
    artist_id TEXT,
    album_id  TEXT,
    duration  INTEGER NOT NULL DEFAULT 0,
    thumb     TEXT    NOT NULL DEFAULT '',
    art       TEXT    NOT NULL DEFAULT '',
    kind      TEXT    NOT NULL DEFAULT 'song' CHECK (kind IN ('song', 'video'))
  );
  CREATE INDEX tracks_artist ON tracks (artist_id);

  -- Ordered lists: lowest pos first.
  CREATE TABLE favorites (
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_id TEXT    NOT NULL REFERENCES tracks (id),
    pos      INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id)
  );
  CREATE TABLE history (
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_id TEXT    NOT NULL REFERENCES tracks (id),
    pos      INTEGER NOT NULL,
    PRIMARY KEY (user_id, track_id)
  );

  CREATE TABLE playlists (
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id         TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    pos        INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE TABLE playlist_tracks (
    user_id     INTEGER NOT NULL,
    playlist_id TEXT    NOT NULL,
    track_id    TEXT    NOT NULL REFERENCES tracks (id),
    pos         INTEGER NOT NULL,
    PRIMARY KEY (user_id, playlist_id, track_id),
    FOREIGN KEY (user_id, playlist_id) REFERENCES playlists (user_id, id) ON DELETE CASCADE
  );

  CREATE TABLE saved_artists (
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id       TEXT    NOT NULL,
    name     TEXT    NOT NULL,
    thumb    TEXT    NOT NULL DEFAULT '',
    art      TEXT    NOT NULL DEFAULT '',
    saved_at INTEGER NOT NULL,
    pos      INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE TABLE saved_albums (
    user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id        TEXT    NOT NULL,
    title     TEXT    NOT NULL,
    artist    TEXT    NOT NULL DEFAULT '',
    artist_id TEXT,
    year      TEXT    NOT NULL DEFAULT '',
    thumb     TEXT    NOT NULL DEFAULT '',
    art       TEXT    NOT NULL DEFAULT '',
    saved_at  INTEGER NOT NULL,
    pos       INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  CREATE TABLE saved_yt_playlists (
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id       TEXT    NOT NULL,
    title    TEXT    NOT NULL,
    author   TEXT    NOT NULL DEFAULT '',
    thumb    TEXT    NOT NULL DEFAULT '',
    art      TEXT    NOT NULL DEFAULT '',
    saved_at INTEGER NOT NULL,
    pos      INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );

  -- One row per play (count 1, source 'app'). Plays restored from a backup only have a total and the last
  -- time, so they come in as one row with what the backup has beyond ours (source 'import'), dated at that
  -- last play; count 0 when the backup adds no plays but a later last play.
  CREATE TABLE plays (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    track_id  TEXT    NOT NULL REFERENCES tracks (id),
    played_at INTEGER NOT NULL,
    count     INTEGER NOT NULL DEFAULT 1 CHECK (count >= 0),
    source    TEXT    NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'import'))
  );
  CREATE INDEX plays_user_track ON plays (user_id, track_id);
  CREATE INDEX plays_user_time ON plays (user_id, played_at);
  `,
  `
  -- Accounts. No password yet: the first admin sets one on the first visit (when accounts are on).
  ALTER TABLE users ADD COLUMN password_hash TEXT;
  ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

  -- Signed-in devices. id is the SHA-256 of the session token: the token itself is never stored.
  CREATE TABLE sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    client     TEXT    NOT NULL DEFAULT 'web' CHECK (client IN ('web', 'app')),
    user_agent TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id);
  `,
  `
  -- Last use of any of the user's devices, kept on the user: sessions end (sign-out, password change), this stays.
  ALTER TABLE users ADD COLUMN last_seen INTEGER;
  UPDATE users SET last_seen = (SELECT MAX(last_seen) FROM sessions WHERE sessions.user_id = users.id);
  `,
  `
  -- The owner: the first admin (user 1, who set Musike up and had the library from before accounts). Always an
  -- admin; other admins can't demote, reset or delete them.
  ALTER TABLE users ADD COLUMN owner INTEGER NOT NULL DEFAULT 0;
  UPDATE users SET owner = 1, role = 'admin' WHERE id = 1;
  `,
];

/** node:sqlite, loaded only when used. Its one-time "experimental feature" warning stays out of the logs. */
async function loadSqlite(): Promise<typeof import("node:sqlite")> {
  const emit = process.emitWarning;
  process.emitWarning = function (this: unknown, warning: string | Error, ...rest: unknown[]) {
    if (/\bSQLite\b/.test(typeof warning === "string" ? warning : warning.message)) return;
    return (emit as (...args: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    return await import("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
}

/** Opens (or creates) the database and brings its schema up to date. ":memory:" for a throwaway one. */
export async function openDb(file: string): Promise<Db> {
  const { DatabaseSync } = await loadSqlite();
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL: readers never wait for a write. foreign_keys: SQLite leaves them off unless asked, per connection.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const version = Number((db.prepare("PRAGMA user_version").get() as Row).user_version);
  if (version > MIGRATIONS.length) {
    throw new Error(`The database was made by a newer Musike (schema ${version}, this version knows ${MIGRATIONS.length}).`);
  }
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

/**
 * Runs fn as one transaction: all of it is saved, or none. node:sqlite is synchronous, so nothing else runs
 * in between. fn must not start another one.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

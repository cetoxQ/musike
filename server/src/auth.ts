import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { type Db, type Row, transaction } from "./db.js";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";

// Accounts on a Musike server (MUSIKE_AUTH=on): users, passwords, sessions. The library of each user is in
// librarySqlite.ts; the routes are in app.ts.

export type Role = "admin" | "user";

/** What the app gets to know about a user. */
export interface PublicUser {
  id: number;
  username: string;
  role: Role;
  /** The first admin: always an admin, and other admins can't demote, reset or delete them. */
  owner: boolean;
  mustChangePassword: boolean;
}

export interface UserInfo extends PublicUser {
  createdAt: number;
  /** Last sign-in or use of any of their devices (to the hour), or null if they never signed in. */
  lastSeen: number | null;
}

export const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/i;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
/** Unused for this long, a session ends (each use pushes it back). */
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
/** last_seen is written at most this often, not on every request. */
const TOUCH_MS = 60 * 60 * 1000;
/** How long a stream link works (an app asks for a new one before it runs out). */
export const STREAM_LINK_MS = 12 * 60 * 60 * 1000;

// Passwords: scrypt (memory-hard, in Node itself). Stored as scrypt$log2N$r$p$salt$hash, so the cost can
// change later without breaking existing hashes.

const COST = { log2N: 15, r: 8, p: 1, keylen: 64 };

function derive(password: string, salt: Buffer, log2N: number, r: number, p: number, keylen: number): Promise<Buffer> {
  const N = 2 ** log2N;
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, keylen, { N, r, p, maxmem: 256 * N * r }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST.log2N, COST.r, COST.p, COST.keylen);
  return ["scrypt", COST.log2N, COST.r, COST.p, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, log2N, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await derive(password, Buffer.from(salt, "base64"), Number(log2N), Number(r), Number(p), want.length);
  return timingSafeEqual(got, want);
}

/** Checked against when the username doesn't exist, so a wrong name takes as long as a wrong password. */
let dummyHash: Promise<string> | null = null;

export function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) throw new HttpError(400, msg("passwordTooShort"));
  return password.slice(0, PASSWORD_MAX);
}

export function checkUsername(username: unknown): string {
  const name = typeof username === "string" ? username.trim() : "";
  if (!USERNAME.test(name)) throw new HttpError(400, msg("usernameInvalid"));
  return name;
}

/** A password to hand over once (new account, reset): 4 groups of 4, no look-alike characters. */
export function temporaryPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join("")).join("-");
}

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

const toUser = (r: Row): PublicUser => ({
  id: Number(r.id),
  username: String(r.username),
  role: r.role === "admin" ? "admin" : "user",
  owner: Number(r.owner) === 1,
  mustChangePassword: Number(r.must_change_password) === 1,
});

/** Users and sessions in the database. */
export function accounts(db: Db) {
  const q = (sql: string) => db.prepare(sql);
  const USER = "SELECT id, username, role, owner, must_change_password, password_hash, created_at FROM users";
  const byId = q(`${USER} WHERE id = ?`);
  const byName = q(`${USER} WHERE username = ?`);
  const all = q("SELECT id, username, role, owner, must_change_password, created_at, last_seen FROM users ORDER BY owner DESC, username COLLATE NOCASE");
  const withPassword = q("SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL");
  const admins = q("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  const insert = q("INSERT INTO users (username, role, password_hash, must_change_password, created_at) VALUES (?, ?, ?, 1, ?)");
  const setPassword = q("UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?");
  const setName = q("UPDATE users SET username = ? WHERE id = ?");
  const setRole = q("UPDATE users SET role = ? WHERE id = ?");
  const remove = q("DELETE FROM users WHERE id = ?");

  const sessionInsert = q("INSERT INTO sessions (id, user_id, client, user_agent, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const sessionGet = q(`SELECT s.id AS sid, s.last_seen, s.expires_at, u.id, u.username, u.role, u.owner, u.must_change_password
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`);
  const sessionTouch = q("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?");
  const userSeen = q("UPDATE users SET last_seen = ? WHERE id = ?");
  const sessionDelete = q("DELETE FROM sessions WHERE id = ?");
  const sessionsOfUser = q("DELETE FROM sessions WHERE user_id = ? AND id <> ?");
  const sessionsPrune = q("DELETE FROM sessions WHERE expires_at < ?");
  const sessionById = q(`SELECT s.id AS sid, s.expires_at, u.id, u.username, u.role, u.owner, u.must_change_password
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`);

  /** The key that signs stream links: made once, kept in the database. */
  const streamKey = (() => {
    const row = q("SELECT value FROM settings WHERE key = 'stream_key'").get() as Row | undefined;
    if (row) return Buffer.from(String(row.value), "base64");
    const key = randomBytes(32);
    q("INSERT OR IGNORE INTO settings (key, value) VALUES ('stream_key', ?)").run(key.toString("base64"));
    return Buffer.from(String((q("SELECT value FROM settings WHERE key = 'stream_key'").get() as Row).value), "base64");
  })();
  const sign = (data: string) => createHmac("sha256", streamKey).update(data).digest("base64url");

  const get = (id: number) => byId.get(id) as Row | undefined;
  const mustGet = (id: number) => {
    const r = get(id);
    if (!r) throw new HttpError(404, msg("userNotFound"));
    return r;
  };
  const nameFree = (name: string, except = 0) => {
    const r = byName.get(name) as Row | undefined;
    if (r && Number(r.id) !== except) throw new HttpError(409, msg("usernameTaken"));
  };
  const lastAdminCheck = (r: Row) => {
    if (r.role === "admin" && Number((admins.get() as Row).n) <= 1) throw new HttpError(400, msg("lastAdmin"));
  };

  return {
    /** True until someone has a password: the first visit then sets up the admin. */
    needsSetup: () => Number((withPassword.get() as Row).n) === 0,

    user: (id: number) => {
      const r = get(id);
      return r ? toUser(r) : null;
    },

    /** The first admin (made with the database) gets a name and a password. Only while nobody has one. */
    async setup(username: string, password: string): Promise<PublicUser> {
      const hash = await hashPassword(password);
      return transaction(db, () => {
        if (Number((withPassword.get() as Row).n) > 0) throw new HttpError(409, msg("setupDone"));
        const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() as Row;
        const id = Number(admin.id);
        nameFree(username, id);
        setName.run(username, id);
        setPassword.run(hash, 0, id);
        db.prepare("UPDATE users SET owner = 1 WHERE id = ?").run(id);
        return toUser(get(id)!);
      });
    },

    /** The user, if the password is right. Takes about as long either way. */
    async login(username: string, password: string): Promise<PublicUser | null> {
      const r = byName.get(username.trim()) as Row | undefined;
      if (!r?.password_hash) {
        await verifyPassword(password, await (dummyHash ??= hashPassword("not a real password")));
        return null;
      }
      return (await verifyPassword(password, String(r.password_hash))) ? toUser(r) : null;
    },

    async checkCurrent(id: number, password: string): Promise<boolean> {
      const r = mustGet(id);
      return !!r.password_hash && verifyPassword(password, String(r.password_hash));
    },

    /** A password the user chose: it stops being temporary. */
    async changePassword(id: number, password: string): Promise<PublicUser> {
      const hash = await hashPassword(password);
      setPassword.run(hash, 0, id);
      return toUser(mustGet(id));
    },

    list(): UserInfo[] {
      return (all.all() as Row[]).map((r) => ({
        ...toUser(r),
        createdAt: Number(r.created_at),
        lastSeen: r.last_seen === null ? null : Number(r.last_seen),
      }));
    },

    /** A new account with a temporary password (changed at the first sign-in). */
    async create(username: string, role: Role): Promise<{ user: PublicUser; password: string }> {
      const password = temporaryPassword();
      const hash = await hashPassword(password);
      const id = transaction(db, () => {
        nameFree(username);
        return Number(insert.run(username, role, hash, Date.now()).lastInsertRowid);
      });
      return { user: toUser(get(id)!), password };
    },

    /** Throws if this is the owner: only the owner (or the server's command line) changes that account. */
    guardOwner(id: number) {
      if (Number(mustGet(id).owner) === 1) throw new HttpError(403, msg("ownerProtected"));
    },

    /** The command line's reset (any account, the owner too), by username. */
    async resetByName(username: string): Promise<{ user: PublicUser; password: string }> {
      const r = byName.get(username.trim()) as Row | undefined;
      if (!r) throw new HttpError(404, msg("userNotFound"));
      const user = toUser(r);
      return { user, password: await this.reset(user.id) };
    },

    /** Forgot their password: a temporary one, and every device signed out. */
    async reset(id: number): Promise<string> {
      mustGet(id);
      const password = temporaryPassword();
      setPassword.run(await hashPassword(password), 1, id);
      sessionsOfUser.run(id, "");
      return password;
    },

    setRole(id: number, role: Role): PublicUser {
      return transaction(db, () => {
        const r = mustGet(id);
        if (role !== "admin") lastAdminCheck(r);
        setRole.run(role, id);
        return toUser(get(id)!);
      });
    },

    /** Deletes the account and everything it saved (the library tables cascade). */
    delete(id: number) {
      transaction(db, () => {
        const r = mustGet(id);
        lastAdminCheck(r);
        remove.run(id);
      });
    },

    // Sessions

    /** A new session: the token goes to the device, only its hash is kept. */
    startSession(userId: number, client: "web" | "app", userAgent: string): string {
      const token = randomBytes(32).toString("base64url");
      const now = Date.now();
      sessionInsert.run(sha256(token), userId, client, userAgent.slice(0, 300), now, now, now + SESSION_MS);
      userSeen.run(now, userId);
      return token;
    },

    /** Who a token belongs to, if it's still valid. Pushes its expiry back (at most hourly). */
    session(token: string): { id: string; user: PublicUser } | null {
      if (!token || token.length > 100) return null;
      const r = sessionGet.get(sha256(token)) as Row | undefined;
      if (!r) return null;
      const now = Date.now();
      if (Number(r.expires_at) < now) {
        sessionDelete.run(r.sid);
        return null;
      }
      if (now - Number(r.last_seen) > TOUCH_MS) {
        sessionTouch.run(now, now + SESSION_MS, r.sid);
        userSeen.run(now, r.id);
      }
      return { id: String(r.sid), user: toUser(r) };
    },

    endSession: (id: string) => void sessionDelete.run(id),

    /** Is this session still on (not signed out, reset or expired)? For connections that outlive a request. */
    sessionAlive(id: string): boolean {
      const r = sessionById.get(id) as Row | undefined;
      return !!r && Number(r.expires_at) >= Date.now();
    },

    /**
     * A link token for the audio of this session: a media element can't send "Authorization", so apps put this in
     * the stream URL (?st=). Signed, expiring, and tied to the session: signing out or a reset ends it too.
     */
    streamLink(sessionId: string): { token: string; expiresAt: number } {
      const expiresAt = Date.now() + STREAM_LINK_MS;
      const data = `${sessionId}.${expiresAt}`;
      return { token: `${data}.${sign(data)}`, expiresAt };
    },

    /** The session a stream link token belongs to, if the token is genuine, unexpired and the session still on. */
    streamSession(token: string): { id: string; user: PublicUser } | null {
      const [sid, exp, sig] = token.split(".");
      if (!sid || !exp || !sig || sid.length !== 64 || Number(exp) < Date.now()) return null;
      const want = Buffer.from(sign(`${sid}.${exp}`));
      const got = Buffer.from(sig);
      if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
      const r = sessionById.get(sid) as Row | undefined;
      if (!r || Number(r.expires_at) < Date.now()) return null;
      return { id: String(r.sid), user: toUser(r) };
    },

    /** Signs out every other device of this user. */
    endOtherSessions: (userId: number, keepId: string) => void sessionsOfUser.run(userId, keepId),

    pruneSessions: () => void sessionsPrune.run(Date.now()),
  };
}

export type Accounts = ReturnType<typeof accounts>;

/**
 * Wrong passwords slow down: after 5 failures in a row for a username or an address, each try waits longer
 * (30 seconds, then doubling, up to 15 minutes). In memory: a restart forgets it, which is fine at home.
 */
export function loginThrottle(now = () => Date.now()) {
  const FREE = 5;
  const BASE_MS = 30_000;
  const MAX_MS = 15 * 60_000;
  const state = new Map<string, { fails: number; until: number }>();
  return {
    /** Seconds to wait before another try for any of these keys, or 0. */
    wait(keys: string[]): number {
      const until = Math.max(0, ...keys.map((k) => state.get(k)?.until ?? 0));
      return Math.max(0, Math.ceil((until - now()) / 1000));
    },
    fail(keys: string[]) {
      for (const k of keys) {
        const s = state.get(k) ?? { fails: 0, until: 0 };
        s.fails++;
        if (s.fails >= FREE) s.until = now() + Math.min(MAX_MS, BASE_MS * 2 ** (s.fails - FREE));
        state.set(k, s);
      }
      if (state.size > 10_000) state.clear(); // someone spraying names: start over rather than grow
    },
    succeed(keys: string[]) {
      for (const k of keys) state.delete(k);
    },
  };
}

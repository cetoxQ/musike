import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { sanitizeTrack } from "./library.js";
import type { Track } from "./types.js";

// Devices of one account, Spotify-style: each open app (browser tab, phone) is a device, the server tells every
// device what the others are playing, and only one device plays at a time: starting playback on one pauses the
// others. The others control it: their commands (play, skip, play this album...) are passed on to it, and so is a
// hand-over, when playback moves to another device with its queue. Devices exist while connected; nothing is stored.
//
// A connection starts with a ticket from POST /api/sync/ticket: a browser can't send "Authorization" (or choose its
// cookies) when it opens a WebSocket, so the session is checked there, over plain HTTP, and the ticket carries it
// over. Tickets are single use and expire in 30 seconds.

const TICKET_MS = 30_000;
const MAX_TICKETS = 1000;
/** The server pings every device this often (and drops it if the last ping got no answer); proxies see traffic. */
const PING_MS = 25_000;
/** A device has this long to say who it is. */
const HELLO_MS = 10_000;
const MAX_DEVICES = 20;
/** A hand-over carries a queue (up to MAX_QUEUE tracks). */
const MAX_BYTES = 512 * 1024;
const MAX_QUEUE = 500;
/** Changes to the library within this long go out to the other devices as one message. */
const LIBRARY_MS = 500;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Closing codes the apps act on. */
export const CLOSE = {
  /** The same device connected again (a reload): the old connection must not reconnect. */
  replaced: 4001,
  /** Too many devices on this account. */
  full: 4002,
  /** Never said hello, or sent nonsense. */
  protocol: 4003,
  /** The session ended (signed out, password reset, account deleted): sign in again. */
  signedOut: 4401,
} as const;

/** A browser or the Android app; a computer or a phone (for the icon). */
export type DeviceKind = "web" | "app";
export type DeviceForm = "computer" | "phone";

export type Repeat = "off" | "all" | "one";

export type Quality = "sd" | "hd";

export interface PlayState {
  track: Track | null;
  playing: boolean;
  /** Seconds into the track when the device reported it. */
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  /** The device can play videos; and its Audio/Video choice. */
  video: boolean;
  preferVideo: boolean;
  quality: Quality;
  showingVideo: boolean;
  autoRadio: boolean;
  /** Position of the current track in the device's whole queue. */
  index: number;
}

/** A device's queue (up to MAX_QUEUE tracks around the current one); `offset`: where it starts in the whole queue. */
export interface QueueWindow {
  tracks: Track[];
  offset: number;
}

/** What one device asks another (the one playing, or the one taking over) to do. */
export type Command =
  | { action: "play" | "pause" | "next" | "prev" | "shuffle" | "repeat" }
  | { action: "seek"; position: number }
  | { action: "playList"; tracks: Track[]; start: number }
  | { action: "playTrack" | "playNext" | "addToQueue" | "startRadio"; track: Track }
  | { action: "takeOver"; queue: Track[]; index: number; position: number; shuffle: boolean; repeat: Repeat }
  | { action: "handOver"; to: string }
  | { action: "volume"; volume: number }
  | { action: "mute"; muted: boolean }
  | { action: "preferVideo" | "autoRadio"; on: boolean }
  | { action: "quality"; quality: Quality }
  | { action: "jumpTo" | "removeAt"; index: number; id: string }
  | { action: "clearUpcoming" };

/** What every device of an account is told about each device. `age`: milliseconds since its last report. */
export interface DeviceInfo {
  id: string;
  name: string;
  kind: DeviceKind;
  form: DeviceForm;
  state: (PlayState & { age: number }) | null;
}

/** What changed in an account's library: the lists (favorites, saved, playlists), the Recent list, the history. */
export type LibraryPart = "library" | "recent" | "history";

export type ServerMessage =
  | { type: "devices"; you: string; active: string | null; devices: DeviceInfo[] }
  | { type: "library"; parts: LibraryPart[]; history?: Track[] }
  | { type: "pause" }
  | { type: "command"; from: string; command: Command }
  | { type: "queue"; device: string; queue: Track[]; offset: number };

interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  form: DeviceForm;
  socket: WebSocket;
  session: string | null;
  state: PlayState | null;
  queue: QueueWindow | null;
  /** When the state was reported (server clock). */
  at: number;
  /** Answered the last ping. */
  alive: boolean;
}

interface Ticket {
  user: number;
  session: string | null;
  expires: number;
}

interface Account {
  devices: Map<string, Device>;
  /** The device playing, or the last one that played. */
  active: string | null;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 86_400) : 0);

const REPEATS = new Set<unknown>(["off", "all", "one"]);
const repeatOf = (v: unknown): Repeat => (REPEATS.has(v) ? (v as Repeat) : "off");

function trackOf(v: unknown): Track | null {
  if (!v) return null;
  try {
    return sanitizeTrack(v);
  } catch {
    return null;
  }
}

/** A list of tracks, without the ones that don't check out. */
function tracksOf(v: unknown): Track[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, MAX_QUEUE)
    .map(trackOf)
    .filter((t): t is Track => !!t);
}

const indexIn = (v: unknown, length: number) => (Number.isInteger(v) ? Math.min(Math.max(v as number, 0), length - 1) : 0);
/** A position in a whole queue (which may be longer than what travels). */
const count = (v: unknown) => (Number.isInteger(v) ? Math.min(Math.max(v as number, 0), 1_000_000) : 0);
const QUALITIES = new Set<unknown>(["sd", "hd"]);
const qualityOf = (v: unknown): Quality => (QUALITIES.has(v) ? (v as Quality) : "sd");
const TRACK_ID = /^[\w-]{1,64}$/;
const level = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 1);

function playState(v: unknown): PlayState | null {
  if (!v || typeof v !== "object") return null;
  const s = v as Record<string, unknown>;
  const track = trackOf(s.track);
  if (s.track && !track) return null;
  return {
    track,
    playing: s.playing === true && !!track,
    position: seconds(s.position),
    duration: seconds(s.duration),
    shuffle: s.shuffle === true,
    repeat: repeatOf(s.repeat),
    volume: level(s.volume),
    muted: s.muted === true,
    video: s.video === true,
    preferVideo: s.preferVideo === true,
    quality: qualityOf(s.quality),
    showingVideo: s.showingVideo === true,
    autoRadio: s.autoRadio !== false,
    index: count(s.index),
  };
}

/** A command as it may be passed on, or null. */
function commandOf(v: unknown): Command | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  switch (c.action) {
    case "play":
    case "pause":
    case "next":
    case "prev":
    case "shuffle":
    case "repeat":
      return { action: c.action };
    case "seek":
      return { action: "seek", position: seconds(c.position) };
    case "playList": {
      const tracks = tracksOf(c.tracks);
      return tracks.length ? { action: "playList", tracks, start: indexIn(c.start, tracks.length) } : null;
    }
    case "playTrack":
    case "playNext":
    case "addToQueue":
    case "startRadio": {
      const track = trackOf(c.track);
      return track ? { action: c.action, track } : null;
    }
    case "takeOver": {
      const queue = tracksOf(c.queue);
      if (!queue.length) return null;
      return {
        action: "takeOver",
        queue,
        index: indexIn(c.index, queue.length),
        position: seconds(c.position),
        shuffle: c.shuffle === true,
        repeat: repeatOf(c.repeat),
      };
    }
    case "handOver": {
      const to = text(c.to, 64);
      return DEVICE_ID.test(to) ? { action: "handOver", to } : null;
    }
    case "volume":
      return { action: "volume", volume: level(c.volume) };
    case "mute":
      return { action: "mute", muted: c.muted === true };
    case "preferVideo":
    case "autoRadio":
      return { action: c.action, on: c.on === true };
    case "quality":
      return { action: "quality", quality: qualityOf(c.quality) };
    case "jumpTo":
    case "removeAt": {
      const id = text(c.id, 64);
      return TRACK_ID.test(id) ? { action: c.action, index: count(c.index), id } : null;
    }
    case "clearUpcoming":
      return { action: "clearUpcoming" };
    default:
      return null;
  }
}

export interface SyncOptions {
  /** With accounts on: is this session still valid? Checked at every ping. */
  sessionAlive?: (session: string) => boolean;
}

export function syncHub(opts: SyncOptions = {}) {
  const tickets = new Map<string, Ticket>();
  const accounts = new Map<number, Account>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BYTES, perMessageDeflate: false });

  /** Library changes on their way to an account's devices, gathered for LIBRARY_MS. */
  const changes = new Map<number, { parts: Set<LibraryPart>; from: Set<string>; history?: Track[] }>();

  const accountOf = (user: number): Account => {
    let a = accounts.get(user);
    if (!a) accounts.set(user, (a = { devices: new Map(), active: null }));
    return a;
  };

  const send = (d: Device, m: ServerMessage) => {
    if (d.socket.readyState === d.socket.OPEN) d.socket.send(JSON.stringify(m));
  };

  /** Tells every device of the account who is connected and what they play. */
  const announce = (a: Account) => {
    const now = Date.now();
    const devices: DeviceInfo[] = [...a.devices.values()].map((d) => ({
      id: d.id,
      name: d.name,
      kind: d.kind,
      form: d.form,
      state: d.state && { ...d.state, age: now - d.at },
    }));
    for (const d of a.devices.values()) send(d, { type: "devices", you: d.id, active: a.active, devices });
  };

  const leave = (user: number, d: Device) => {
    const a = accounts.get(user);
    if (!a || a.devices.get(d.id) !== d) return;
    a.devices.delete(d.id);
    if (a.active === d.id) a.active = null;
    if (a.devices.size) announce(a);
    else accounts.delete(user);
  };

  function connected(socket: WebSocket, ticket: Ticket) {
    let me: Device | null = null;
    const hello = setTimeout(() => socket.close(CLOSE.protocol, "hello"), HELLO_MS);

    socket.on("message", (raw: RawData, binary: boolean) => {
      let m: Record<string, unknown>;
      try {
        if (binary) throw new Error("binary");
        m = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (!m || typeof m !== "object") throw new Error("not an object");
      } catch {
        socket.close(CLOSE.protocol, "json");
        return;
      }
      const a = accountOf(ticket.user);

      if (!me) {
        const id = text(m.id, 64);
        if (m.type !== "hello" || !DEVICE_ID.test(id)) return socket.close(CLOSE.protocol, "hello");
        clearTimeout(hello);
        const old = a.devices.get(id);
        if (!old && a.devices.size >= MAX_DEVICES) return socket.close(CLOSE.full, "full");
        if (old) {
          a.devices.delete(id);
          old.socket.close(CLOSE.replaced, "replaced");
        }
        me = {
          id,
          name: text(m.name, 60) || "Musike",
          kind: m.kind === "app" ? "app" : "web",
          form: m.form === "phone" ? "phone" : "computer",
          socket,
          session: ticket.session,
          state: playState(m.state),
          queue: null,
          at: Date.now(),
          alive: true,
        };
        a.devices.set(id, me);
        if (me.state?.playing) startedOn(a, me);
        announce(a);
        // The others' queues, which otherwise travel only when they change.
        for (const other of a.devices.values()) {
          if (other !== me && other.queue) send(me, { type: "queue", device: other.id, queue: other.queue.tracks, offset: other.queue.offset });
        }
        return;
      }

      if (m.type === "state") {
        const state = playState(m.state);
        if (!state) return;
        me.state = state;
        me.at = Date.now();
        if (state.playing) startedOn(a, me);
        announce(a);
      } else if (m.type === "queue") {
        // Its queue changed: kept for devices that connect later, passed on to the others now.
        me.queue = { tracks: tracksOf(m.queue), offset: count(m.offset) };
        for (const other of a.devices.values()) {
          if (other !== me) send(other, { type: "queue", device: me.id, queue: me.queue.tracks, offset: me.queue.offset });
        }
      } else if (m.type === "command") {
        // Only to another device of the same account.
        const to = a.devices.get(text(m.to, 64));
        const command = commandOf(m.command);
        if (to && to !== me && command) send(to, { type: "command", from: me.id, command });
      }
    });

    socket.on("pong", () => {
      if (me) me.alive = true;
    });
    socket.on("close", () => {
      clearTimeout(hello);
      if (me) leave(ticket.user, me);
    });
    socket.on("error", () => socket.terminate());
  }

  /** One device plays at a time: the others are told to pause. */
  function startedOn(a: Account, d: Device) {
    a.active = d.id;
    for (const other of a.devices.values()) {
      if (other !== d && other.state?.playing) send(other, { type: "pause" });
    }
  }

  const heartbeat = setInterval(() => {
    for (const [user, a] of accounts) {
      for (const d of [...a.devices.values()]) {
        if (d.session && opts.sessionAlive && !opts.sessionAlive(d.session)) {
          d.socket.close(CLOSE.signedOut, "signed out");
          leave(user, d);
        } else if (!d.alive) {
          d.socket.terminate();
          leave(user, d);
        } else {
          d.alive = false;
          d.socket.ping();
        }
      }
    }
  }, PING_MS);
  heartbeat.unref();

  return {
    /** A single-use ticket to open the connection with, for this user and session. */
    ticket(user: number, session: string | null): { ticket: string; expiresAt: number } {
      const now = Date.now();
      for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
      if (tickets.size >= MAX_TICKETS) tickets.delete(tickets.keys().next().value!);
      const ticket = randomBytes(24).toString("base64url");
      tickets.set(ticket, { user, session, expires: now + TICKET_MS });
      return { ticket, expiresAt: now + TICKET_MS };
    },

    /** For the HTTP server's "upgrade" event. Returns false for addresses that aren't ours. */
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      const url = new URL(req.url ?? "/", "http://musike");
      if (url.pathname !== "/api/sync") return false;
      const key = url.searchParams.get("ticket") ?? "";
      const ticket = tickets.get(key);
      tickets.delete(key);
      if (!ticket || ticket.expires < Date.now() || (ticket.session && opts.sessionAlive && !opts.sessionAlive(ticket.session))) {
        socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return true;
      }
      wss.handleUpgrade(req, socket, head, (ws) => connected(ws, ticket));
      return true;
    },

    /**
     * The account's library changed (through the HTTP API): its other devices are told, so what they show is fetched
     * again. `from`: the device that made the change, which already has it. A new history comes along whole.
     */
    changed(user: number, part: LibraryPart, from?: string, history?: Track[]) {
      if (!accounts.get(user)?.devices.size) return;
      let c = changes.get(user);
      if (!c) {
        changes.set(user, (c = { parts: new Set(), from: new Set() }));
        setTimeout(() => {
          changes.delete(user);
          const a = accounts.get(user);
          if (!a) return;
          const m: ServerMessage = { type: "library", parts: [...c!.parts], ...(c!.history ? { history: c!.history } : {}) };
          // The device that made every one of these changes has them all; any other device needs them.
          const only = c!.from.size === 1 ? [...c!.from][0] : null;
          for (const d of a.devices.values()) if (d.id !== only) send(d, m);
        }, LIBRARY_MS).unref();
      }
      c.parts.add(part);
      c.from.add(from ?? "");
      if (history) c.history = history;
    },

    /** Devices connected right now, all accounts together. */
    count: () => [...accounts.values()].reduce((n, a) => n + a.devices.size, 0),

    close() {
      clearInterval(heartbeat);
      for (const a of accounts.values()) for (const d of a.devices.values()) d.socket.terminate();
      accounts.clear();
      wss.close();
    },
  };
}

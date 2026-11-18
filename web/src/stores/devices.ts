import { create } from "zustand";
import { capabilities, syncAddress } from "../lib/api";
import type { Track } from "../lib/types";
import { locally, selectCurrent, setRemoteControl, usePlayer, type Quality, type RemoteControl, type Repeat } from "../player/player";
import { useAuth } from "./auth";

// Devices of one account, Spotify-style (server/src/sync.ts). Every open Musike (browser tab, phone) tells the
// server what it plays and sees what the others play. One device plays at a time: the active one. Any other
// device shows it in its player and controls it: its buttons, and "play" anywhere in the app, go there. The
// devices list moves playback (queue and position) to another device. Over https only (syncAddress).

export type DeviceForm = "computer" | "phone";

export interface PlayState {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  video: boolean;
  preferVideo: boolean;
  quality: Quality;
  showingVideo: boolean;
  autoRadio: boolean;
  /** Of the current track, in the whole queue. */
  index: number;
}

export interface Device {
  id: string;
  name: string;
  kind: "web" | "app";
  form: DeviceForm;
  /** With `at`: the local time it arrived, to tell where a playing track is now. */
  state: (PlayState & { at: number }) | null;
}

/** What one device asks another to do (the server checks the same list). */
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

/** Closing codes from the server (sync.ts CLOSE). */
const REPLACED = 4001;
const FULL = 4002;
const PROTOCOL = 4003;
const SIGNED_OUT = 4401;

/** Waits before reconnecting, growing with each failure. */
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

/**
 * A device paused longer than this is no longer shown and controlled from the others: playing on one of them
 * plays there (a computer left paused at home shouldn't take over the phone's player at the gym).
 */
const STALE_MS = 10 * 60_000;

/** At most this many tracks of a queue travel to another device (around the current one). */
const MAX_QUEUE = 500;

function windowed(queue: Track[], index: number): { queue: Track[]; index: number; start: number } {
  if (queue.length <= MAX_QUEUE) return { queue, index, start: 0 };
  const start = Math.max(0, Math.min(index - 50, queue.length - MAX_QUEUE));
  return { queue: queue.slice(start, start + MAX_QUEUE), index: index - start, start };
}

/** One id per tab (sessionStorage): two tabs are two devices, a reload is the same one. */
function deviceId(): string {
  const key = "musike:device";
  try {
    const known = sessionStorage.getItem(key);
    if (known) return known;
    const id = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

/** The Android app (Capacitor), rather than a browser. */
const isApp = () => "Capacitor" in window;

/** A name people recognize: "Chrome (Windows)", or the phone's model in the app. */
export function deviceName(ua = navigator.userAgent, app = isApp()): { name: string; form: DeviceForm } {
  const phone = /Android|iPhone|iPad|Mobile/i.test(ua);
  const form: DeviceForm = phone ? "phone" : "computer";
  if (app) {
    const model = /Android [\d.]+; ([^;)]+?)(?: Build\/|\))/.exec(ua)?.[1]?.trim();
    return { name: model && model !== "K" ? model : "Android", form };
  }
  // The desktop app (Electron, showing a Musike server's pages): "Musike (Windows)".
  const browser =
    "musikeDesktop" in window
      ? "Musike"
      : /Edg\//.test(ua)
        ? "Edge"
        : /OPR\//.test(ua)
          ? "Opera"
          : /Firefox\//.test(ua)
            ? "Firefox"
            : /Chrome\//.test(ua)
              ? "Chrome"
              : /Safari\//.test(ua)
                ? "Safari"
                : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { name: os ? `${browser} (${os})` : browser, form };
}

/** What this device plays right now. A track that is loading is about to play: it counts as playing. */
function current(): PlayState {
  const s = usePlayer.getState();
  const track = selectCurrent(s);
  return {
    track,
    playing: !!track && (s.status === "playing" || s.status === "loading"),
    position: s.position,
    duration: s.duration || track?.duration || 0,
    shuffle: s.shuffle,
    repeat: s.repeat,
    volume: s.volume,
    muted: s.muted,
    video: capabilities.video,
    preferVideo: s.preferVideo,
    quality: s.quality,
    showingVideo: s.mediaKind === "video",
    autoRadio: s.autoRadio,
    index: s.index,
  };
}

/** Where a device's track is now: the reported position, plus the time since if it plays. */
export function positionOf(state: Device["state"], now = Date.now()): number {
  if (!state) return 0;
  const at = state.playing ? state.position + (now - state.at) / 1000 : state.position;
  return state.duration > 0 ? Math.min(at, state.duration) : at;
}

interface DevicesState {
  /** off: no sync here (plain http, the phone's own library); connecting; on. */
  status: "off" | "connecting" | "on";
  me: string;
  /** The device playing, or the last one that played. */
  active: string | null;
  devices: Device[];
  /** The devices list (a dialog). */
  open: boolean;
  setOpen: (open: boolean) => void;
  start: () => void;
  stop: () => void;
  /** Plays on this device (this one, or another): the playing device hands its queue over, from where it is. */
  transfer: (to: string) => void;
}

export const useDevices = create<DevicesState>((set, get) => {
  const me = deviceId();
  const { name, form } = deviceName();
  let socket: WebSocket | null = null;
  let wanted = false;
  let failures = 0;
  let retry = 0;
  let unsubscribe: (() => void) | null = null;
  /** The last state sent, to send only what changed (and a seek): everything but the position, and where that was. */
  let sent: { key: string; playing: boolean; position: number; at: number } | null = null;
  /** The last queue sent (it travels on its own, only when it changes). */
  let sentQueue: { queue: Track[]; start: number } | null = null;
  /** Other devices' queues. */
  const queues = new Map<string, { tracks: Track[]; offset: number }>();
  /** A volume being dragged here: the device's reports, a moment behind, mustn't pull the slider back. */
  let volumeHeld: { volume: number; until: number } | null = null;
  /** The device this one controls, and what it last said. */
  let target: Device | null = null;
  let ticker = 0;
  let staleTimer = 0;

  const post = (m: object) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  };
  const send = (to: string, command: Command) => post({ type: "command", to, command });

  const keyOf = (state: PlayState) => JSON.stringify({ ...state, track: state.track?.id ?? null, position: 0 });

  const report = (force = false) => {
    const state = current();
    const now = Date.now();
    const key = keyOf(state);
    if (!force && sent) {
      const expected = sent.playing ? sent.position + (now - sent.at) / 1000 : sent.position;
      if (sent.key === key && Math.abs(state.position - expected) < 2) return;
    }
    sent = { key, playing: state.playing, position: state.position, at: now };
    post({ type: "state", state });
  };

  const reportQueue = (force = false) => {
    const s = usePlayer.getState();
    const w = windowed(s.queue, s.index);
    if (!force && sentQueue && sentQueue.queue === s.queue && sentQueue.start === w.start) return;
    sentQueue = { queue: s.queue, start: w.start };
    post({ type: "queue", queue: w.queue, offset: w.start });
  };

  // ---- Controlling another device -------------------------------------------------------------------------------

  /** Puts the controlled device into the player (or takes it out), and keeps its time moving. */
  const show = () => {
    window.clearInterval(ticker);
    const s = target?.state;
    if (!target || !s?.track) {
      if (usePlayer.getState().remote) usePlayer.setState({ remote: null });
      setRemoteControl(null);
      return;
    }
    const known = queues.get(target.id);
    const queue = known?.tracks.length ? known.tracks : [s.track];
    // Where its track is in what travelled (by id, should the queue be a moment behind).
    let index = known ? s.index - known.offset : 0;
    if (queue[index]?.id !== s.track.id) index = Math.max(0, queue.findIndex((t) => t.id === s.track!.id));
    const held = volumeHeld && volumeHeld.until > Date.now() ? volumeHeld.volume : null;
    const view = () => ({
      device: target!.id,
      name: target!.name,
      track: s.track,
      playing: s.playing,
      position: positionOf(s),
      duration: s.duration,
      shuffle: s.shuffle,
      repeat: s.repeat,
      volume: held ?? s.volume,
      muted: held === null ? s.muted : held === 0,
      video: s.video,
      preferVideo: s.preferVideo,
      quality: s.quality,
      showingVideo: s.showingVideo,
      autoRadio: s.autoRadio,
      queue,
      index,
    });
    usePlayer.setState({ remote: view() });
    setRemoteControl(control);
    if (s.playing) ticker = window.setInterval(() => usePlayer.setState({ remote: view() }), 500);
  };

  /** Shown at once, before the device confirms (its next report puts things right). */
  const assume = (change: Partial<PlayState>) => {
    const s = target?.state;
    if (!target || !s) return;
    target = { ...target, state: { ...s, position: positionOf(s), at: Date.now(), ...change } };
    show();
  };

  const toTarget = (command: Command) => {
    if (target) send(target.id, command);
  };

  const control: RemoteControl = {
    play: () => {
      assume({ playing: true });
      toTarget({ action: "play" });
    },
    pause: () => {
      assume({ playing: false });
      toTarget({ action: "pause" });
    },
    next: () => toTarget({ action: "next" }),
    prev: () => toTarget({ action: "prev" }),
    seek: (position) => {
      assume({ position });
      toTarget({ action: "seek", position });
    },
    toggleShuffle: () => {
      assume({ shuffle: !target?.state?.shuffle });
      toTarget({ action: "shuffle" });
    },
    cycleRepeat: () => {
      const order: Repeat[] = ["off", "all", "one"];
      const now = target?.state?.repeat ?? "off";
      assume({ repeat: order[(order.indexOf(now) + 1) % order.length] });
      toTarget({ action: "repeat" });
    },
    playList: (tracks, start) => {
      const w = windowed(tracks, start);
      toTarget({ action: "playList", tracks: w.queue, start: w.index });
    },
    playTrack: (track) => toTarget({ action: "playTrack", track }),
    playNext: (track) => toTarget({ action: "playNext", track }),
    addToQueue: (track) => toTarget({ action: "addToQueue", track }),
    startRadio: (track) => toTarget({ action: "startRadio", track }),
    setVolume: (volume) => {
      volumeHeld = { volume, until: Date.now() + 1500 };
      assume({ volume, muted: volume === 0 });
      toTarget({ action: "volume", volume });
    },
    toggleMute: () => {
      const muted = !target?.state?.muted;
      volumeHeld = null;
      assume({ muted });
      toTarget({ action: "mute", muted });
    },
    setPreferVideo: (on) => {
      assume({ preferVideo: on });
      toTarget({ action: "preferVideo", on });
    },
    setQuality: (quality) => {
      assume({ quality });
      toTarget({ action: "quality", quality });
    },
    jumpTo: (i) => queueAction("jumpTo", i),
    removeAt: (i) => {
      queueAction("removeAt", i);
      // Gone at once here; the device's new queue follows.
      const known = target && queues.get(target.id);
      if (known && target) {
        queues.set(target.id, { ...known, tracks: known.tracks.filter((_, k) => k !== i) });
        show();
      }
    },
    clearUpcoming: () => toTarget({ action: "clearUpcoming" }),
    setAutoRadio: (on) => {
      assume({ autoRadio: on });
      toTarget({ action: "autoRadio", on });
    },
  };

  /** A track of the controlled device's queue, as shown here (by position there, and id should it have moved). */
  function queueAction(action: "jumpTo" | "removeAt", i: number) {
    const known = target && queues.get(target.id);
    const track = known?.tracks[i];
    if (known && track) toTarget({ action, index: known.offset + i, id: track.id });
  }

  // ---- Being controlled ----------------------------------------------------------------------------------------

  /** This device's queue goes to `to`, from where it is, and this one stops. */
  const handOver = (to: string) => {
    const s = usePlayer.getState();
    if (!s.queue.length || to === me) return;
    const w = windowed(s.queue, s.index);
    send(to, { action: "takeOver", queue: w.queue, index: w.index, position: s.position, shuffle: s.shuffle, repeat: s.repeat });
    s.pause();
  };

  /** A command from another device, on this device's own player. */
  const run = (c: Command) =>
    locally(() => {
      const p = usePlayer.getState();
      switch (c.action) {
        case "play":
          if (p.status !== "playing" && p.status !== "loading") p.toggle();
          break;
        case "pause":
          p.pause();
          break;
        case "next":
          p.next();
          break;
        case "prev":
          p.prev();
          break;
        case "seek":
          p.seek(c.position);
          break;
        case "shuffle":
          p.toggleShuffle();
          break;
        case "repeat":
          p.cycleRepeat();
          break;
        case "playList":
          p.playList(c.tracks, c.start);
          break;
        case "playTrack":
          p.playTrack(c.track);
          break;
        case "playNext":
          p.playNext(c.track);
          break;
        case "addToQueue":
          p.addToQueue(c.track);
          break;
        case "startRadio":
          void p.startRadio(c.track);
          break;
        case "takeOver":
          p.takeOver(c.queue, c.index, c.position, c.shuffle, c.repeat);
          break;
        case "handOver":
          handOver(c.to);
          break;
        case "volume":
          p.setVolume(c.volume);
          break;
        case "mute":
          if (p.muted !== c.muted) p.toggleMute();
          break;
        case "preferVideo":
          p.setPreferVideo(c.on);
          break;
        case "quality":
          p.setQuality(c.quality);
          break;
        case "autoRadio":
          p.setAutoRadio(c.on);
          break;
        case "jumpTo":
        case "removeAt": {
          // By position, unless the queue changed meanwhile: then by id.
          const i = p.queue[c.index]?.id === c.id ? c.index : p.queue.findIndex((t) => t.id === c.id);
          if (i >= 0) (c.action === "jumpTo" ? p.jumpTo : p.removeAt)(i);
          break;
        }
        case "clearUpcoming":
          p.clearUpcoming();
          break;
      }
    });

  // ---- Connection ----------------------------------------------------------------------------------------------

  const later = () => {
    window.clearTimeout(retry);
    if (!wanted) return;
    const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures++;
    retry = window.setTimeout(connect, wait);
  };

  const forget = () => {
    target = null;
    queues.clear();
    sentQueue = null;
    show();
  };

  /** Lets go of a device paused for too long (now, or when it gets there). */
  const stillFresh = () => {
    window.clearTimeout(staleTimer);
    const s = target?.state;
    if (s && !s.playing) {
      const left = STALE_MS - (Date.now() - s.at);
      if (left <= 0) target = null;
      else staleTimer = window.setTimeout(() => stillFresh(), left + 100);
    }
    show();
  };

  async function connect() {
    window.clearTimeout(retry);
    if (!wanted || !syncAddress || socket) return;
    set({ status: "connecting" });
    let address: string;
    try {
      address = await syncAddress();
    } catch (e) {
      // Signed out meanwhile: the app shows the sign-in screen (the request said so); anything else, try again.
      if ((e as { status?: number }).status === 401) return stop();
      return later();
    }
    if (!wanted || socket) return;
    const ws = new WebSocket(address);
    socket = ws;
    ws.onopen = () => {
      failures = 0;
      const state = current();
      sent = { key: keyOf(state), playing: state.playing, position: state.position, at: Date.now() };
      ws.send(JSON.stringify({ type: "hello", id: me, name, kind: isApp() ? "app" : "web", form, state }));
      reportQueue(true);
    };
    ws.onmessage = (e) => {
      let m: {
        type?: string;
        active?: string | null;
        devices?: (Omit<Device, "state"> & { state: (PlayState & { age: number }) | null })[];
        command?: Command;
        device?: string;
        queue?: Track[];
        offset?: number;
      };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === "devices" && Array.isArray(m.devices)) {
        const now = Date.now();
        const devices: Device[] = m.devices.map((d) => ({
          id: d.id,
          name: d.name,
          kind: d.kind,
          form: d.form,
          state: d.state && (({ age, ...rest }) => ({ ...rest, at: now - age }))(d.state),
        }));
        const active = m.active ?? null;
        set({ status: "on", active, devices });
        for (const id of queues.keys()) if (!devices.some((d) => d.id === id)) queues.delete(id);
        // Another device is the active one: this one shows it and controls it.
        target = (active !== me && devices.find((d) => d.id === active)) || null;
        stillFresh();
      } else if (m.type === "queue" && m.device && Array.isArray(m.queue)) {
        queues.set(m.device, { tracks: m.queue, offset: m.offset ?? 0 });
        if (target?.id === m.device) show();
      } else if (m.type === "pause") {
        usePlayer.getState().pause();
      } else if (m.type === "command" && m.command) {
        run(m.command);
      }
    };
    ws.onclose = (e) => {
      if (socket !== ws) return;
      socket = null;
      set({ status: wanted ? "connecting" : "off", devices: [], active: null });
      forget();
      if (e.code === REPLACED || e.code === FULL || e.code === PROTOCOL) return stop();
      if (e.code === SIGNED_OUT) {
        stop();
        void useAuth.getState().load();
        return;
      }
      later();
    };
  }

  function stop() {
    wanted = false;
    window.clearTimeout(retry);
    unsubscribe?.();
    unsubscribe = null;
    const ws = socket;
    socket = null;
    ws?.close(1000);
    set({ status: "off", devices: [], active: null });
    forget();
  }

  // Back online, or back to the app (a phone may have dropped the connection while asleep): reconnect now.
  const wake = () => {
    if (wanted && !socket && document.visibilityState === "visible") {
      failures = 0;
      void connect();
    }
  };
  addEventListener("online", wake);
  document.addEventListener("visibilitychange", wake);

  return {
    status: "off",
    me,
    active: null,
    devices: [],
    open: false,
    setOpen: (open) => set({ open }),

    start() {
      if (!syncAddress || wanted) return;
      wanted = true;
      failures = 0;
      unsubscribe = usePlayer.subscribe((s, prev) => {
        if (s.queue !== prev.queue || s.index !== prev.index) reportQueue();
        if (
          s.index !== prev.index ||
          s.queue !== prev.queue ||
          s.status !== prev.status ||
          s.position !== prev.position ||
          s.shuffle !== prev.shuffle ||
          s.repeat !== prev.repeat ||
          s.volume !== prev.volume ||
          s.muted !== prev.muted ||
          s.preferVideo !== prev.preferVideo ||
          s.quality !== prev.quality ||
          s.mediaKind !== prev.mediaKind ||
          s.autoRadio !== prev.autoRadio
        ) {
          report();
        }
      });
      void connect();
    },

    stop,

    transfer(to) {
      const { active } = get();
      const source = active ?? me;
      if (source === to) {
        // Already the device that plays (or played last): play there.
        if (to === me) locally(() => usePlayer.getState().status !== "playing" && usePlayer.getState().toggle());
        else send(to, { action: "play" });
        return;
      }
      // This device plays (or nothing does): its queue goes there. Otherwise the playing device hands it over.
      if (source === me) handOver(to);
      else send(source, { action: "handOver", to });
    },
  };
});

/** The device this one controls (the player shows it), if any. */
export function useControlled(): { id: string; name: string; playing: boolean } | null {
  const id = usePlayer((s) => s.remote?.device ?? null);
  const name = usePlayer((s) => s.remote?.name ?? "");
  const playing = usePlayer((s) => !!s.remote?.playing);
  return id ? { id, name, playing } : null;
}

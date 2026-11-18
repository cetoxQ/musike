import { create } from "zustand";
import { syncAddress } from "../lib/api";
import type { Track } from "../lib/types";
import { selectCurrent, usePlayer } from "../player/player";
import { useAuth } from "./auth";

// Devices of one account, Spotify-style (server/src/sync.ts): every open Musike (browser tab, phone) tells the
// server what it plays, sees what the others play, and only one plays at a time. Over https only (syncAddress).

export type DeviceForm = "computer" | "phone";

export interface PlayState {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
}

export interface Device {
  id: string;
  name: string;
  kind: "web" | "app";
  form: DeviceForm;
  /** With `at`: the local time it arrived, to tell where a playing track is now. */
  state: (PlayState & { at: number }) | null;
}

/** Closing codes from the server (sync.ts CLOSE). */
const REPLACED = 4001;
const FULL = 4002;
const PROTOCOL = 4003;
const SIGNED_OUT = 4401;

/** Waits before reconnecting, growing with each failure. */
const RETRY_MS = [1000, 2000, 5000, 10_000, 30_000];

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
  const browser = /Edg\//.test(ua)
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
}

export const useDevices = create<DevicesState>((set) => {
  const me = deviceId();
  const { name, form } = deviceName();
  let socket: WebSocket | null = null;
  let wanted = false;
  let failures = 0;
  let retry = 0;
  let unsubscribe: (() => void) | null = null;
  /** The last state sent, to send only what changed (and a seek). */
  let sent: { id: string | null; playing: boolean; position: number; at: number } | null = null;

  const post = (m: object) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
  };

  const report = (force = false) => {
    const state = current();
    const now = Date.now();
    const id = state.track?.id ?? null;
    if (!force && sent) {
      const expected = sent.playing ? sent.position + (now - sent.at) / 1000 : sent.position;
      const same = sent.id === id && sent.playing === state.playing && Math.abs(state.position - expected) < 2;
      if (same) return;
    }
    sent = { id, playing: state.playing, position: state.position, at: now };
    post({ type: "state", state });
  };

  const later = () => {
    window.clearTimeout(retry);
    if (!wanted) return;
    const wait = RETRY_MS[Math.min(failures, RETRY_MS.length - 1)];
    failures++;
    retry = window.setTimeout(connect, wait);
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
      sent = { id: state.track?.id ?? null, playing: state.playing, position: state.position, at: Date.now() };
      ws.send(JSON.stringify({ type: "hello", id: me, name, kind: isApp() ? "app" : "web", form, state }));
    };
    ws.onmessage = (e) => {
      let m: { type?: string; active?: string | null; devices?: (Omit<Device, "state"> & { state: (PlayState & { age: number }) | null })[] };
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === "devices" && Array.isArray(m.devices)) {
        const now = Date.now();
        set({
          status: "on",
          active: m.active ?? null,
          devices: m.devices.map((d) => ({
            id: d.id,
            name: d.name,
            kind: d.kind,
            form: d.form,
            state: d.state && { track: d.state.track, playing: d.state.playing, position: d.state.position, duration: d.state.duration, at: now - d.state.age },
          })),
        });
      } else if (m.type === "pause") {
        usePlayer.getState().pause();
      }
    };
    ws.onclose = (e) => {
      if (socket !== ws) return;
      socket = null;
      set({ status: wanted ? "connecting" : "off", devices: [], active: null });
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
        if (s.index !== prev.index || s.queue !== prev.queue || s.status !== prev.status || s.position !== prev.position) report();
      });
      void connect();
    },

    stop,
  };
});

/** Another device of the account is playing (not this one): what and where. */
export function useElsewhere(): Device | null {
  return useDevices((s) => {
    const d = s.devices.find((x) => x.id === s.active);
    return d && d.id !== s.me && d.state?.playing && d.state.track ? d : null;
  });
}

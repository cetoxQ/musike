import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { SystemMedia } from "../lib/apiTypes";

/**
 * Bridge to the app's Android side (MusikePlaybackPlugin.java): a foreground service with a media session,
 * so music keeps playing with the screen off and the notification, lock screen and headphone buttons work.
 */
interface PlaybackPlugin {
  update(options: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string;
    playing?: boolean;
    position?: number;
    duration?: number;
    /** The video's picture-only stream, for the car's screen (CarVideoScreen.java); a new track clears it. */
    video?: string;
  }): Promise<void>;
  /** Buttons pressed outside the app; and from Android Auto, "playItem" (value: the item's id) and "search". */
  addListener(event: "action", fn: (e: { action: string; position?: number; value?: string }) => void): Promise<PluginListenerHandle>;
  /** Android Auto asks what a folder holds (see native/car.ts); the answer goes back through browseResult. */
  addListener(event: "browse", fn: (e: { request: string; parent: string }) => void): Promise<PluginListenerHandle>;
  /** The car's own requests, kept until heard (the car may ask before the page starts): "open", "playItem", "search". */
  addListener(event: "car", fn: (e: { action: string; value?: string }) => void): Promise<PluginListenerHandle>;
  carInfo(): Promise<{ background: boolean; xiaomi: boolean; screenSupported: boolean; screenListed: boolean; log: string[] }>;
  openBackgroundSettings(): Promise<void>;
  browseResult(options: {
    request: string;
    items: { id: string; title: string; subtitle?: string; browsable?: boolean }[];
  }): Promise<void>;
}

const noop = async () => {};
export const Playback = registerPlugin<PlaybackPlugin>("MusikePlayback", {
  // In a desktop browser (development), there is nothing to drive.
  web: () => ({
    update: noop,
    addListener: async () => ({ remove: noop }),
    browseResult: noop,
    carInfo: async () => ({ background: false, xiaomi: false, screenSupported: false, screenListed: false, log: [] }),
    openBackgroundSettings: noop,
  }),
});

/**
 * Bridge to the app's iOS side (ios/App/App/MusikePlayback.swift). iOS has no Capacitor plugin here: the web view's
 * own message handler carries the now-playing info, and the lock screen's buttons come back as
 * window.__musikeMediaAction(), the same actions the Android plugin sends.
 */
interface MessageBridge {
  postMessage(message: unknown): void;
}

const iosBridge = (
  globalThis as { webkit?: { messageHandlers?: { musikeMedia?: MessageBridge } } }
).webkit?.messageHandlers?.musikeMedia;

// The system advances the position on its own while playing; only real changes need sending.
let last = { playing: false, position: 0, duration: 0, at: 0 };

/** Whether this state is news to the system: a real change (a new length too), not the clock moving. */
function worthSending(playing: boolean, position: number, duration: number): boolean {
  const now = Date.now();
  const expected = last.playing ? last.position + (now - last.at) / 1000 : last.position;
  const sameLength = Math.abs(duration - last.duration) < 1;
  if (playing === last.playing && sameLength && Math.abs(position - expected) < 2 && now - last.at < 15_000) return false;
  last = { playing, position, duration, at: now };
  return true;
}

const lengthOf = (duration: number | undefined) => (duration && Number.isFinite(duration) && duration > 0 ? duration : 0);

const androidMedia: SystemMedia = {
  setTrack(track) {
    last = { playing: last.playing, position: 0, duration: lengthOf(track.duration), at: Date.now() };
    void Playback.update({ ...track, duration: lengthOf(track.duration) || undefined, position: 0 });
  },
  setState({ playing, position, duration }) {
    // The media element's length once it knows; until then the track's own, already sent with it.
    const length = lengthOf(duration) || last.duration;
    if (!worthSending(playing, position, length)) return;
    void Playback.update({ playing, position, duration: length });
  },
  onAction(handler) {
    void Playback.addListener("action", (e) => handler(e.action as Parameters<typeof handler>[0], e.position));
  },
  setVideo(url) {
    void Playback.update({ video: url });
  },
};

const iosMedia: SystemMedia = {
  setTrack(track) {
    last = { playing: last.playing, position: 0, duration: lengthOf(track.duration), at: Date.now() };
    iosBridge?.postMessage({ type: "track", ...track, position: 0 });
  },
  setState({ playing, position, duration }) {
    const length = lengthOf(duration) || last.duration;
    if (!worthSending(playing, position, length)) return;
    iosBridge?.postMessage({ type: "state", playing, position, duration: length });
  },
  onAction(handler) {
    (globalThis as { __musikeMediaAction?: (action: string, position?: number) => void }).__musikeMediaAction = (
      action,
      position,
    ) => handler(action as Parameters<typeof handler>[0], position);
  },
};

export const media: SystemMedia = iosBridge ? iosMedia : androidMedia;

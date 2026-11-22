import { create } from "zustand";
import { getT, useT } from "../i18n";
import { api, capabilities, explainStreamError, link, streamSource, systemMedia, type ApiError, type ErrorCode } from "../lib/api";
import { createAudio } from "../lib/audio";
import { shuffled } from "../lib/format";
import type { Track } from "../lib/types";
import { useLibrary } from "../stores/library";
import { openSettings } from "../stores/system";
import { toast } from "../stores/ui";

export type Repeat = "off" | "all" | "one";
/** A code translated where it is shown (so switching languages updates it), or a server error already in the right language. */
export type StatusNote = "findingClip" | "preparingHd" | "loadingVideo" | "fetchingRadio" | { error: string };
export type Status = "idle" | "loading" | "playing" | "paused" | "error";
type Kind = "audio" | "video";
export type Quality = "sd" | "hd";

/**
 * Another device of the account plays, and this one shows it and controls it, Spotify-style (stores/devices.ts
 * keeps it up to date). The player's buttons and "play" anywhere in the app go there instead.
 */
export interface RemoteView {
  device: string;
  name: string;
  track: Track | null;
  playing: boolean;
  /** Where the track is now (kept moving while it plays). */
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  muted: boolean;
  /** It can play videos (the phone's own library can't). */
  video: boolean;
  preferVideo: boolean;
  quality: Quality;
  showingVideo: boolean;
  autoRadio: boolean;
  /** Its queue (up to 500 tracks around the current one) and the current track in it. */
  queue: Track[];
  index: number;
}

/** What the controlling device sends (see stores/devices.ts). */
export interface RemoteControl {
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  seek(seconds: number): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  playList(tracks: Track[], start: number): void;
  playTrack(track: Track): void;
  playNext(track: Track): void;
  addToQueue(track: Track): void;
  startRadio(track: Track): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  setPreferVideo(on: boolean): void;
  setQuality(quality: Quality): void;
  /** Positions in RemoteView.queue. */
  jumpTo(index: number): void;
  removeAt(index: number): void;
  clearUpcoming(): void;
  setAutoRadio(on: boolean): void;
}

let remoteControl: RemoteControl | null = null;
let localOnly = 0;

/** stores/devices.ts: where commands go while `remote` is set. */
export function setRemoteControl(control: RemoteControl | null) {
  remoteControl = control;
}

/** Runs `fn` on this device's own player, even while it controls another one: for commands from other devices. */
export function locally<T>(fn: () => T): T {
  localOnly++;
  try {
    return fn();
  } finally {
    localOnly--;
  }
}

interface PlayerState {
  /** Set while this device controls another one (see RemoteView). */
  remote: RemoteView | null;
  queue: Track[];
  /** Queue order before shuffle was turned on, restored when it is turned off. */
  original: Track[] | null;
  index: number;
  status: Status;
  /** What playback is busy with (or why it failed), shown instead of the artist. See `useStatusText`. */
  statusText: StatusNote | null;
  /** Which media element is driving playback right now. */
  mediaKind: Kind;
  /** Set when Video mode is on but the current song has no music video on YouTube. */
  videoNote: "noClip" | null;
  /** Intrinsic width/height of the current video, so vertical videos get a vertical stage. */
  videoAspect: number;
  position: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  preferVideo: boolean;
  quality: Quality;
  /** What the video plays in now: the chosen quality, or HD fetched because the video is shown big. */
  videoQuality: Quality;
  autoRadio: boolean;

  playList: (tracks: Track[], start?: number) => void;
  playTrack: (track: Track) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  removeAt: (i: number) => void;
  jumpTo: (i: number) => void;
  clearUpcoming: () => void;
  startRadio: (track: Track) => Promise<void>;
  toggle: () => void;
  /** Stops, without toggling: another device of the account took over. A track still loading won't start. */
  pause: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setPreferVideo: (on: boolean) => void;
  setQuality: (q: Quality) => void;
  setAutoRadio: (on: boolean) => void;
  /** Another device hands its playback over: its queue, from where it was, playing. */
  takeOver: (queue: Track[], index: number, position: number, shuffle: boolean, repeat: Repeat) => void;
}

// Media elements live outside React so playback survives any re-render or route change.
// On iOS this is the native player behind the same API (see lib/audio.ts).
const audio = createAudio();

export const videoEl = document.createElement("video");
videoEl.playsInline = true;
videoEl.preload = "auto";
videoEl.setAttribute("playsinline", "");
videoEl.className = "block h-full w-full object-contain bg-black";

const mediaFor = (k: Kind): HTMLMediaElement => (k === "video" ? videoEl : audio);

let loaded: { id: string; kind: Kind; quality: Quality } | null = null;
/**
 * A video shown big (cinema view, full screen, a wide window) while SD is chosen: its HD is fetched in the background
 * and takes over from where SD was. The choice stays SD, so the next video still starts fast.
 */
const hdFetched = new Set<string>();
/** Videos put back to SD by hand while shown big: not fetched in HD again. */
const sdKept = new Set<string>();
let shownBig = false;
let fetchingHd: string | null = null;
/** Wider than this on screen (CSS pixels), SD's 640x360 looks blurry. */
const BIG_PX = 720;
/** Told by the video's size on screen (see the observer after the store). */
let onShownBig: (big: boolean) => void = () => {};
let pendingSeek = 0;
let token = 0;
/** YouTube's bot check (see botCheck): until when video waits, the retries left for audio and their timer. */
let videoBlockedUntil = 0;
let botRetries = 0;
let botTimer: ReturnType<typeof setTimeout> | undefined;
const BOT_RETRY_MINUTES = [1, 3];
/** The load that has started playing (warming the next track, and telling a pause mid-buffering from one at start). */
let recordedToken = -1;

/** A play counts (history, play log) once it has really played this long, or half a shorter track: like Spotify. */
const PLAY_COUNTS_AFTER = 30;
/** The track being listened to, and for how long it has actually played (seeks don't count). */
let listening = { key: "", seconds: 0, last: -1, counted: false };

const STORAGE_KEY = "musike:player";

interface Saved {
  queue: Track[];
  original: Track[] | null;
  index: number;
  position: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  preferVideo: boolean;
  quality: Quality;
  autoRadio: boolean;
}

function readSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}

const saved = readSaved();

/**
 * Songs from YouTube Music are "art tracks": audio with a still cover. In Video mode we play the
 * song's music video instead. Song id → video id, or null when YouTube has no clip for it.
 */
const clipFor = new Map<string, string | null>();
const clipLookups = new Map<string, Promise<string | null>>();

function lookupClip(track: Track): Promise<string | null> {
  if (track.kind === "video") return Promise.resolve(track.id);
  if (clipFor.has(track.id)) return Promise.resolve(clipFor.get(track.id)!);
  let lookup = clipLookups.get(track.id);
  if (!lookup) {
    lookup = api
      .videoFor(track)
      .then(
        (v) => {
          const id = v?.id ?? null;
          clipFor.set(track.id, id);
          return id;
        },
        () => null, // network hiccup: don't remember it, try again next time
      )
      .finally(() => clipLookups.delete(track.id));
    clipLookups.set(track.id, lookup);
  }
  return lookup;
}

// Video mode only counts where video can play (a phone whose server is out of reach plays audio).
const needsClipLookup = (track: Track, preferVideo: boolean) =>
  preferVideo && capabilities.video && track.kind === "song" && !clipFor.has(track.id);

/** No progress for this long while it should play: treated like a stream error. */
const STALL_MS = 20_000;
/** Connected to a server, after this long the server is checked: gone, the stream comes from the phone at once. */
const STALL_CHECK_MS = 6000;

export const usePlayer = create<PlayerState>((set, get) => {
  /** Where an action goes instead of this device's player: the device being controlled, if any. */
  const elsewhere = () => (!localOnly && get().remote ? remoteControl : null);

  const kindFor = (track: Track): Kind =>
    capabilities.video &&
    get().preferVideo &&
    Date.now() > videoBlockedUntil &&
    (track.kind === "video" || !!clipFor.get(track.id))
      ? "video"
      : "audio";
  /** The YouTube id to stream: the song itself, or its music video in Video mode. */
  const mediaIdFor = (track: Track, kind: Kind) =>
    kind === "video" && track.kind !== "video" ? clipFor.get(track.id)! : track.id;
  /** The quality a video plays in: the chosen one, or HD where it was fetched for the big screen. */
  const qualityOf = (track: Track, kind: Kind): Quality =>
    get().quality === "hd" || (kind === "video" && hdFetched.has(mediaIdFor(track, kind))) ? "hd" : "sd";
  const noteFor = (track: Track) =>
    get().preferVideo && capabilities.video && track.kind === "song" && clipFor.get(track.id) === null
      ? ("noClip" as const)
      : null;
  const activeMedia = (): HTMLMediaElement | null => (loaded ? mediaFor(loaded.kind) : null);

  function play(media: HTMLMediaElement) {
    media.play().catch((err: DOMException) => {
      if (err.name === "AbortError") return; // src changed mid-start
      if (err.name === "NotAllowedError") set({ status: "paused" }); // autoplay blocked
    });
  }

  function load(index: number, opts: { autoplay?: boolean; startAt?: number } = {}) {
    const s = get();
    const track = s.queue[index];
    if (!track) return;

    // Video mode on a song: find its music video first, then load whichever fits.
    if (needsClipLookup(track, s.preferVideo)) {
      const mine = ++token;
      set({
        index,
        status: "loading",
        statusText: "findingClip",
        videoNote: null,
        position: opts.startAt ?? 0,
        duration: track.duration,
        buffered: 0,
      });
      activeMedia()?.pause();
      setMetadata(track);
      void lookupClip(track).then(() => mine === token && load(index, opts));
      return;
    }

    const kind = kindFor(track);
    const media = mediaFor(kind);
    const other = mediaFor(kind === "video" ? "audio" : "video");
    other.pause();
    if (other.getAttribute("src")) {
      other.removeAttribute("src");
      other.load();
    }

    token++;
    const quality = qualityOf(track, kind);
    loaded = { id: track.id, kind, quality };
    pendingSeek = opts.startAt ?? 0;
    // The same track again from where it was (a retry, Audio/Video switched): the same play. Anything else is a new one.
    const key = `${index}:${track.id}`;
    if (key !== listening.key || !(pendingSeek > 0)) listening = { key, seconds: 0, last: -1, counted: false };
    const autoplay = opts.autoplay !== false;
    set({
      index,
      mediaKind: kind,
      status: autoplay ? "loading" : "paused",
      // Video may need a server-side download first (HD, or videos without a combined SD stream).
      statusText: kind === "video" ? (quality === "hd" ? "preparingHd" : "loadingVideo") : null,
      videoQuality: quality,
      videoNote: noteFor(track),
      position: pendingSeek,
      duration: track.duration,
      buffered: 0,
    });
    media.volume = s.volume;
    media.muted = s.muted;
    const start = (src: string) => {
      media.src = src;
      lastProgress = Date.now();
      if (autoplay) play(media);
    };
    // The server's proxy URL is known right away; on Android the stream is first resolved on the phone.
    const source = streamSource(mediaIdFor(track, kind), kind, quality);
    if (typeof source === "string") start(source);
    else {
      const mine = token;
      source.then(
        (src) => mine === token && start(src),
        (err: ApiError) => mine === token && report(err.message, err.code),
      );
    }
    setMetadata(track);
    if (kind === "video" && quality === "sd") upgradeIfBig();
  }

  /** Shown big with SD playing: HD downloads in the background, then plays from where SD is. */
  function upgradeIfBig() {
    const s = get();
    const track = s.queue[s.index];
    if (!shownBig || !track || elsewhere() || loaded?.id !== track.id || loaded.kind !== "video" || loaded.quality === "hd") return;
    const id = mediaIdFor(track, "video");
    if (fetchingHd === id || sdKept.has(id)) return;
    fetchingHd = id;
    api
      .prepareHd(id)
      .then(() => {
        hdFetched.add(id);
        const now = get();
        if (now.queue[now.index]?.id !== track.id || loaded?.id !== track.id || loaded.kind !== "video" || loaded.quality === "hd") return;
        load(now.index, { startAt: now.position, autoplay: now.status === "playing" || now.status === "loading" });
      })
      .catch(() => {}) // HD didn't come: SD goes on
      .finally(() => {
        if (fetchingHd === id) fetchingHd = null;
      });
  }
  onShownBig = (big) => {
    shownBig = big;
    if (big) upgradeIfBig();
  };

  async function continueWithRadio() {
    const s = get();
    const last = s.queue[s.index];
    if (!last) return;
    set({ status: "loading", statusText: "fetchingRadio" });
    const mine = token;
    try {
      const known = new Set(get().queue.map((t) => t.id));
      const more = (await api.radio(last.id)).filter((t) => !known.has(t.id)).slice(0, 25);
      if (mine !== token) return; // paused (or another track started) meanwhile
      if (!more.length) throw new Error("empty");
      set((st) => ({
        queue: [...st.queue, ...more],
        original: st.original ? [...st.original, ...more] : null,
      }));
      toast(getT().player.radioContinuing(last.title));
      load(get().index + 1);
    } catch {
      if (mine !== token) return;
      set({ status: "paused", statusText: null, position: 0 });
    }
  }

  /** Warms up the next track (and, in Video mode, finds and resolves its clip) so it starts quickly. */
  function warmUpcoming() {
    const s = get();
    const upcoming = s.queue[s.index + 1];
    if (!upcoming) return;
    if (s.preferVideo) void lookupClip(upcoming).then((id) => api.prepare(id ?? upcoming.id).catch(() => {}));
    else api.prepare(upcoming.id).catch(() => {});
  }

  function onStarted() {
    const s = get();
    const track = s.queue[s.index];
    if (!track || recordedToken === token) return;
    recordedToken = token;
    warmUpcoming();
  }

  /** Playing on: the time it really played adds up, and past the threshold the play is recorded, once. */
  function listened(media: HTMLMediaElement) {
    const now = media.currentTime;
    const step = now - listening.last;
    listening.last = now;
    if (listening.counted || media.paused || !(step > 0 && step < 1.5)) return;
    listening.seconds += step;
    const s = get();
    const track = s.queue[s.index];
    if (!track || listening.key !== `${s.index}:${track.id}`) return;
    const length = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : track.duration;
    if (listening.seconds < (length > 0 ? Math.min(PLAY_COUNTS_AFTER, length / 2) : PLAY_COUNTS_AFTER)) return;
    listening.counted = true;
    useLibrary.getState().recordPlay(track);
  }

  function onEnded() {
    const s = get();
    if (s.repeat === "one") {
      const media = activeMedia();
      if (media) {
        media.currentTime = 0;
        play(media);
      }
      return;
    }
    if (s.index < s.queue.length - 1) return load(s.index + 1);
    if (s.repeat === "all" && s.queue.length) return load(0);
    if (s.autoRadio) return void continueWithRadio();
    set({ status: "paused", position: 0 });
  }

  /** Shows why a track can't play, then moves on (unless every track would fail the same way). */
  function report(message: string, code?: ErrorCode) {
    if (code === "bot_check") return botCheck(message);
    const mine = token;
    set({ status: "error", statusText: { error: message } });
    const track = get().queue[get().index];
    // Tool problems hit every track: offer the fix instead of skipping through the whole queue.
    const toolProblem = code === "tool_missing" || code === "maybe_outdated";
    const t = getT();
    toast(
      t.player.cantPlay(track?.title ?? t.player.aTrack, message),
      "error",
      toolProblem ? { label: code === "tool_missing" ? t.common.install : t.common.update, run: openSettings } : undefined,
    );
    if (code !== "tool_missing" && get().index < get().queue.length - 1) {
      setTimeout(() => mine === token && get().next(), 2500);
    }
  }

  /**
   * YouTube asking this connection to prove it's not a bot. Every track would hit it, and each new try makes it stick,
   * so never skip through the queue. Video (the server's yt-dlp) waits 10 minutes and the song plays as audio, which
   * comes another way and usually still works. Audio stops on this track and tries it again in 1, then 3 minutes.
   */
  function botCheck(message: string) {
    const t = getT();
    const s = get();
    if (s.mediaKind === "video") {
      videoBlockedUntil = Date.now() + 10 * 60_000;
      toast(t.player.videoBotCheck);
      return load(s.index, { startAt: s.position, autoplay: true });
    }
    const mine = token;
    const wait = BOT_RETRY_MINUTES[botRetries];
    set({ status: "error", statusText: { error: wait ? `${message} ${t.player.botRetry(wait)}` : message } });
    const track = s.queue[s.index];
    toast(t.player.cantPlay(track?.title ?? t.player.aTrack, message), "error", {
      label: t.common.retry,
      run: () => load(get().index, { autoplay: true }),
    });
    clearTimeout(botTimer);
    if (!wait) return;
    botRetries++;
    botTimer = setTimeout(() => mine === token && load(get().index, { autoplay: true }), wait * 60_000);
  }

  // A stream URL that expired mid-song gets one fresh try from the same spot before giving up.
  let retriedToken = -1;
  /** When the playing stream last moved (see the stall check below). */
  let lastProgress = Date.now();

  function onError(media: HTMLMediaElement) {
    const mine = token;
    const url = media.currentSrc || media.src;
    if (capabilities.retryOnError && retriedToken !== mine) {
      const at = media.currentTime || get().position;
      load(get().index, { startAt: at, autoplay: true });
      retriedToken = token;
      return;
    }
    set({ status: "error" });
    explainStreamError(url, media.error).then(({ message, code }) => {
      if (mine === token) report(message, code);
    });
  }

  function wire(media: HTMLMediaElement) {
    const isActive = () => activeMedia() === media;
    media.addEventListener("loadedmetadata", () => {
      if (!isActive()) return;
      if (pendingSeek > 0) {
        media.currentTime = pendingSeek;
        pendingSeek = 0;
      }
      if (Number.isFinite(media.duration)) set({ duration: media.duration });
      if (media === videoEl && videoEl.videoWidth && videoEl.videoHeight) {
        set({ videoAspect: videoEl.videoWidth / videoEl.videoHeight });
      }
      syncPositionState();
    });
    media.addEventListener("durationchange", () => {
      if (isActive() && Number.isFinite(media.duration)) set({ duration: media.duration });
    });
    media.addEventListener("playing", () => {
      if (!isActive()) return;
      botRetries = 0;
      set({ status: "playing", statusText: null });
      onStarted();
      syncPlaybackState();
    });
    media.addEventListener("pause", () => {
      if (!isActive() || media.ended || get().status === "loading" || get().status === "error") return;
      set({ status: "paused" });
      syncPlaybackState();
    });
    media.addEventListener("waiting", () => {
      if (isActive() && !media.paused) set({ status: "loading" });
    });
    media.addEventListener("timeupdate", () => {
      if (!isActive()) return;
      lastProgress = Date.now();
      if (pendingSeek > 0) return;
      listened(media);
      if (Math.abs(media.currentTime - get().position) >= 0.2) set({ position: media.currentTime });
      syncSystemMedia(); // throttled on the other side
    });
    media.addEventListener("progress", () => {
      if (!isActive() || !media.buffered.length) return;
      set({ buffered: media.buffered.end(media.buffered.length - 1) });
    });
    media.addEventListener("seeked", () => isActive() && syncPositionState());
    media.addEventListener("ended", () => isActive() && onEnded());
    media.addEventListener("error", () => isActive() && media.getAttribute("src") && onError(media));
  }
  wire(audio);
  wire(videoEl);

  // A stream that stops arriving (the network gone, a server that stopped answering) doesn't always end in an
  // error: the player would wait forever, looking alive. No progress for a while is treated as one, so it's tried
  // again (from the phone itself when the server is out of reach).
  let checkedStall = 0;
  setInterval(() => {
    const media = activeMedia();
    const s = get();
    if (!media || s.remote || s.status !== "loading" || media.paused || !media.src) return;
    const stuck = Date.now() - lastProgress;
    if (link?.online && stuck >= STALL_CHECK_MS && checkedStall !== lastProgress) {
      const at = (checkedStall = lastProgress);
      void link.check().then((ok) => {
        if (ok || lastProgress !== at || activeMedia() !== media || get().status !== "loading") return;
        lastProgress = Date.now();
        onError(media);
      });
    }
    if (stuck < STALL_MS) return;
    lastProgress = Date.now();
    onError(media);
  }, 2000);

  const reloadIfKindChanged = () => {
    const s = get();
    const track = s.queue[s.index];
    if (!track) return;
    set({ videoNote: noteFor(track) });
    if (!loaded || loaded.id !== track.id) return;
    const wasPlaying = s.status === "playing" || s.status === "loading";
    if (needsClipLookup(track, s.preferVideo)) return load(s.index, { startAt: s.position, autoplay: wasPlaying });
    const kind = kindFor(track);
    if (loaded.kind === kind && (kind === "audio" || loaded.quality === qualityOf(track, kind))) return;
    load(s.index, { startAt: s.position, autoplay: wasPlaying });
  };

  return {
    queue: saved.queue ?? [],
    original: saved.original ?? null,
    index: saved.index ?? 0,
    status: saved.queue?.length ? "paused" : "idle",
    remote: null,
    statusText: null,
    mediaKind: "audio",
    videoNote: null,
    videoAspect: 16 / 9,
    position: saved.position ?? 0,
    duration: saved.queue?.[saved.index ?? 0]?.duration ?? 0,
    buffered: 0,
    volume: saved.volume ?? 0.9,
    muted: saved.muted ?? false,
    shuffle: saved.shuffle ?? false,
    repeat: saved.repeat ?? "off",
    // Builds without video (Android) always play audio, whatever a backup or an old session says.
    preferVideo: capabilities.video && (saved.preferVideo ?? false),
    quality: saved.quality ?? "sd",
    videoQuality: saved.quality ?? "sd",
    autoRadio: saved.autoRadio ?? true,

    playList: (tracks, start = 0) => {
      if (!tracks.length) return;
      const r = elsewhere();
      if (r) return r.playList(tracks, start);
      const first = tracks[start] ?? tracks[0];
      if (get().shuffle) {
        const rest = tracks.filter((_, i) => i !== start);
        set({ queue: [first, ...shuffled(rest)], original: tracks.slice() });
        load(0);
      } else {
        set({ queue: tracks.slice(), original: null });
        load(start);
      }
    },

    playTrack: (track) => {
      const r = elsewhere();
      if (r) return r.playTrack(track);
      const s = get();
      const at = s.queue.findIndex((t) => t.id === track.id);
      if (at >= 0) return load(at);
      if (!s.queue.length) return get().playList([track]);
      const insert = s.index + 1;
      set({
        queue: [...s.queue.slice(0, insert), track, ...s.queue.slice(insert)],
        original: s.original ? [...s.original, track] : null,
      });
      load(insert);
    },

    playNext: (track) => {
      const r = elsewhere();
      if (r) {
        r.playNext(track);
        return toast(getT().player.playsNext(track.title));
      }
      const s = get();
      if (!s.queue.length) return get().playList([track]);
      const insert = s.index + 1;
      set({
        queue: [...s.queue.slice(0, insert), track, ...s.queue.slice(insert)],
        original: s.original ? [...s.original, track] : null,
      });
      toast(getT().player.playsNext(track.title));
    },

    addToQueue: (track) => {
      const r = elsewhere();
      if (r) {
        r.addToQueue(track);
        return toast(getT().player.addedToQueue(track.title));
      }
      const s = get();
      if (!s.queue.length) return get().playList([track]);
      set({ queue: [...s.queue, track], original: s.original ? [...s.original, track] : null });
      toast(getT().player.addedToQueue(track.title));
    },

    removeAt: (i) => {
      const r = elsewhere();
      if (r) return r.removeAt(i);
      const s = get();
      if (i < 0 || i >= s.queue.length) return;
      const removed = s.queue[i];
      const queue = s.queue.filter((_, j) => j !== i);
      const original = s.original?.filter((t) => t !== removed) ?? null;
      if (i < s.index) return set({ queue, original, index: s.index - 1 });
      if (i > s.index) return set({ queue, original });
      // Removing the current track: move on to whatever takes its place.
      set({ queue, original });
      if (queue[i]) load(i, { autoplay: s.status === "playing" });
      else {
        activeMedia()?.pause();
        loaded = null;
        set({ index: Math.max(0, queue.length - 1), status: queue.length ? "paused" : "idle", position: 0 });
      }
    },

    jumpTo: (i) => {
      const r = elsewhere();
      if (r) return r.jumpTo(i);
      load(i);
    },

    clearUpcoming: () => {
      const r = elsewhere();
      if (r) return r.clearUpcoming();
      const s = get();
      const keep = s.queue.slice(0, s.index + 1);
      set({ queue: keep, original: s.original ? keep.slice() : null });
    },

    startRadio: async (track) => {
      toast(getT().player.startingRadio(track.title));
      const r = elsewhere();
      if (r) return r.startRadio(track);
      try {
        const related = (await api.radio(track.id)).filter((t) => t.id !== track.id);
        const s = get();
        const current = s.queue[s.index];
        // Radio from the track that is on: it keeps going, uninterrupted, and the radio follows it.
        if (current?.id === track.id && s.status !== "idle" && s.status !== "error") {
          set({
            queue: [current, ...(s.shuffle ? shuffled(related) : related)],
            original: s.shuffle ? [current, ...related] : null,
            index: 0,
          });
          warmUpcoming();
          return;
        }
        get().playList([track, ...related], 0);
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },

    toggle: () => {
      const r = elsewhere();
      if (r) return get().remote!.playing ? r.pause() : r.play();
      const s = get();
      const track = s.queue[s.index];
      if (!track) return;
      // The spinner is a stop button: a track stuck loading (YouTube holding it back) can be let go.
      if (s.status === "loading") return get().pause();
      const kind = kindFor(track);
      const stale =
        !loaded ||
        loaded.id !== track.id ||
        loaded.kind !== kind ||
        (kind === "video" && loaded.quality !== qualityOf(track, kind)) ||
        needsClipLookup(track, s.preferVideo);
      if (stale || s.status === "error") return load(s.index, { startAt: s.position });
      const media = mediaFor(kind);
      if (media.paused) play(media);
      else media.pause();
    },

    pause: () => {
      const s = get();
      if (s.status !== "playing" && s.status !== "loading") return;
      if (s.status === "loading") {
        // Whatever is on its way (a stream, a music video lookup, more radio) must not start playing when it arrives.
        const started = recordedToken === token;
        token++;
        // Buffering mid-track: already counted as a play, resuming mustn't count it again. Still starting: the next
        // Play loads the track again, from here.
        if (started) recordedToken = token;
        else {
          loaded = null;
          // Drop the request too, so the server stops waiting on YouTube for it.
          for (const media of [audio, videoEl]) {
            media.removeAttribute("src");
            media.load();
          }
        }
      }
      audio.pause();
      videoEl.pause();
      set({ status: "paused", statusText: null });
      syncPlaybackState();
    },

    next: () => {
      const r = elsewhere();
      if (r) return r.next();
      const s = get();
      if (s.index < s.queue.length - 1) return load(s.index + 1);
      if (s.repeat === "all" && s.queue.length) return load(0);
      if (s.autoRadio) void continueWithRadio();
    },

    prev: () => {
      const r = elsewhere();
      if (r) return r.prev();
      const s = get();
      if (s.position > 3 || s.index === 0) return get().seek(0);
      load(s.index - 1);
    },

    seek: (seconds) => {
      const r = elsewhere();
      if (r) {
        const remote = get().remote!;
        const at = Math.max(0, Math.min(seconds, remote.duration || seconds));
        set({ remote: { ...remote, position: at } });
        return r.seek(at);
      }
      const t = Math.max(0, Math.min(seconds, get().duration || seconds));
      set({ position: t });
      const media = activeMedia();
      const track = get().queue[get().index];
      if (!media || !track || loaded?.id !== track.id || media.readyState === 0) {
        pendingSeek = t;
        return;
      }
      media.currentTime = t;
    },

    setVolume: (v) => {
      const r = elsewhere();
      if (r) return r.setVolume(Math.max(0, Math.min(1, v)));
      const volume = Math.max(0, Math.min(1, v));
      audio.volume = videoEl.volume = volume;
      const muted = volume === 0 ? true : false;
      audio.muted = videoEl.muted = muted;
      set({ volume, muted });
    },

    toggleMute: () => {
      const r = elsewhere();
      if (r) return r.toggleMute();
      const muted = !get().muted;
      audio.muted = videoEl.muted = muted;
      if (!muted && get().volume === 0) get().setVolume(0.6);
      else set({ muted });
    },

    toggleShuffle: () => {
      const r = elsewhere();
      if (r) return r.toggleShuffle();
      const s = get();
      const current = s.queue[s.index];
      if (!s.shuffle) {
        const rest = s.queue.filter((_, i) => i !== s.index);
        set({ shuffle: true, original: s.queue, queue: current ? [current, ...shuffled(rest)] : shuffled(rest), index: 0 });
        return;
      }
      const present = new Set(s.queue);
      const base = (s.original ?? s.queue).filter((t) => present.has(t));
      const extra = s.queue.filter((t) => !base.includes(t));
      const queue = [...base, ...extra];
      set({ shuffle: false, original: null, queue, index: Math.max(0, current ? queue.indexOf(current) : 0) });
    },

    cycleRepeat: () => {
      const r = elsewhere();
      if (r) return r.cycleRepeat();
      const order: Repeat[] = ["off", "all", "one"];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
    },

    setPreferVideo: (on) => {
      const r = elsewhere();
      if (r) return r.setPreferVideo(on);
      if (on && !capabilities.video) return;
      set({ preferVideo: on });
      reloadIfKindChanged();
    },

    setQuality: (quality) => {
      const r = elsewhere();
      if (r) return r.setQuality(quality);
      // The badge shows what plays: SD chosen on a video shown in HD keeps that video in SD.
      const track = get().queue[get().index];
      const id = track && loaded?.id === track.id && loaded.kind === "video" ? mediaIdFor(track, "video") : null;
      if (id && quality === "sd") {
        hdFetched.delete(id);
        sdKept.add(id);
      } else if (id) sdKept.delete(id);
      set({ quality });
      reloadIfKindChanged();
    },

    setAutoRadio: (autoRadio) => {
      const r = elsewhere();
      if (r) return r.setAutoRadio(autoRadio);
      set({ autoRadio });
    },

    takeOver: (queue, index, position, shuffle, repeat) => {
      if (!queue.length) return;
      const at = Math.min(Math.max(index, 0), queue.length - 1);
      // The order comes as the other device had it (shuffled or not); turning shuffle off here keeps it.
      set({ queue: queue.slice(), original: null, shuffle, repeat });
      load(at, { startAt: position });
    },
  };
});

// The video's size on screen decides when SD isn't enough (see hdFetched), once a resize has settled: an animation
// passing through a big size doesn't count.
if (typeof ResizeObserver !== "undefined") {
  let settle: ReturnType<typeof setTimeout> | undefined;
  new ResizeObserver(() => {
    clearTimeout(settle);
    settle = setTimeout(() => onShownBig(videoEl.clientWidth > BIG_PX), 800);
  }).observe(videoEl);
}

audio.volume = videoEl.volume = usePlayer.getState().volume;
audio.muted = videoEl.muted = usePlayer.getState().muted;

export const selectCurrent = (s: PlayerState): Track | null => s.queue[s.index] ?? null;

// What the player shows: this device's playback, or the one of the device it controls (`remote`).
export const selectShown = (s: PlayerState): Track | null => (s.remote ? s.remote.track : selectCurrent(s));
export const selectShownStatus = (s: PlayerState): Status => (s.remote ? (s.remote.playing ? "playing" : "paused") : s.status);
export const selectShownPosition = (s: PlayerState) => (s.remote ? s.remote.position : s.position);
export const selectShownDuration = (s: PlayerState) => (s.remote ? s.remote.duration : s.duration);
export const selectHasShown = (s: PlayerState) => (s.remote ? !!s.remote.track : s.queue.length > 0);
export const selectShownQueue = (s: PlayerState) => (s.remote ? s.remote.queue : s.queue);
export const selectShownIndex = (s: PlayerState) => (s.remote ? s.remote.index : s.index);

/** Whether the track can be shown as video (art tracks are audio with a still image). */

// Persistence: resume the same queue and position after a reload.

function persist() {
  const s = usePlayer.getState();
  const data: Saved = {
    queue: s.queue.slice(0, 500),
    original: s.original?.slice(0, 500) ?? null,
    index: s.index,
    position: s.position,
    volume: s.volume,
    muted: s.muted,
    shuffle: s.shuffle,
    repeat: s.repeat,
    preferVideo: s.preferVideo,
    quality: s.quality,
    autoRadio: s.autoRadio,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked */
  }
}
setInterval(persist, 4000);
addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && persist());

// Media Session: lock-screen, headset and notification controls.

function setMetadata(track: Track) {
  systemMedia?.setTrack({
    title: track.title,
    artist: track.artist,
    album: track.album ?? "",
    artwork: track.art || track.thumb,
    duration: track.duration || undefined,
  });
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? "",
    artwork:
      track.kind === "video"
        ? [
            { src: track.art, sizes: "1280x720", type: "image/jpeg" },
            { src: track.thumb, sizes: "320x180", type: "image/jpeg" },
          ]
        : [{ src: track.art, sizes: "544x544", type: "image/jpeg" }],
  });
}

/** The phone's notification and lock screen. A track that is loading is about to play, so it counts as playing:
 *  reporting a pause between tracks would let Android stop the app in the background. */
function syncSystemMedia() {
  if (!systemMedia) return;
  const { status, position, duration } = usePlayer.getState();
  systemMedia.setState({ playing: status === "playing" || status === "loading", position, duration });
}

function syncPlaybackState() {
  syncSystemMedia();
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = usePlayer.getState().status === "playing" ? "playing" : "paused";
  syncPositionState();
}

function syncPositionState() {
  syncSystemMedia();
  const { duration, position } = usePlayer.getState();
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
  } catch {
    /* some browsers reject transient states */
  }
}

if (systemMedia) {
  const p = () => usePlayer.getState();
  // The notification, the lock screen and headphone or car buttons show and drive this device's own player, even
  // while it controls another device.
  systemMedia.onAction((action, position) =>
    locally(() => {
      if (action === "play" && p().status !== "playing") p().toggle();
      else if (action === "pause" && p().status === "playing") p().toggle();
      else if (action === "next") p().next();
      else if (action === "previous") p().prev();
      else if (action === "seek" && position != null) p().seek(position);
    }),
  );
}

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const p = () => usePlayer.getState();
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => p().status !== "playing" && p().toggle()],
    ["pause", () => p().status === "playing" && p().toggle()],
    ["previoustrack", () => p().prev()],
    ["nexttrack", () => p().next()],
    ["seekto", (d) => d.seekTime != null && p().seek(d.seekTime)],
    ["seekbackward", (d) => p().seek(p().position - (d.seekOffset ?? 10))],
    ["seekforward", (d) => p().seek(p().position + (d.seekOffset ?? 10))],
  ];
  for (const [action, handler] of handlers) {
    try {
      // Media keys and the browser's controls show this device's player: they drive it, not a device it controls.
      ms.setActionHandler(action, (d) => locally(() => handler(d)));
    } catch {
      /* action not supported */
    }
  }
  const restored = selectCurrent(usePlayer.getState());
  if (restored) setMetadata(restored);
}

/** The player's status line in the current language, or null when there is nothing to say. */
export function useStatusText(): string | null {
  // This device's loading notes and errors don't describe the device it controls.
  const note = usePlayer((s) => (s.remote ? null : s.statusText));
  const t = useT();
  if (note === null) return null;
  return typeof note === "string" ? t.player.status[note] : note.error;
}

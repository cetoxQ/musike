import {
  HeartIcon,
  MusicNotesIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SpeakerHighIcon,
  SpeakerLowIcon,
  SpeakerXIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { useT } from "../i18n";
import { capabilities, link } from "../lib/api";
import { cn, formatTime } from "../lib/format";
import type { Track } from "../lib/types";
import { selectHasShown, selectShownDuration, selectShownPosition, selectShownStatus, usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { IconButton, PlayDisc } from "./IconButton";
import { Slider } from "./Slider";

export function PlayPauseIcon({ size = 22 }: { size?: number }) {
  const status = usePlayer(selectShownStatus);
  if (status === "loading") {
    return (
      <span className="relative block size-[18px]" aria-hidden="true">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span className="absolute inset-0 m-auto size-1.5 rounded-[1px] bg-current opacity-0 transition-opacity group-hover/play:opacity-100 group-focus-visible/play:opacity-100 [@media(hover:none)]:opacity-100" />
      </span>
    );
  }
  return status === "playing" ? <PauseIcon size={size} weight="fill" /> : <PlayIcon size={size} weight="fill" />;
}

export function Transport({ big = false }: { big?: boolean }) {
  const t = useT();
  const p = usePlayer(
    useShallow((s) => ({
      // This device's player, or the device it controls.
      hasQueue: selectHasShown(s),
      status: selectShownStatus(s),
      shuffle: s.remote ? s.remote.shuffle : s.shuffle,
      repeat: s.remote ? s.remote.repeat : s.repeat,
      toggle: s.toggle,
      prev: s.prev,
      next: s.next,
      toggleShuffle: s.toggleShuffle,
      cycleRepeat: s.cycleRepeat,
    })),
  );
  const hasTrack = p.hasQueue;
  const RepeatGlyph = p.repeat === "one" ? RepeatOnceIcon : RepeatIcon;
  const repeatLabel = { off: t.player.repeatOff, all: t.player.repeatAll, one: t.player.repeatOne }[p.repeat];
  const iconSize = big ? 26 : 19;

  return (
    <div className={cn("flex items-center", big ? "justify-between" : "gap-2")}>
      <IconButton
        label={p.shuffle ? t.player.shuffleOn : t.player.shuffleOff}
        active={p.shuffle}
        size={big ? "lg" : "sm"}
        onClick={p.toggleShuffle}
        disabled={!hasTrack}
      >
        <ShuffleIcon size={big ? 22 : 17} />
        {p.shuffle && <span className="absolute bottom-0.5 size-1 rounded-full bg-accent-text" />}
      </IconButton>
      <IconButton label={t.player.previous} size={big ? "lg" : "md"} onClick={p.prev} disabled={!hasTrack} className="text-fg">
        <SkipBackIcon size={iconSize} weight="fill" />
      </IconButton>
      <PlayDisc
        label={p.status === "loading" ? t.common.stopLoading : p.status === "playing" ? t.common.pause : t.common.play}
        className="group/play"
        px={big ? 72 : 40}
        onClick={p.toggle}
        disabled={!hasTrack}
      >
        <PlayPauseIcon size={big ? 30 : 20} />
      </PlayDisc>
      <IconButton label={t.player.next} size={big ? "lg" : "md"} onClick={p.next} disabled={!hasTrack} className="text-fg">
        <SkipForwardIcon size={iconSize} weight="fill" />
      </IconButton>
      <IconButton
        label={repeatLabel}
        active={p.repeat !== "off"}
        size={big ? "lg" : "sm"}
        onClick={p.cycleRepeat}
        disabled={!hasTrack}
      >
        <RepeatGlyph size={big ? 22 : 17} />
        {p.repeat !== "off" && <span className="absolute bottom-0.5 size-1 rounded-full bg-accent-text" />}
      </IconButton>
    </div>
  );
}

export function Scrubber({ touch = false, className }: { touch?: boolean; className?: string }) {
  const t = useT();
  const position = usePlayer(selectShownPosition);
  const duration = usePlayer(selectShownDuration);
  const buffered = usePlayer((s) => (s.remote ? 0 : s.buffered));
  const seek = usePlayer((s) => s.seek);
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? position;

  const time = <span className="w-10 shrink-0 font-mono text-[11px] text-fg-3 tabular-nums">{formatTime(shown)}</span>;
  const total = <span className="w-10 shrink-0 text-right font-mono text-[11px] text-fg-3 tabular-nums">{formatTime(duration)}</span>;

  if (touch) {
    return (
      <div className={className}>
        <Slider label={t.player.progress} value={position} max={duration} buffered={buffered} onChange={seek} onScrub={setScrub} showThumb step={5} valueText={formatTime} />
        <div className="mt-0.5 flex justify-between">
          {time}
          {total}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-right">{time}</span>
      <Slider label={t.player.progress} value={position} max={duration} buffered={buffered} onChange={seek} onScrub={setScrub} step={5} valueText={formatTime} className="flex-1" />
      {total}
    </div>
  );
}

/** `wide`: the slider takes the room there is (the phone's Now Playing, controlling another device). */
export function Volume({ className, wide = false }: { className?: string; wide?: boolean }) {
  const t = useT();
  // This device's volume, or the one of the device it controls.
  const volume = usePlayer((s) => s.remote?.volume ?? s.volume);
  const muted = usePlayer((s) => s.remote?.muted ?? s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const level = muted ? 0 : volume;
  const Glyph = level === 0 ? SpeakerXIcon : level < 0.5 ? SpeakerLowIcon : SpeakerHighIcon;
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <IconButton label={muted ? t.player.unmute : t.player.mute} size="sm" onClick={toggleMute}>
        <Glyph size={18} />
      </IconButton>
      <Slider
        label={t.player.volume}
        value={level}
        max={1}
        step={0.05}
        live
        onChange={setVolume}
        valueText={(v) => `${Math.round(v * 100)}%`}
        className={wide ? "flex-1" : "w-24"}
      />
    </div>
  );
}

/**
 * The volume where the bar has no room for the slider (a window snapped to half a screen): the speaker opens it
 * above, with the mute button. The wheel on the speaker changes the volume too.
 */
export function VolumePopover({ className }: { className?: string }) {
  const t = useT();
  const volume = usePlayer((s) => s.remote?.volume ?? s.volume);
  const muted = usePlayer((s) => s.remote?.muted ?? s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const level = muted ? 0 : volume;
  const Glyph = level === 0 ? SpeakerXIcon : level < 0.5 ? SpeakerLowIcon : SpeakerHighIcon;

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div
      ref={box}
      className={cn("relative", className)}
      onWheel={(e) => setVolume(Math.min(1, Math.max(0, level + (e.deltaY < 0 ? 0.05 : -0.05))))}
    >
      <IconButton label={t.player.volume} size="sm" active={open} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Glyph size={18} />
      </IconButton>
      {open && (
        <div className="absolute right-0 bottom-full z-30 mb-3 rounded-full bg-surface-3 px-2 py-1.5 shadow-lg ring-1 ring-line">
          <Volume />
        </div>
      )}
    </div>
  );
}

export function FavoriteButton({ track, size = "md" }: { track: Track | null; size?: "sm" | "md" | "lg" }) {
  const isFavorite = useLibrary((s) => !!track && s.favorites.some((t) => t.id === track.id));
  const toggle = useLibrary((s) => s.toggleFavorite);
  const t = useT();
  return (
    <IconButton
      label={isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
      active={isFavorite}
      size={size}
      disabled={!track}
      onClick={() => track && void toggle(track)}
    >
      <HeartIcon size={size === "lg" ? 24 : 19} weight={isFavorite ? "fill" : "regular"} />
    </IconButton>
  );
}

/** Audio / Video segmented switch. For songs, Video plays the song's music video when YouTube has one. */
const noLink = () => () => {};

/**
 * Whether video can play: on this device (a phone's server out of reach means audio only, so it follows the server
 * coming and going), or on the device it controls.
 */
export function useVideoAvailable(): boolean {
  useSyncExternalStore(link?.subscribe ?? noLink, () => link?.online ?? true);
  return usePlayer((s) => s.remote?.video ?? capabilities.video);
}

/** `compact`: icons only, for the row at the bottom of the phone's sheet. */
export function ModeSwitch({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useT();
  // This device's mode, or the one of the device it controls (which may not play videos: the phone's own library).
  const preferVideo = usePlayer((s) => s.remote?.preferVideo ?? s.preferVideo);
  const setPreferVideo = usePlayer((s) => s.setPreferVideo);
  const quality = usePlayer((s) => s.remote?.quality ?? s.quality);
  const setQuality = usePlayer((s) => s.setQuality);
  const showingVideo = usePlayer((s) => s.remote?.showingVideo ?? s.mediaKind === "video");
  const canVideo = useVideoAvailable();
  if (!canVideo) return null;

  const seg = (on: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-full text-[13px] font-medium transition-colors duration-200",
      compact ? "size-8 justify-center" : "h-9 px-3.5",
      on ? "bg-surface-4 text-fg shadow-[inset_0_1px_0_var(--highlight)]" : "text-fg-2 hover:text-fg",
    );

  return (
    // Compact, HD/SD is a badge on the switch's corner, so it doesn't widen the row it sits in.
    <div className={cn("flex items-center", compact ? "relative" : "gap-2", className)}>
      <div role="radiogroup" aria-label={t.player.mode} className="flex rounded-full bg-surface-1 p-1 ring-1 ring-line">
        <button
          type="button"
          role="radio"
          aria-checked={!preferVideo}
          aria-label={compact ? t.player.audio : undefined}
          title={compact ? t.player.audio : undefined}
          className={seg(!preferVideo)}
          onClick={() => setPreferVideo(false)}
        >
          <MusicNotesIcon size={compact ? 17 : 15} /> {!compact && t.player.audio}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={preferVideo}
          aria-label={compact ? t.player.video : undefined}
          className={seg(preferVideo)}
          onClick={() => setPreferVideo(true)}
          title={t.player.watchClip}
        >
          <VideoCameraIcon size={compact ? 17 : 15} /> {!compact && t.player.video}
        </button>
      </div>
      {showingVideo && (
        <button
          type="button"
          onClick={() => setQuality(quality === "sd" ? "hd" : "sd")}
          title={quality === "sd" ? t.player.toHd : t.player.toSd}
          className={cn(
            "rounded-full font-mono font-semibold ring-1 transition-colors",
            compact
              ? cn(
                  "absolute -top-2.5 -right-2.5 h-5 px-1.5 text-[10px] leading-none",
                  quality === "hd" ? "bg-accent text-accent-ink ring-accent" : "bg-surface-2 text-fg-2 ring-line",
                )
              : cn(
                  "h-9 px-3 text-[12px]",
                  quality === "hd" ? "bg-accent-soft text-accent-text ring-accent/40" : "text-fg-2 ring-line hover:text-fg",
                ),
          )}
        >
          {quality === "hd" ? "HD" : "SD"}
        </button>
      )}
    </div>
  );
}

import { ArrowsInIcon, ArrowsOutIcon, ArrowsOutSimpleIcon, CornersInIcon, CornersOutIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { MD, useMediaQuery } from "../hooks/useMediaQuery";
import { useT } from "../i18n";
import { appFullscreen, capabilities } from "../lib/api";
import { cn } from "../lib/format";
import { selectCurrent, usePlayer, useStatusText, videoBox, videoEl } from "../player/player";
import { useUi } from "../stores/ui";
import { FavoriteButton, QualityButton, Scrubber, Transport, Volume } from "./Controls";
import { IconButton } from "./IconButton";

/**
 * One video box (the player's two <video> elements, see player.ts) serves every place video can appear. It is
 * re-parented into the highest-priority mounted slot; moving a media element within the document does not interrupt
 * playback.
 */
export const SLOT = { theater: 50, sheet: 30, panel: 20, floating: 5 } as const;

const slots = new Map<number, { el: HTMLElement; priority: number }>();
let seq = 0;

// Off-screen holder keeps the element rendered (not display:none) so browsers keep it playing.
const holder = document.createElement("div");
holder.setAttribute("aria-hidden", "true");
holder.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0;pointer-events:none;overflow:hidden";
document.body.appendChild(holder);
holder.appendChild(videoBox);

const useSlots = create<{ top: number }>(() => ({ top: 0 }));

function place() {
  const best = [...slots.values()].sort((a, b) => b.priority - a.priority)[0];
  const target = best?.el ?? holder;
  if (videoBox.parentElement !== target) target.appendChild(videoBox);
  useSlots.setState({ top: best?.priority ?? 0 });
}

const openTheater = () => useUi.getState().setTheater(true);

export function VideoSlot({
  priority,
  className,
  style,
  expandable,
}: {
  priority: number;
  className?: string;
  style?: CSSProperties;
  /** Offer a "maximize" button (and double-click) that opens the cinema view. */
  expandable?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  // A slot counts only while it's really on screen: the desktop's side panel stays mounted, hidden, on smaller
  // screens, and took the video there (into nothing), so the floating player never showed on a phone.
  useLayoutEffect(() => {
    const el = ref.current!;
    const id = ++seq;
    const update = () => {
      if (el.getClientRects().length > 0) slots.set(id, { el, priority });
      else slots.delete(id);
      place();
    };
    update();
    const watch = new ResizeObserver(update);
    watch.observe(el);
    return () => {
      watch.disconnect();
      slots.delete(id);
      place();
    };
  }, [priority]);

  return (
    <div
      style={style}
      onDoubleClick={expandable ? openTheater : undefined}
      className={cn("group/video relative overflow-hidden bg-black", className)}
    >
      <div ref={ref} className="absolute inset-0" />
      {expandable && (
        <button
          type="button"
          onClick={openTheater}
          aria-label={t.video.maximize}
          title={t.video.maximizeKey}
          className="absolute top-2 right-2 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-[opacity,transform] duration-200 active:scale-90 md:opacity-0 md:group-hover/video:opacity-100 md:focus-visible:opacity-100"
        >
          <ArrowsOutIcon size={18} />
        </button>
      )}
    </div>
  );
}

/** Where the floating video was dragged to (for as long as the page is open), and the track it was closed on. */
const useFloating = create<{ x: number; y: number; closedOn: string | null }>(() => ({ x: 0, y: 0, closedOn: null }));

/**
 * Small floating player shown when video is playing here but no larger video surface is on screen. It can be dragged
 * anywhere on the screen and closed (the track plays on; the next one brings it back). Tapped, the cinema view.
 */
export function FloatingVideo() {
  // A video playing on this device: while it controls another one, its own video is only a still frame.
  const track = usePlayer((s) => (s.mediaKind === "video" && !s.remote ? (s.queue[s.index]?.id ?? null) : null));
  const top = useSlots((s) => s.top);
  const closedOn = useFloating((s) => s.closedOn);
  const t = useT();
  const isMd = useMediaQuery(MD);
  const show = !!track && top < SLOT.panel && closedOn !== track;
  const x = useMotionValue(useFloating.getState().x);
  const y = useMotionValue(useFloating.getState().y);
  const bounds = useRef<HTMLDivElement>(null);
  /** A drag ends in a click on the surface: that one doesn't open the cinema view. */
  const dragged = useRef(false);

  return (
    <>
      {/* The area it can be dragged in: the screen, clear of its edges, the header, and the player and tabs below. */}
      <div
        ref={bounds}
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-2 top-[calc(env(safe-area-inset-top)+60px)] bottom-[calc(132px+env(safe-area-inset-bottom))] md:top-2 md:bottom-[104px]"
      />
      <AnimatePresence>
        {show && (
          <motion.div
            drag
            dragConstraints={bounds}
            dragMomentum={false}
            dragElastic={0.04}
            onDragStart={() => (dragged.current = true)}
            onDragEnd={() => {
              useFloating.setState({ x: x.get(), y: y.get() });
              setTimeout(() => (dragged.current = false), 0);
            }}
            style={{ x, y }}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className={cn(
              "group fixed z-30 cursor-grab touch-none overflow-hidden rounded-2xl border border-line-strong bg-black shadow-[0_16px_40px_rgb(0_0_0/0.5)] active:cursor-grabbing",
              isMd
                ? "right-4 bottom-[112px] w-72"
                : "right-3 bottom-[calc(140px+env(safe-area-inset-bottom))] w-44",
            )}
          >
            <VideoSlot priority={SLOT.floating} className="pointer-events-none aspect-video w-full" />
            <button
              type="button"
              onClick={() => !dragged.current && openTheater()}
              aria-label={t.video.maximize}
              className="absolute inset-0 grid place-items-end p-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <span className="grid size-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm">
                <ArrowsOutSimpleIcon size={16} />
              </span>
            </button>
            <button
              type="button"
              onClick={() => !dragged.current && useFloating.setState({ closedOn: track })}
              aria-label={t.video.close}
              title={t.video.close}
              className="absolute top-1.5 left-1.5 grid size-8 place-items-center rounded-full bg-black/60 text-white opacity-100 backdrop-blur-sm transition-opacity md:opacity-0 md:group-hover:opacity-100"
            >
              <XIcon size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const IDLE_MS = 2800;

/**
 * Cinema view: the clip as large as the window allows, with controls that fade out while watching.
 * Can go true fullscreen (whole screen) from here.
 */
export function Theater() {
  const open = useUi((s) => s.theater);
  const setTheater = useUi((s) => s.setTheater);
  const isVideo = usePlayer((s) => s.mediaKind === "video");
  const playing = usePlayer((s) => s.status === "playing");
  const toggle = usePlayer((s) => s.toggle);
  const track = usePlayer(selectCurrent);
  const statusText = useStatusText();
  const reduce = useReducedMotion();
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chrome, setChrome] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  /** In the Android app's own full screen (appFullscreen), rather than the browser's. */
  const inApp = useRef(false);
  /** The pointer that began the last tap ("mouse", "touch", "pen"), and whether the controls were hidden then. */
  const tap = useRef({ mouse: true, hidden: false });
  const visible = open && isVideo && !!track;

  const setInApp = useCallback((on: boolean) => {
    if (!appFullscreen || inApp.current === on) return;
    inApp.current = on;
    setFullscreen(on);
    void appFullscreen(on, on && usePlayer.getState().videoAspect > 1);
  }, []);

  // The cinema view going away (closed, Back, Audio mode, the queue emptying) leaves the app's full screen too.
  useEffect(() => {
    if (!visible) return;
    return () => setInApp(false);
  }, [visible, setInApp]);

  // Leaving Video mode (or the queue emptying) closes the cinema view.
  useEffect(() => {
    if (open && !isVideo) setTheater(false);
  }, [open, isVideo, setTheater]);

  const wake = useCallback(() => {
    setChrome(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      if (usePlayer.getState().status === "playing") setChrome(false);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    if (!visible) return;
    wake();
    // Escape (Back, in the Android app) leaves full screen first, then the cinema view.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && inApp.current) setInApp(false);
      else if (e.key === "Escape" && !document.fullscreenElement) setTheater(false);
      wake();
    };
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      if (idle.current) clearTimeout(idle.current);
    };
  }, [visible, wake, setTheater, setInApp]);

  // Paused: keep the controls on screen.
  useEffect(() => {
    if (!playing) setChrome(true);
    else if (visible) wake();
  }, [playing, visible, wake]);

  const close = async () => {
    setInApp(false);
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    setTheater(false);
  };

  const toggleFullscreen = async () => {
    if (appFullscreen) return setInApp(!inApp.current);
    if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
    if (box.current?.requestFullscreen) {
      await box.current.requestFullscreen().catch(() => {});
      // Phones: turn sideways for landscape clips (where the browser allows it).
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (usePlayer.getState().videoAspect > 1) orientation.lock?.("landscape").catch(() => {});
      return;
    }
    // iOS Safari only allows fullscreen on the <video> itself.
    (videoEl as HTMLVideoElement & { webkitEnterFullscreen?: () => void }).webkitEnterFullscreen?.();
  };

  const fade = cn("transition-opacity duration-300 ease-out-expo", chrome ? "opacity-100" : "pointer-events-none opacity-0");

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          ref={box}
          role="dialog"
          aria-modal="true"
          aria-label={t.video.label(track.title)}
          data-escape-closes
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={wake}
          // Noted before wake() brings the controls back.
          onPointerDownCapture={(e) => (tap.current = { mouse: e.pointerType === "mouse", hidden: !chrome })}
          onPointerDown={wake}
          className={cn("fixed inset-0 z-50 bg-black", !chrome && "cursor-none")}
        >
          {/*
            Mouse: click toggles play, double-click toggles fullscreen, like most video players. Finger: with the
            controls hidden a tap only shows them (the moving mouse already does that); with them showing, it toggles
            play. No double-tap for full screen there: its first tap would pause, and the button is at hand.
          */}
          <div
            className="absolute inset-0"
            onClick={() => (tap.current.mouse || !tap.current.hidden) && toggle()}
            onDoubleClick={() => tap.current.mouse && void toggleFullscreen()}
          >
            <VideoSlot priority={SLOT.theater} className="size-full bg-black" />
          </div>

          <div
            className={cn(
              "overlay-top pointer-events-none absolute inset-x-0 top-0 bg-linear-to-b from-black/80 to-transparent pb-12",
              // Sideways, a phone's notch or navigation buttons can be on either side.
              "pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))]",
              fade,
            )}
          >
            <div className="pointer-events-auto flex items-start gap-3 pt-3">
              <div className="min-w-0 flex-1 text-white">
                <p className="truncate text-lg font-semibold tracking-tight md:text-xl">{track.title}</p>
                <p className="truncate text-sm text-white/70">{statusText ?? track.artist}</p>
              </div>
              <IconButton
                label={fullscreen ? t.video.exitFullscreen : t.video.fullscreen}
                onClick={toggleFullscreen}
                className="text-white/85 hover:bg-white/15 hover:text-white"
              >
                {fullscreen ? <CornersInIcon size={22} /> : <CornersOutIcon size={22} />}
              </IconButton>
              <IconButton label={t.video.close} onClick={close} className="text-white/85 hover:bg-white/15 hover:text-white">
                {fullscreen ? <ArrowsInIcon size={22} /> : <XIcon size={22} />}
              </IconButton>
            </div>
          </div>

          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent pt-16",
              // Above the phone's navigation buttons or gesture bar, and clear of them sideways.
              "pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:pb-[calc(1.5rem+env(safe-area-inset-bottom))]",
              "pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] md:pr-[max(2rem,env(safe-area-inset-right))] md:pl-[max(2rem,env(safe-area-inset-left))]",
              fade,
            )}
          >
            {/* Controls use the light-on-dark palette regardless of the app theme. */}
            <div data-theme="dark" className="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-2 bg-transparent text-fg">
              <Scrubber />
              <div className="grid grid-cols-[1fr_auto_1fr] items-center">
                <div className="flex items-center">
                  <FavoriteButton track={track} />
                </div>
                <Transport />
                <div className="flex items-center justify-end gap-2">
                  {/* The phone's own picture has one quality (see pictureSource). */}
                  {capabilities.video && <QualityButton compact={false} />}
                  <Volume className="max-md:hidden" />
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

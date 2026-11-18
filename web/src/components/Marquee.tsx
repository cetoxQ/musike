import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../lib/format";

/** Pixels per second toward the end, and back to the start. */
const FORWARD = 30;
const BACK = 90;
/** Rest at each end, and after the line was dragged. */
const PAUSE = 5000;
/** Before the first run, so the start can be read. */
const FIRST = 2500;
/** A drag starts after this many pixels sideways; less is a tap (links stay clickable). */
const SLOP = 6;
const FADE = 16;

/**
 * One line that may not fit: it slides slowly to its end, rests, slides back, rests, and so on. It can be dragged
 * sideways (finger or mouse) to read it; taps still reach the links in it. After a drag it rests, then carries on.
 * The movement is a CSS transition, so the compositor does the work while it runs.
 */
export function Marquee({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = box.current;
    const inner = line.current;
    if (!el || !inner) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let max = 0;
    let pos = 0;
    let ahead = true; // next run goes toward the end
    let timer = 0;
    let moving = false;
    let held = false;

    const fade = (left: boolean, right: boolean) => {
      const mask =
        max > 0
          ? `linear-gradient(to right, ${left ? "transparent" : "#000"}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${right ? "transparent" : "#000"})`
          : "";
      el.style.maskImage = mask;
      el.style.setProperty("-webkit-mask-image", mask);
    };
    const place = (x: number) => {
      pos = Math.min(Math.max(x, 0), max);
      inner.style.transition = "none";
      inner.style.transform = `translateX(${-pos}px)`;
      fade(pos > 1, pos < max - 1);
    };
    /** Where the line is right now, also halfway through a run. */
    const now = () => {
      const shift = getComputedStyle(inner).transform;
      return shift && shift !== "none" ? -new DOMMatrixReadOnly(shift).m41 : 0;
    };
    const halt = () => {
      window.clearTimeout(timer);
      if (moving) place(now());
      moving = false;
    };
    const later = (ms: number) => {
      window.clearTimeout(timer);
      if (max > 0 && !held && !still.matches) timer = window.setTimeout(run, ms);
    };
    const run = () => {
      const to = ahead ? max : 0;
      const seconds = Math.abs(to - pos) / (ahead ? FORWARD : BACK);
      if (seconds < 0.05) return arrived();
      moving = true;
      fade(true, true);
      inner.style.transition = `transform ${seconds}s linear`;
      inner.style.transform = `translateX(${-to}px)`;
      pos = to;
    };
    const arrived = () => {
      moving = false;
      place(pos);
      ahead = pos < max;
      later(PAUSE);
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === inner && moving) arrived();
    };

    const measure = () => {
      const was = max;
      max = Math.max(0, Math.ceil(inner.scrollWidth - el.clientWidth));
      if (max === was) return;
      halt();
      place(pos);
      ahead = pos < max;
      later(was === 0 ? FIRST : PAUSE);
    };
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    sizes.observe(inner);

    // Dragging: the finger (or mouse) moves the line; a short move is a tap and goes through to the links.
    let id = -1;
    let startX = 0;
    let startY = 0;
    let from = 0;
    let dragging = false;
    let swallow = false;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || max <= 0) return;
      halt();
      held = true;
      id = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      from = pos;
      dragging = false;
      swallow = false;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(e.clientY - startY)) return;
        dragging = true;
        el.setPointerCapture(id);
      }
      place(from - dx);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1;
      held = false;
      swallow = dragging;
      dragging = false;
      // After a look around, head for the end again (or back, if already there).
      ahead = pos < max;
      later(PAUSE);
    };
    const click = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    // Sideways scrolling on a touchpad; up and down still scroll the page.
    const wheel = (e: WheelEvent) => {
      if (max <= 0 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      halt();
      place(pos + e.deltaX);
      ahead = pos < max;
      later(PAUSE);
    };
    // Tabbing to a link brings it into view, and the line waits while it has focus. (Not a click's focus: then the
    // line would stand still until something else got focus.)
    let focused = false;
    const focus = (e: FocusEvent) => {
      if (max <= 0 || !(e.target instanceof HTMLElement) || !e.target.matches(":focus-visible")) return;
      halt();
      held = focused = true;
      const left = e.target.getBoundingClientRect().left - inner.getBoundingClientRect().left;
      const right = left + e.target.offsetWidth;
      if (left < pos || right > pos + el.clientWidth) place(left - FADE);
    };
    const blur = () => {
      if (!focused) return;
      held = focused = false;
      ahead = pos < max;
      later(PAUSE);
    };
    const motion = () => (still.matches ? halt() : later(PAUSE));

    inner.addEventListener("transitionend", onEnd);
    el.addEventListener("pointerdown", down);
    // On the window: the finger may leave the line before it lets go.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("focusin", focus);
    el.addEventListener("focusout", blur);
    still.addEventListener("change", motion);
    return () => {
      window.clearTimeout(timer);
      sizes.disconnect();
      inner.removeEventListener("transitionend", onEnd);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("focusin", focus);
      el.removeEventListener("focusout", blur);
      still.removeEventListener("change", motion);
    };
  }, []);

  return (
    <div
      ref={box}
      // Sideways moves are ours; up and down stay with the page.
      className={cn("flex touch-pan-y overflow-hidden select-none [-webkit-touch-callout:none]", className)}
      // Links would otherwise be dragged out as URLs with the mouse.
      onDragStart={(e) => e.preventDefault()}
    >
      <span ref={line} className="shrink-0 whitespace-nowrap">
        {children}
      </span>
    </div>
  );
}

import { animate, useMotionValue, type MotionValue } from "motion/react";
import { useEffect, useRef, type RefObject } from "react";

/** How far, or how fast, a sheet has to be pulled for letting go to close it. */
const CLOSE_PX = 110;
const CLOSE_SPEED = 0.6; // px per ms

/** The list being touched, if it scrolls: the sheet only follows the finger once that list is at its top. */
function scrollerOf(target: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  for (let el = target as HTMLElement | null; el && el !== sheet; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return null;
}

/**
 * A bottom sheet pulled down with a finger follows it, and closes when let go far or fast enough; otherwise it
 * springs back. Anywhere on the sheet: on a list that scrolls, only once the list is at its top, so scrolling it
 * still works. A pull doesn't count as a tap on what it started on.
 *
 * Put the returned `y` on an element inside the one that animates the sheet in and out.
 */
export function useSwipeDown(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled: boolean): MotionValue<number> {
  const y = useMotionValue(0);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const sheet = ref.current;
    if (!enabled || !sheet) return;
    y.set(0);
    let startY = 0;
    let scroller: HTMLElement | null = null;
    let state: "idle" | "maybe" | "pulling" | "scrolling" = "idle";
    let lastY = 0;
    let lastAt = 0;
    let speed = 0;
    let pulled = false;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      startY = lastY = e.touches[0].clientY;
      lastAt = e.timeStamp;
      speed = 0;
      pulled = false;
      scroller = scrollerOf(e.target, sheet);
      state = "maybe";
    };
    const onMove = (e: TouchEvent) => {
      if (state === "idle" || state === "scrolling") return;
      const now = e.touches[0].clientY;
      const dy = now - startY;
      if (state === "maybe") {
        if (Math.abs(dy) < 6) return;
        // Up, or down a list that isn't at its top: that's the list scrolling.
        state = dy > 0 && (!scroller || scroller.scrollTop <= 0) ? "pulling" : "scrolling";
        if (state === "scrolling") return;
      }
      e.preventDefault();
      if (e.timeStamp > lastAt) speed = (now - lastY) / (e.timeStamp - lastAt);
      lastY = now;
      lastAt = e.timeStamp;
      y.set(Math.max(0, dy));
    };
    const onEnd = () => {
      if (state === "pulling") {
        pulled = true;
        if (y.get() > CLOSE_PX || speed > CLOSE_SPEED) close.current();
        else void animate(y, 0, { type: "spring", stiffness: 420, damping: 38 });
      }
      state = "idle";
    };
    // A pull that ends on a button isn't a tap on it.
    const onClick = (e: MouseEvent) => {
      if (!pulled) return;
      pulled = false;
      e.preventDefault();
      e.stopPropagation();
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    sheet.addEventListener("click", onClick, true);
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
      sheet.removeEventListener("click", onClick, true);
    };
  }, [ref, enabled, y]);

  return y;
}

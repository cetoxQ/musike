import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { IconButton } from "./IconButton";

/** The classes of every row that scrolls sideways (albums, singles, videos, artists, recently played). */
export const ROW_CLASS = "no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 md:scroll-px-6 md:px-6";

export interface RowScroll<T extends HTMLElement> {
  ref: RefObject<T | null>;
  canBack: boolean;
  canForward: boolean;
  by: (direction: -1 | 1) => void;
}

/**
 * A row that scrolls sideways with a finger scrolls with a mouse too: dragged (a drag doesn't open what it started
 * on), or with the arrows next to its title (`RowArrows`), a screen at a time.
 */
export function useRowScroll<T extends HTMLElement>(ref?: RefObject<T | null>): RowScroll<T> {
  const own = useRef<T>(null);
  const row = ref ?? own;
  const [edges, setEdges] = useState({ canBack: false, canForward: false });

  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () =>
      setEdges({ canBack: el.scrollLeft > 4, canForward: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    const resized = new ResizeObserver(update);
    resized.observe(el);
    // Tiles added or removed (a new track played first in Recently played) change where the row ends.
    const changed = new MutationObserver(update);
    changed.observe(el, { childList: true });
    el.addEventListener("scroll", update, { passive: true });

    // Dragging with the mouse; touch and pens scroll natively.
    let start: { x: number; left: number } | null = null;
    let dragged = false;
    const move = (e: PointerEvent) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      if (!dragged && Math.abs(dx) > 5) {
        dragged = true;
        el.style.scrollSnapType = "none"; // snapping fights a drag; it's back on release
        el.style.cursor = "grabbing";
      }
      if (dragged) el.scrollLeft = start.left - dx;
    };
    const up = () => {
      start = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragged) return;
      el.style.scrollSnapType = "";
      el.style.cursor = "";
      // The click that ends a drag isn't a click on the tile.
      setTimeout(() => (dragged = false));
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.button !== 0 || el.scrollWidth <= el.clientWidth) return;
      start = { x: e.clientX, left: el.scrollLeft };
      dragged = false;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    const click = (e: MouseEvent) => {
      if (!dragged) return;
      e.preventDefault();
      e.stopPropagation();
    };
    // Links and pictures would otherwise start the browser's own drag and drop.
    const nativeDrag = (e: DragEvent) => e.preventDefault();

    el.addEventListener("pointerdown", down);
    el.addEventListener("click", click, true);
    el.addEventListener("dragstart", nativeDrag);
    return () => {
      resized.disconnect();
      changed.disconnect();
      el.removeEventListener("scroll", update);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("click", click, true);
      el.removeEventListener("dragstart", nativeDrag);
      up();
    };
  }, [row]);

  const by = useCallback(
    (direction: -1 | 1) => {
      const el = row.current;
      if (el) el.scrollBy({ left: direction * Math.max(200, el.clientWidth * 0.8), behavior: "smooth" });
    },
    [row],
  );

  return { ref: row, ...edges, by };
}

/** Back and forward for a row, with a mouse; hidden on touch screens and when the row fits. */
export function RowArrows({ row, className }: { row: RowScroll<HTMLElement>; className?: string }) {
  const t = useT();
  if (!row.canBack && !row.canForward) return null;
  return (
    <div className={cn("hidden items-center gap-1 pointer-fine:flex", className)}>
      <IconButton label={t.common.scrollBack} size="sm" disabled={!row.canBack} onClick={() => row.by(-1)}>
        <CaretLeftIcon size={16} weight="bold" />
      </IconButton>
      <IconButton label={t.common.scrollForward} size="sm" disabled={!row.canForward} onClick={() => row.by(1)}>
        <CaretRightIcon size={16} weight="bold" />
      </IconButton>
    </div>
  );
}

/** A titled row that scrolls sideways: albums, singles, videos, artists, playlists. */
export function ScrollRow({ title, children }: { title: string; children: ReactNode }) {
  const row = useRowScroll<HTMLUListElement>();
  return (
    <section className="flex flex-col gap-3 pt-6">
      <div className="flex items-center justify-between gap-4 px-4 md:px-6">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <RowArrows row={row} />
      </div>
      <ul ref={row.ref} className={ROW_CLASS}>
        {children}
      </ul>
    </section>
  );
}

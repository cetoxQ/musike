import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import { Reorder, useDragControls } from "motion/react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";

/** How long a finger stays on a row, still, before the row is picked up. */
const HOLD_MS = 350;
/** Moving more than this first is a scroll, not a hold. */
const HOLD_SLOP = 8;

/**
 * A list put in order by dragging, with the mouse or a finger: by each row's handle, or, with a finger, by holding the
 * row a moment and then moving it (on a phone the handle sits where Android's back gesture starts, and a row is an
 * easier target). The rest of the time a row still scrolls the page and takes taps. `children` draws a row and places
 * the handle it gets.
 */
export function ReorderList<T>({
  items,
  keyOf,
  onReorder,
  onDragEnd,
  children,
  className,
  rowClassName,
}: {
  items: T[];
  keyOf: (item: T) => string;
  /** The new order, while dragging. */
  onReorder: (items: T[]) => void;
  /** A row was let go. */
  onDragEnd?: () => void;
  children: (item: T, handle: ReactNode) => ReactNode;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <Reorder.Group as="ul" axis="y" values={items} onReorder={onReorder} className={className}>
      {items.map((item) => (
        <Row key={keyOf(item)} item={item} onDragEnd={onDragEnd} className={rowClassName}>
          {children}
        </Row>
      ))}
    </Reorder.Group>
  );
}

function Row<T>({
  item,
  onDragEnd,
  className,
  children,
}: {
  item: T;
  onDragEnd?: () => void;
  className?: string;
  children: (item: T, handle: ReactNode) => ReactNode;
}) {
  const t = useT();
  const controls = useDragControls();
  const ref = useRef<HTMLLIElement>(null);
  /** A finger down on the row, not yet held long enough. */
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  /** The row was picked up by holding it: the finger moves it, not the list. */
  const held = useRef(false);
  /** The tap that ends a hold doesn't also play or open the row. */
  const swallowClick = useRef(false);
  const [lifted, setLifted] = useState(false);

  // Held, the finger's moves don't scroll the list (a listener React can't add: its touch listeners are passive).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const keep = (e: TouchEvent) => {
      if (held.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", keep, { passive: false });
    return () => {
      el.removeEventListener("touchmove", keep);
      if (press.current) clearTimeout(press.current.timer);
    };
  }, []);

  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  const letGo = () => {
    cancelPress();
    if (!held.current) return;
    held.current = false;
    setLifted(false);
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 400);
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== "touch" || held.current) return;
    const start = e.nativeEvent;
    cancelPress();
    press.current = {
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press.current = null;
        held.current = true;
        setLifted(true);
        controls.start(start);
      }, HOLD_MS),
    };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > HOLD_SLOP) cancelPress();
  };

  const handle = (
    <span
      aria-label={t.common.dragToReorder}
      title={t.common.dragToReorder}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        controls.start(e);
      }}
      className="relative z-10 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-fg-3 hover:text-fg active:cursor-grabbing"
    >
      <DotsSixVerticalIcon size={18} weight="bold" />
    </span>
  );
  return (
    <Reorder.Item
      ref={ref}
      as="li"
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragEnd={() => {
        letGo();
        onDragEnd?.();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={letGo}
      onPointerCancel={letGo}
      onContextMenu={(e) => (press.current || held.current) && e.preventDefault()}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      whileDrag={{ scale: 1.02, zIndex: 20 }}
      className={cn(
        "relative select-none [-webkit-touch-callout:none]",
        lifted && "z-20 rounded-xl bg-surface-3 shadow-lg ring-1 ring-line",
        className,
      )}
    >
      {children(item, handle)}
    </Reorder.Item>
  );
}

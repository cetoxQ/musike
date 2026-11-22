import { DotsSixVerticalIcon } from "@phosphor-icons/react";
import { Reorder, useDragControls } from "motion/react";
import type { ReactNode } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";

/**
 * A list put in order by dragging each row's handle, with the mouse or a finger: the rest of the row still scrolls
 * the page and takes taps. `children` draws a row and places the handle it gets.
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
  const handle = (
    <span
      aria-label={t.common.dragToReorder}
      title={t.common.dragToReorder}
      onPointerDown={(e) => {
        e.preventDefault();
        controls.start(e);
      }}
      className="relative z-10 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-fg-3 hover:text-fg active:cursor-grabbing"
    >
      <DotsSixVerticalIcon size={18} weight="bold" />
    </span>
  );
  return (
    <Reorder.Item
      as="li"
      value={item}
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDragEnd}
      whileDrag={{ scale: 1.02, zIndex: 20 }}
      className={cn("relative", className)}
    >
      {children(item, handle)}
    </Reorder.Item>
  );
}

import { QueueIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { selectShownIndex, selectShownQueue, usePlayer } from "../player/player";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";
import { ReorderList } from "./ReorderList";
import type { Track } from "../lib/types";

/** A stable key for each queued track object while it's in the queue (the same song can be queued more than once). */
const keys = new WeakMap<Track, string>();
let nextKey = 0;
const upcomingKey = (track: Track) => {
  let key = keys.get(track);
  if (!key) keys.set(track, (key = `q${nextKey++}`));
  return key;
};

/** The one track a drag moved: its position in `before` and in `after` (the same tracks, one of them elsewhere). */
function moved<T>(before: T[], after: T[]): { from: number; to: number } | null {
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  if (i === before.length) return null;
  let j = before.length - 1;
  while (j > i && before[j] === after[j]) j--;
  return after[i] === before[j] ? { from: j, to: i } : { from: i, to: j };
}

export function QueueList({ compact = false }: { compact?: boolean }) {
  const t = useT();
  // This device's queue, or the one of the device it controls (the actions go there too).
  const queue = usePlayer(selectShownQueue);
  const index = usePlayer(selectShownIndex);
  const live = usePlayer((s) => s.remote?.playing ?? (s.status === "playing" || s.status === "loading"));
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const clearUpcoming = usePlayer((s) => s.clearUpcoming);
  const reorderUpcoming = usePlayer((s) => s.reorderUpcoming);
  const moveInQueue = usePlayer((s) => s.moveInQueue);
  const remote = usePlayer((s) => !!s.remote);
  const autoRadio = usePlayer((s) => s.remote?.autoRadio ?? s.autoRadio);
  const setAutoRadio = usePlayer((s) => s.setAutoRadio);

  const current = queue[index];
  const upcoming = queue.slice(index + 1);
  /**
   * Controlling another device: up next as it's being dragged here, and as it was when the drag began. Letting go
   * sends that device the one move (its queue keeps playing on and can change meanwhile).
   */
  const [dragged, setDragged] = useState<Track[] | null>(null);
  const dragStart = useRef<{ index: number; upcoming: Track[] } | null>(null);
  /** The same as `dragged`, for the drop (which can come before a render). */
  const lastOrder = useRef<Track[] | null>(null);

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-[14px] bg-surface-3 text-fg-3">
          <QueueIcon size={26} />
        </span>
        <p className="font-medium">{t.queue.emptyTitle}</p>
        <p className="max-w-[28ch] text-sm text-fg-2">{t.queue.emptyBody}</p>
      </div>
    );
  }

  // Up next can be dragged into a new order, here or on the device being controlled, when no track object is in it
  // twice (the rows are told apart by them).
  const reorderable = new Set(upcoming).size === upcoming.length;
  const dragRemote = (tracks: Track[]) => {
    dragStart.current ??= { index, upcoming };
    lastOrder.current = tracks;
    setDragged(tracks);
  };
  const dropRemote = () => {
    const start = dragStart.current;
    const m = start && lastOrder.current ? moved(start.upcoming, lastOrder.current) : null;
    if (start && m) moveInQueue(start.index + 1 + m.from, start.index + 1 + m.to);
    dragStart.current = null;
    lastOrder.current = null;
    setDragged(null);
  };

  const row = (i: number, isCurrent: boolean, handle?: ReactNode) => {
    const track = queue[i];
    const body = (
      <>
        {handle}
        <button type="button" onClick={() => jumpTo(i)} className="absolute inset-0 rounded-xl" aria-label={t.common.playX(track.title)} />
        <Artwork src={track.thumb} className="pointer-events-none size-10 rounded-[8px]" />
        <div className="pointer-events-none min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", isCurrent ? "text-accent-text" : "text-fg")}>{track.title}</p>
          <p className="truncate text-xs text-fg-2">{track.artist}</p>
        </div>
        {isCurrent ? (
          <Equalizer live={live} className="mr-2" />
        ) : (
          <>
            <span className="pointer-events-none font-mono text-xs text-fg-3 tabular-nums group-hover:hidden">
              {track.duration ? formatTime(track.duration) : ""}
            </span>
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={t.queue.removeX(track.title)}
              title={t.queue.remove}
              className="relative z-10 hidden size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg group-hover:grid max-md:grid"
            >
              <XIcon size={16} />
            </button>
          </>
        )}
      </>
    );
    return handle !== undefined ? (
      <div className="group relative flex items-center gap-2 rounded-xl py-1.5 pr-2 hover:bg-surface-3">{body}</div>
    ) : (
      <li key={`${track.id}-${i}`} className="group relative flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-3">
        {body}
      </li>
    );
  };

  return (
    <div className={cn("flex flex-col gap-4", compact ? "" : "pb-4")}>
      <section>
        <h3 className="px-2 pb-1.5 text-xs font-medium text-fg-3">{t.queue.nowPlaying}</h3>
        <ul>{row(index, true)}</ul>
      </section>

      <section>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <h3 className="text-xs font-medium text-fg-3">
            {t.queue.upNext} <span className="font-mono">{upcoming.length}</span>
          </h3>
          {upcoming.length > 0 && (
            <button type="button" onClick={clearUpcoming} className="text-xs font-medium text-fg-2 hover:text-fg">
              {t.queue.clear}
            </button>
          )}
        </div>
        {upcoming.length ? (
          reorderable ? (
            <ReorderList
              items={remote ? (dragged ?? upcoming) : upcoming}
              keyOf={(track) => upcomingKey(track)}
              onReorder={remote ? dragRemote : reorderUpcoming}
              onDragEnd={remote ? dropRemote : undefined}
            >
              {/* While dragging another device's queue, a row's actions still go to where its track is there. */}
              {(track, handle) => row(index + 1 + (dragStart.current?.upcoming ?? upcoming).indexOf(track), false, handle)}
            </ReorderList>
          ) : (
            <ul>{upcoming.map((_, k) => row(index + 1 + k, false))}</ul>
          )
        ) : (
          <p className="px-2 text-sm text-fg-2">
            {t.queue.nothingQueued} {autoRadio ? t.queue.radioContinues : ""}
          </p>
        )}
      </section>

      <label className="mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-1 px-3 py-2.5 ring-1 ring-line">
        <span>
          <span className="block text-sm font-medium">{t.queue.autoRadio}</span>
          <span className="block text-xs text-fg-2">{t.queue.autoRadioBody}</span>
        </span>
        <input
          type="checkbox"
          checked={autoRadio}
          onChange={(e) => setAutoRadio(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
            autoRadio ? "bg-accent" : "bg-surface-4",
          )}
        >
          <span
            className={cn(
              "absolute top-1 left-1 size-4 rounded-full transition-transform duration-200 ease-out-expo",
              autoRadio ? "translate-x-4 bg-accent-ink" : "bg-fg-2",
            )}
          />
        </span>
      </label>
    </div>
  );
}

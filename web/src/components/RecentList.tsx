import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { Link } from "react-router";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import type { RecentItem } from "../lib/types";
import { usePlayer } from "../player/player";
import { useRecent } from "../stores/recent";
import { Artwork } from "./Artwork";

const row = "group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-surface-2 md:px-3";

/**
 * The Search page before typing: what you searched for, opened or played, newest first. A search runs again, a
 * track plays, an artist, album or playlist opens; each can be taken off the list.
 */
export function RecentList({ onSearch }: { onSearch: (q: string) => void }) {
  const t = useT();
  const items = useRecent((s) => s.items);
  const remove = useRecent((s) => s.remove);
  const clear = useRecent((s) => s.clear);
  const push = useRecent((s) => s.push);
  const playList = usePlayer((s) => s.playList);
  if (!items.length) return null;

  const label = (item: RecentItem) => {
    switch (item.kind) {
      case "query":
        return { title: item.q, sub: t.search.recentSearch };
      case "track":
        return { title: item.track.title, sub: `${item.track.kind === "video" ? t.search.recentVideo : t.search.recentSong} · ${item.track.artist}` };
      case "artist":
        return { title: item.name, sub: t.search.recentArtist };
      case "album":
        return { title: item.title, sub: item.artist ? `${t.search.recentAlbum} · ${item.artist}` : t.search.recentAlbum };
      case "playlist":
        return { title: item.title, sub: item.author ? `${t.search.recentPlaylist} · ${item.author}` : t.search.recentPlaylist };
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2 md:px-3">
        <h2 className="text-lg font-semibold tracking-tight">{t.search.recent}</h2>
        <button type="button" onClick={clear} className="text-sm font-medium text-fg-2 hover:text-fg">
          {t.search.clearRecent}
        </button>
      </div>
      <ul className="flex flex-col">
        {items.map((item) => {
          const { title, sub } = label(item);
          const body = (
            <>
              {item.kind === "query" ? (
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-3 text-fg-2">
                  <MagnifyingGlassIcon size={20} />
                </span>
              ) : (
                <Artwork
                  src={item.kind === "track" ? item.track.thumb : item.thumb}
                  className={cn("size-11", item.kind === "artist" ? "rounded-full" : "rounded-[10px]")}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">{title}</span>
                <span className="block truncate text-[13px] text-fg-2">{sub}</span>
              </span>
            </>
          );
          const open =
            item.kind === "artist"
              ? paths.artist(item.id)
              : item.kind === "album"
                ? paths.album(item.id)
                : item.kind === "playlist"
                  ? paths.ytPlaylist(item.id)
                  : null;
          return (
            <li key={`${item.kind}:${item.id}`} className={row}>
              {open ? (
                <Link
                  to={open}
                  state={{ name: title, art: item.kind === "artist" ? item.thumb : undefined }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  {body}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (item.kind === "query") {
                      onSearch(item.q);
                      push({ kind: "query", q: item.q });
                    } else if (item.kind === "track") {
                      playList([item.track], 0);
                      push({ kind: "track", track: item.track });
                    }
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {body}
                </button>
              )}
              <button
                type="button"
                aria-label={t.search.removeRecent(title)}
                onClick={() => remove(item.kind, item.id)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-fg-3 hover:bg-surface-3 hover:text-fg"
              >
                <XIcon size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

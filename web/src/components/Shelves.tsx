import { PlayIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { ScrollRow } from "./ScrollRow";
import { paths } from "../lib/routes";
import type { ArtistCard, PlaylistCard, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { Artwork } from "./Artwork";

/** A titled row that scrolls sideways, like the album rows: the frame for an artist page's other shelves. */
export function Shelf({ title, children }: { title: string; children: ReactNode }) {
  return <ScrollRow title={title}>{children}</ScrollRow>;
}

/** Videos as wide tiles; a tile plays the shelf from that video on. */
export function VideoShelf({ title, tracks }: { title: string; tracks: Track[] }) {
  const playList = usePlayer((s) => s.playList);
  return (
    <Shelf title={title}>
      {tracks.map((v, i) => (
        <li key={v.id} className="w-56 shrink-0 snap-start md:w-64">
          <button type="button" onClick={() => playList(tracks, i)} className="group flex w-full flex-col gap-2 text-left">
            <span className="relative block overflow-hidden rounded-[14px]">
              <Artwork
                src={v.art}
                fallback={v.thumb}
                className="aspect-video w-full transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]"
              />
              <span className="absolute inset-0 grid place-items-center bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <PlayIcon size={28} weight="fill" />
              </span>
            </span>
            <span className="min-w-0">
              <span className="line-clamp-2 text-sm font-semibold">{v.title}</span>
              {v.artist && <span className="block truncate text-xs text-fg-2">{v.artist}</span>}
            </span>
          </button>
        </li>
      ))}
    </Shelf>
  );
}

/** YouTube Music playlists as square tiles; each opens the playlist. */
export function PlaylistShelf({ title, playlists }: { title: string; playlists: PlaylistCard[] }) {
  return (
    <Shelf title={title}>
      {playlists.map((p) => (
        <li key={p.id} className="w-36 shrink-0 snap-start md:w-44">
          <Link to={paths.ytPlaylist(p.id)} state={{ name: p.title }} className="group flex flex-col gap-2">
            <span className="block overflow-hidden rounded-[14px]">
              <Artwork
                src={p.art}
                fallback={p.thumb}
                className="aspect-square w-full transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]"
              />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{p.title}</span>
              {p.info && <span className="line-clamp-2 text-xs text-fg-2">{p.info}</span>}
            </span>
          </Link>
        </li>
      ))}
    </Shelf>
  );
}

/** Artists as round photos; each opens the artist's page. */
export function ArtistShelf({ title, artists }: { title: string; artists: ArtistCard[] }) {
  return (
    <Shelf title={title}>
      {artists.map((a) => (
        <li key={a.id} className="w-32 shrink-0 snap-start md:w-40">
          <Link to={paths.artist(a.id)} state={{ name: a.name, art: a.art }} className="group flex flex-col items-center gap-2 text-center">
            <span className="block w-full overflow-hidden rounded-full">
              <Artwork
                src={a.art}
                fallback={a.thumb}
                className="aspect-square w-full rounded-full transition-transform duration-300 ease-out-expo group-hover:scale-[1.04]"
              />
            </span>
            <span className="w-full min-w-0">
              <span className="block truncate text-sm font-semibold">{a.name}</span>
              {a.info && <span className="block truncate text-xs text-fg-2">{a.info}</span>}
            </span>
          </Link>
        </li>
      ))}
    </Shelf>
  );
}

import { PlayIcon, ShuffleIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AlbumRow } from "../components/AlbumTiles";
import { Artwork } from "../components/Artwork";
import { Cover } from "../components/Cover";
import { IconButton, PlayDisc } from "../components/IconButton";
import { PageHeader } from "../components/Page";
import { ArtistShelf, PlaylistShelf, Shelf, VideoShelf } from "../components/Shelves";
import { TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useI18n, useT } from "../i18n";
import { learnTypes, useAlbumTypes } from "../lib/albumTypes";
import { api, capabilities } from "../lib/api";
import { cn, shuffled } from "../lib/format";
import { saysLive } from "../lib/live";
import { paths } from "../lib/routes";
import type { AlbumCard, Discover, PlayEntry } from "../lib/types";
import { usePlayer } from "../player/player";
import { useAuth } from "../stores/auth";
import { useLibrary } from "../stores/library";
import { RankedTracks } from "./Artist";

type Range = "3m" | "all";

/**
 * Your profile, laid out like an artist page: your most played, then what you keep (albums, singles and EPs,
 * artists, live, playlists) and artists you might also like. Only you see it.
 */
export default function Profile() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const user = useAuth((s) => s.user);
  const { favorites, artists, albums, playlists, ytPlaylists, history } = useLibrary();
  const playList = usePlayer((s) => s.playList);

  // Most played: the last 3 months, unless there's too little there (then ever), or you pick.
  const [range, setRange] = useState<Range>("3m");
  const [picked, setPicked] = useState(false);
  const top = useRemote<PlayEntry[]>(`profile-top:${range}:${history[0]?.id ?? ""}`, (signal) => api.topPlays(range, 20, signal));
  useEffect(() => {
    if (!picked && range === "3m" && top.status === "ok" && top.data.length < 5) setRange("all");
  }, [top.status, picked, range]);
  const topTracks = top.status === "ok" ? top.data.map((p) => ({ ...p.track, plays: t.artist.yourPlays(p.count) })) : [];

  const found = useRemote<Discover>(`profile-discover:${lang}`, (signal) => api.discover(signal));
  const discover = found.status === "ok" ? found.data : null;

  // Singles and EPs apart from albums: what isn't known yet is learnt slowly, in the background.
  const types = useAlbumTypes((s) => s.types);
  useEffect(() => {
    const ctrl = new AbortController();
    void learnTypes(albums.filter((a) => !types[a.id]).map((a) => a.id), ctrl.signal);
    return () => ctrl.abort();
  }, [albums.length]);
  const card = (a: (typeof albums)[number]): AlbumCard => ({ id: a.id, title: a.title, artist: a.artist, year: a.year, thumb: a.thumb, art: a.art });
  const longPlays = albums.filter((a) => (types[a.id] ?? "album") === "album").map(card);
  const shortOnes = albums.filter((a) => types[a.id] === "single" || types[a.id] === "ep").map(card);

  const live = useMemo(() => {
    const listed = new Set(discover?.live ?? []);
    return favorites.filter((f) => listed.has(f.id) || saysLive(f));
  }, [favorites, discover]);

  const name = user?.username ?? t.profile.you;
  const banner = topTracks[0]?.art || favorites[0]?.art || "";

  return (
    <div className="pb-8">
      <PageHeader title={t.profile.title} />

      <div className="relative mx-4 overflow-hidden rounded-[20px] bg-surface-2 ring-1 ring-line md:mx-6">
        {banner && (
          <div className="absolute inset-0 scale-110 blur-xl">
            <Artwork src={banner} className="size-full" />
          </div>
        )}
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/80 via-black/35 to-black/10" />
        <div className="relative flex min-h-44 items-end gap-4 p-5 md:min-h-60 md:p-8">
          <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-3 ring-2 ring-white/20 md:size-28">
            {banner ? <Artwork src={banner} className="size-full" /> : <UserCircleIcon size={48} className="text-fg-3" />}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs font-medium text-white/75">{t.profile.label}</span>
            <h1 className="truncate text-[28px] leading-[1.1] font-bold tracking-tight text-white md:text-5xl">{name}</h1>
            <span className="text-sm text-white/80">{t.profile.summary(favorites.length, artists.length, playlists.length)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pt-4 md:px-6">
        {topTracks.length > 0 && (
          <PlayDisc label={t.profile.playTop} onClick={() => playList(topTracks, 0)}>
            <PlayIcon size={22} weight="fill" />
          </PlayDisc>
        )}
        {favorites.length > 0 && (
          <IconButton label={t.profile.shuffleFavorites} onClick={() => playList(shuffled(favorites), 0)}>
            <ShuffleIcon size={22} />
          </IconButton>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-6 pb-1 md:px-6">
        <h2 className="text-xl font-semibold tracking-tight">{t.profile.top}</h2>
        <div role="radiogroup" aria-label={t.profile.top} className="flex rounded-full bg-surface-1 p-1 ring-1 ring-line">
          {(
            [
              ["3m", t.profile.lately],
              ["all", t.profile.ever],
            ] as [Range, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={range === value}
              onClick={() => {
                setPicked(true);
                setRange(value);
              }}
              className={cn(
                "h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors",
                range === value ? "bg-surface-3 text-fg" : "text-fg-2 hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {top.status === "loading" && <TrackListSkeleton rows={5} />}
      {top.status === "ok" &&
        (topTracks.length ? (
          <RankedTracks key={`profile-top-${range}`} tracks={topTracks} />
        ) : (
          <p className="px-4 pt-2 text-sm text-fg-2 md:px-6">{t.profile.noTop}</p>
        ))}
      {range === "3m" && !capabilities.playLog && topTracks.length > 0 && (
        <p className="px-4 pt-1 text-xs text-fg-3 md:px-6">{t.profile.standaloneTop}</p>
      )}

      {longPlays.length > 0 && <AlbumRow title={t.profile.albums} albums={longPlays} />}
      {shortOnes.length > 0 && <AlbumRow title={t.profile.singles} albums={shortOnes} />}

      {artists.length > 0 && (
        <ArtistShelf title={t.profile.artists} artists={artists.map((a) => ({ id: a.id, name: a.name, info: "", thumb: a.thumb, art: a.art }))} />
      )}

      {live.length > 0 && <VideoShelf title={t.profile.live} tracks={live} />}

      {playlists.length > 0 && (
        <Shelf title={t.profile.playlists}>
          {playlists.map((p) => (
            <li key={p.id} className="w-36 shrink-0 snap-start md:w-44">
              <Link to={paths.playlist(p.id)} className="group flex flex-col gap-2">
                <Cover kind="playlist" tracks={p.tracks} className="aspect-square w-full rounded-[14px]" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className="block truncate text-xs text-fg-2">{t.library.playlistSub(p.tracks.length)}</span>
                </span>
              </Link>
            </li>
          ))}
        </Shelf>
      )}
      {ytPlaylists.length > 0 && (
        <PlaylistShelf
          title={t.profile.savedPlaylists}
          playlists={ytPlaylists.map((p) => ({ id: p.id, title: p.title, info: p.author, thumb: p.thumb, art: p.art }))}
        />
      )}

      {discover && discover.artists.length > 0 && <ArtistShelf title={t.profile.alsoLike} artists={discover.artists} />}
      {found.status === "loading" && (artists.length > 0 || history.length > 0) && (
        <section className="flex flex-col gap-3 pt-6">
          <h2 className="px-4 text-xl font-semibold tracking-tight md:px-6">{t.profile.alsoLike}</h2>
          <div className="flex gap-4 px-4 md:px-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton size-28 shrink-0 rounded-full md:size-36" />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

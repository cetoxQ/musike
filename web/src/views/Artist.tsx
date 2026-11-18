import { CaretDownIcon, CaretUpIcon, MusicNotesIcon, PlayIcon, ShuffleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "react-router";
import { AlbumRow } from "../components/AlbumTiles";
import { Artwork } from "../components/Artwork";
import { IconButton, PlayDisc } from "../components/IconButton";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { ArtistShelf, PlaylistShelf, VideoShelf } from "../components/Shelves";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useI18n, useT } from "../i18n";
import { api } from "../lib/api";
import { cn, shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import type { ArtistPage, PlayEntry, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { useRecent } from "../stores/recent";

/** Songs shown before "Show more", and after it. */
const TOP_FEW = 5;
const TOP_MORE = 20;

/** A ranked list that shows TOP_FEW rows, or TOP_MORE after "Show more". Playing a row queues the whole list. */
function RankedTracks({ tracks }: { tracks: Track[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="px-2 md:px-3">
      <TrackList tracks={tracks.slice(0, expanded ? TOP_MORE : TOP_FEW)} context={tracks} header={false} showAlbum />
      {tracks.length > TOP_FEW && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 ml-2 flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-fg-2 hover:bg-surface-2 hover:text-fg"
        >
          {expanded ? <CaretUpIcon size={16} /> : <CaretDownIcon size={16} />}
          {expanded ? t.artist.showLess : t.artist.showMore}
        </button>
      )}
    </div>
  );
}

/**
 * An artist laid out as YouTube Music does: most played songs first (with their play counts and albums),
 * then albums, singles and the page's other shelves (videos, live performances, playlists, similar artists),
 * and the bio at the end.
 */
export default function Artist() {
  const { id = "" } = useParams();
  const location = useLocation();
  const lang = useI18n((s) => s.lang);
  const t = useT();
  // Shelf titles, play counts and the bio come from YouTube Music in the app language.
  const page = useRemote<ArtistPage>(`artist:${lang}:${id}`, (signal) => api.artist(id, signal));
  const playList = usePlayer((s) => s.playList);
  const [fullBio, setFullBio] = useState(false);
  const [mine, setMine] = useState<PlayEntry[]>([]);
  const state = location.state as { name?: string; art?: string } | null;
  const name = (page.status === "ok" && page.data.name) || state?.name || t.artist.fallbackName;
  const following = useLibrary((s) => s.artists.some((a) => a.id === id));
  const toggleArtist = useLibrary((s) => s.toggleArtist);
  const follow = () => {
    if (page.status !== "ok") return;
    // The page has only the wide banner; the round photo from search or the library looks better when there is one.
    const art = state?.art || page.data.banner;
    void toggleArtist({ id, name: page.data.name || name, thumb: art, art, savedAt: Date.now() });
  };

  const data = page.status === "ok" ? page.data : null;
  const tracks = data?.tracks ?? [];

  // Opened: on top of the Search page's Recent list.
  const pushRecent = useRecent((s) => s.push);
  useEffect(() => {
    if (data?.id === id) pushRecent({ kind: "artist", id, name: data.name || name, thumb: state?.art || data.banner });
  }, [data?.id]);

  // Your own plays of this artist, fetched again whenever a new track starts (it may be one of theirs).
  const lastPlayed = useLibrary((s) => s.history[0]?.id);
  const artistName = data?.name ?? "";
  useEffect(() => {
    if (!artistName) return;
    const ctrl = new AbortController();
    api
      .plays(id, artistName, ctrl.signal)
      .then((plays) => {
        if (!ctrl.signal.aborted) setMine(Array.isArray(plays) ? plays : []);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, [id, artistName, lastPlayed]);
  const mineTracks = mine.map((p) => ({ ...p.track, plays: t.artist.yourPlays(p.count) }));

  return (
    <div className="pb-8">
      <PageHeader title={name} actions={<BackButton fallback={paths.search} />} />

      <div className="relative mx-4 overflow-hidden rounded-[20px] bg-surface-2 ring-1 ring-line md:mx-6">
        {data?.banner && (
          <div className="absolute inset-0">
            <Artwork src={data.banner} className="size-full" />
          </div>
        )}
        {page.status === "loading" && <div className="skeleton absolute inset-0" />}
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/80 via-black/25 to-transparent" />
        <div className="relative flex min-h-44 flex-col justify-end gap-1 p-5 md:min-h-60 md:p-8">
          <span className="text-xs font-medium text-white/75">{t.artist.label}</span>
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-tight break-words text-white md:text-5xl">{name}</h1>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pt-4 md:px-6">
        {tracks.length > 0 && (
          <>
            <PlayDisc label={t.artist.playAll(name)} onClick={() => playList(tracks, 0)}>
              <PlayIcon size={22} weight="fill" />
            </PlayDisc>
            <IconButton label={t.album.shuffle} onClick={() => playList(shuffled(tracks), 0)}>
              <ShuffleIcon size={22} />
            </IconButton>
          </>
        )}
        <button
          type="button"
          disabled={page.status !== "ok"}
          onClick={follow}
          aria-pressed={following}
          aria-label={following ? t.artist.unfollowLabel(name) : t.artist.followLabel(name)}
          className={cn(
            "h-9 rounded-full px-5 text-sm font-semibold transition-[transform,background-color] active:scale-[0.97] disabled:opacity-50",
            following ? "bg-accent-soft text-accent-text" : "bg-surface-3 hover:bg-surface-4",
          )}
        >
          {following ? t.artist.following : t.artist.follow}
        </button>
      </div>

      <h2 className="px-4 pt-6 pb-1 text-xl font-semibold tracking-tight md:px-6">{t.artist.hits}</h2>

      {page.status === "loading" && <TrackListSkeleton rows={TOP_FEW} />}

      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.artist.openFailed}
          body={page.message}
          action={
            <button
              type="button"
              onClick={page.retry}
              className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4"
            >
              {t.common.retry}
            </button>
          }
        />
      )}

      {data &&
        (tracks.length ? (
          <RankedTracks key={`top-${id}`} tracks={tracks} />
        ) : (
          <EmptyState icon={<MusicNotesIcon size={28} />} title={t.artist.noHits} body={t.artist.noHitsBody} />
        ))}

      {data && mineTracks.length > 0 && (
        <>
          <h2 className="px-4 pt-6 pb-1 text-xl font-semibold tracking-tight md:px-6">{t.artist.yourListening}</h2>
          <RankedTracks key={`mine-${id}`} tracks={mineTracks} />
        </>
      )}

      {data && data.albums.length > 0 && <AlbumRow title={t.artist.albums} albums={data.albums} />}
      {data && data.singles.length > 0 && <AlbumRow title={t.artist.singles} albums={data.singles} />}

      {data?.shelves?.map((s, i) =>
        s.kind === "videos" ? (
          <VideoShelf key={i} title={s.title} tracks={s.tracks} />
        ) : s.kind === "playlists" ? (
          <PlaylistShelf key={i} title={s.title} playlists={s.playlists} />
        ) : (
          <ArtistShelf key={i} title={s.title} artists={s.artists} />
        ),
      )}

      {data?.description && (
        <section className="flex flex-col gap-2 px-4 pt-8 md:px-6">
          <h2 className="text-xl font-semibold tracking-tight">{t.artist.about}</h2>
          <button
            type="button"
            onClick={() => setFullBio((v) => !v)}
            aria-expanded={fullBio}
            className={cn("max-w-[75ch] text-left text-sm text-fg-2 hover:text-fg", !fullBio && "line-clamp-4")}
          >
            {data.description}
          </button>
        </section>
      )}
    </div>
  );
}

import {
  ArrowRightIcon,
  CheckCircleIcon,
  MusicNotesIcon,
  PauseIcon,
  PlayIcon,
  PlaylistIcon,
  PlusCircleIcon,
  ShuffleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Artwork } from "../components/Artwork";
import { IconButton, PlayDisc } from "../components/IconButton";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { SelectableTrackList } from "../components/Selection";
import { TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useI18n, useT } from "../i18n";
import { api } from "../lib/api";
import { shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import type { SavedYtPlaylist, YtPlaylistPage } from "../lib/types";
import { selectShownQueue, selectShownStatus, usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { useRecent } from "../stores/recent";

/**
 * A YouTube Music playlist: play or shuffle it, keep it in the library (a link that follows the playlist),
 * or save a copy of its tracks as one of your own playlists.
 */
export default function YtPlaylist() {
  const { id = "" } = useParams();
  const location = useLocation();
  const lang = useI18n((s) => s.lang);
  const t = useT();
  const page = useRemote<YtPlaylistPage>(`ytPlaylist:${lang}:${id}`, (signal) => api.ytPlaylist(id, signal));
  const playList = usePlayer((s) => s.playList);
  const toggle = usePlayer((s) => s.toggle);
  const queue = usePlayer(selectShownQueue);
  const status = usePlayer(selectShownStatus);
  const createPlaylist = useLibrary((s) => s.createPlaylist);
  const inLibrary = useLibrary((s) => s.ytPlaylists.some((p) => p.id === id));
  const toggleYtPlaylist = useLibrary((s) => s.toggleYtPlaylist);
  const [copied, setCopied] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  const list = page.status === "ok" ? page.data : null;

  // Opened: on top of the Search page's Recent list.
  const pushRecent = useRecent((s) => s.push);
  useEffect(() => {
    if (list?.id === id) pushRecent({ kind: "playlist", id, title: list.title, author: list.author, thumb: list.thumb || list.art });
  }, [list?.id]);
  const tracks = list?.tracks ?? [];
  const title = list?.title || (location.state as { name?: string } | null)?.name || t.ytPlaylist.fallbackName;
  // The queue holds exactly this playlist: the big button pauses and resumes instead of starting over.
  const isThisPlaying = tracks.length > 0 && queue.length === tracks.length && queue.every((q, i) => q.id === tracks[i]?.id);
  const playing = isThisPlaying && (status === "playing" || status === "loading");

  const toLibraryEntry = (p: YtPlaylistPage): SavedYtPlaylist => ({
    id: p.id,
    title: p.title || title,
    author: p.author,
    thumb: p.thumb,
    art: p.art,
    savedAt: Date.now(),
  });

  const saveCopy = async () => {
    if (!list) return;
    setCopying(true);
    const p = await createPlaylist(list.title || title, tracks);
    setCopying(false);
    if (p) setCopied(p.id);
  };

  return (
    <div className="pb-8">
      <PageHeader title={title} actions={<BackButton fallback={paths.search} />} />

      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-20 h-72 bg-linear-to-b from-accent-soft to-transparent" />
        <div className="relative flex flex-col items-center gap-5 px-4 pt-2 pb-6 md:flex-row md:items-end md:gap-6 md:px-6 md:pt-6">
          {list ? (
            <Artwork
              src={list.art}
              fallback={list.thumb}
              iconSize={64}
              className="size-44 shrink-0 rounded-[18px] shadow-[0_24px_60px_rgb(0_0_0/0.4)] md:size-52"
            />
          ) : (
            <span className="skeleton size-44 shrink-0 rounded-[18px] md:size-52" />
          )}
          <div className="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
            <span className="text-xs font-medium text-fg-2">{t.ytPlaylist.fallbackName}</span>
            <h1 className="max-w-full text-[28px] leading-[1.1] font-bold tracking-tight break-words md:text-5xl">{title}</h1>
            {list?.author && <span className="font-medium">{list.author}</span>}
            {list?.info && <p className="font-mono text-[13px] text-fg-2">{list.info}</p>}
            {list?.description && <p className="line-clamp-2 max-w-prose text-sm text-fg-2">{list.description}</p>}
          </div>
        </div>
      </div>

      {list && tracks.length > 0 && (
        <div className="flex items-center gap-2 px-4 pb-4 md:px-6">
          <PlayDisc
            label={playing ? t.common.pause : t.album.play(title)}
            px={56}
            onClick={() => (isThisPlaying ? toggle() : playList(tracks, 0))}
          >
            {playing ? <PauseIcon size={24} weight="fill" /> : <PlayIcon size={24} weight="fill" />}
          </PlayDisc>
          <IconButton label={t.album.shuffle} size="lg" onClick={() => playList(shuffled(tracks), 0)}>
            <ShuffleIcon size={24} />
          </IconButton>
          <IconButton
            label={inLibrary ? t.album.removeFromLibrary : t.album.saveToLibrary}
            active={inLibrary}
            size="lg"
            onClick={() => void toggleYtPlaylist(toLibraryEntry(list))}
          >
            {inLibrary ? <CheckCircleIcon size={26} weight="fill" /> : <PlusCircleIcon size={26} />}
          </IconButton>
          {copied ? (
            <Link
              to={paths.playlist(copied)}
              className="ml-1 flex h-11 items-center gap-2 rounded-full bg-accent-soft px-4 text-sm font-medium text-accent-text"
            >
              {t.album.openPlaylist} <ArrowRightIcon size={16} />
            </Link>
          ) : (
            <button
              type="button"
              disabled={copying}
              onClick={() => void saveCopy()}
              className="ml-1 flex h-11 items-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-medium transition-transform hover:bg-surface-4 active:scale-[0.97] disabled:opacity-60"
            >
              <PlaylistIcon size={18} /> {t.ytPlaylist.saveCopy}
            </button>
          )}
        </div>
      )}

      {page.status === "loading" && <TrackListSkeleton />}

      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.ytPlaylist.openFailed}
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

      {list &&
        (tracks.length ? (
          <SelectableTrackList key={id} tracks={tracks} numbered />
        ) : (
          <EmptyState icon={<MusicNotesIcon size={28} />} title={t.ytPlaylist.noTracks} body={t.ytPlaylist.noTracksBody} />
        ))}
    </div>
  );
}

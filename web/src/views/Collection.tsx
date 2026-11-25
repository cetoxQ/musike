import {
  ArrowsClockwiseIcon,
  ArrowsDownUpIcon,
  DotsThreeIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  RadioIcon,
  ShuffleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Cover, type CoverKind } from "../components/Cover";
import { NamePlaylistDialog } from "../components/Dialogs";
import { DownloadButton } from "../components/DownloadButton";
import { IconButton, PlayDisc } from "../components/IconButton";
import { Artwork } from "../components/Artwork";
import { Modal } from "../components/Modal";
import { ReorderList } from "../components/ReorderList";
import { EmptyState, PageHeader } from "../components/Page";
import { Action } from "../components/Selection";
import { TrackList } from "../components/TrackList";
import { useT } from "../i18n";
import { cn, shuffled } from "../lib/format";
import { paths } from "../lib/routes";
import type { Track } from "../lib/types";
import { selectShownQueue, selectShownStatus, usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";

interface Props {
  kind: CoverKind;
}

/** Playlist, Favorites and History share one layout. */
export default function Collection({ kind }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const lib = useLibrary();
  const playList = usePlayer((s) => s.playList);
  const toggle = usePlayer((s) => s.toggle);
  const queue = usePlayer(selectShownQueue);
  const status = usePlayer(selectShownStatus);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Putting the playlist in order: the tracks as they're being dragged, saved with Done. */
  const [order, setOrder] = useState<Track[] | null>(null);
  const t = useT();

  // Another playlist opened from this one (the page stays mounted): out of the previous one's ordering.
  useEffect(() => setOrder(null), [id]);

  const playlist = kind === "playlist" ? lib.playlists.find((p) => p.id === id) : undefined;
  const radio = playlist?.radio;
  // What saving keeps: the ticked tracks still in it (the others are dropped).
  const keptN = radio && playlist ? playlist.tracks.filter((x) => radio.kept.includes(x.id)).length : 0;
  const newRadio = lib.playlists.find((p) => p.radio);
  // Showing the radio playlist when a new radio replaced it (here or on another device): on to the new one.
  const wasRadio = useRef(false);
  useEffect(() => {
    if (playlist) wasRadio.current = !!playlist.radio;
    else if (wasRadio.current && newRadio && lib.status === "ready") navigate(paths.playlist(newRadio.id), { replace: true });
  }, [playlist, newRadio, lib.status, navigate]);
  const tracks: Track[] = kind === "favorites" ? lib.favorites : kind === "history" ? lib.history : playlist?.tracks ?? [];
  const name = kind === "favorites" ? t.nav.favorites : kind === "history" ? t.nav.recentlyPlayed : playlist?.name ?? "";
  const label =
    kind === "playlist"
      ? radio
        ? t.radio.badge
        : t.collection.labelPlaylist
      : kind === "favorites"
        ? t.collection.labelFavorites
        : t.collection.labelHistory;

  if (kind === "playlist" && !playlist) {
    if (lib.status !== "ready") return <PageHeader />;
    return (
      <>
        <PageHeader />
        <EmptyState
          icon={<MagnifyingGlassIcon size={28} />}
          title={t.collection.notFoundTitle}
          body={t.collection.notFoundBody}
          action={
            <Link to={paths.library} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm leading-[44px] font-medium">
              {t.collection.goToLibrary}
            </Link>
          }
        />
      </>
    );
  }

  const saveOrder = () => {
    if (playlist && order) void lib.reorderPlaylist(playlist.id, order.map((x) => x.id));
    setOrder(null);
  };

  const total = tracks.reduce((sum, t) => sum + (t.duration || 0), 0);
  // The queue holds exactly these tracks, so this collection is the current playback context.
  const isThisPlaying = tracks.length > 0 && queue.length === tracks.length && queue.every((t) => tracks.some((x) => x.id === t.id));
  const playing = isThisPlaying && (status === "playing" || status === "loading");

  return (
    <div className="pb-8">
      <PageHeader title={name} mobileOnly />

      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-20 h-72 bg-linear-to-b from-accent-soft to-transparent" />
        <div className="relative flex flex-col items-center gap-5 px-4 pt-2 pb-6 md:flex-row md:items-end md:gap-6 md:px-6 md:pt-10">
          <Cover
            kind={kind}
            tracks={tracks}
            iconSize={64}
            className="size-44 shrink-0 rounded-[18px] shadow-[0_24px_60px_rgb(0_0_0/0.4)] md:size-52"
          />
          <div className="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
            <span className="hidden text-xs font-medium text-fg-2 md:block">{label}</span>
            <h1 className="max-w-full text-[28px] leading-[1.1] font-bold tracking-tight break-words md:text-5xl lg:text-6xl">{name}</h1>
            <p className="font-mono text-[13px] text-fg-2">
              {t.common.tracks(tracks.length)}
              {total > 0 && <> · {t.time.total(total)}</>}
              {keptN > 0 && <> · {t.radio.keptCount(keptN)}</>}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-4 pb-4 md:px-6">
        <PlayDisc
          label={playing ? t.common.pause : t.common.playX(name)}
          px={56}
          disabled={!tracks.length}
          onClick={() => (isThisPlaying ? toggle() : playList(tracks, 0))}
        >
          {playing ? <PauseIcon size={24} weight="fill" /> : <PlayIcon size={24} weight="fill" />}
        </PlayDisc>
        <IconButton
          label={t.collection.shuffle}
          size="lg"
          disabled={!tracks.length}
          onClick={() => {
            const order = shuffled(tracks);
            playList(order, 0);
          }}
        >
          <ShuffleIcon size={24} />
        </IconButton>
        <DownloadButton tracks={tracks} />
        {/* Any playlist of yours, made here or saved as a copy: the order in plain sight, not only in the menu. */}
        {playlist && playlist.tracks.length > 1 && (
          <IconButton
            label={order ? t.collection.reorderDone : t.collection.reorder}
            size="lg"
            active={!!order}
            onClick={() => (order ? saveOrder() : setOrder(playlist.tracks))}
          >
            <ArrowsDownUpIcon size={24} />
          </IconButton>
        )}
        {kind === "playlist" && (
          <IconButton label={t.collection.more} size="lg" onClick={() => setMoreOpen(true)}>
            <DotsThreeIcon size={26} weight="bold" />
          </IconButton>
        )}
      </div>

      {/* The radio playlist, not saved yet: keep tracks with their checkbox, regenerate the rest, or save it. */}
      {playlist && radio && !order && (
        <div className="mx-4 mb-4 flex flex-col gap-3 rounded-[18px] bg-surface-2 p-4 md:mx-6 md:flex-row md:items-center md:gap-5">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-text">
              <RadioIcon size={18} weight="bold" />
            </span>
            <p className="text-sm text-fg-2">{t.radio.hint}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => void lib.regenerateRadio(playlist.id)}
              disabled={lib.regenerating === playlist.id}
              title={t.radio.regenerateHint}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-surface-3 px-4 text-sm font-medium hover:bg-surface-4 disabled:opacity-60 md:flex-none"
            >
              <ArrowsClockwiseIcon size={17} className={cn(lib.regenerating === playlist.id && "animate-spin")} />
              {lib.regenerating === playlist.id ? t.radio.regenerating : t.radio.regenerate}
            </button>
            <button
              type="button"
              onClick={() => void lib.saveRadioPlaylist(playlist.id)}
              disabled={!keptN}
              title={keptN ? t.radio.saveHint : t.radio.saveNeedsKept}
              className="h-10 flex-1 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50 md:flex-none"
            >
              {t.radio.save(keptN)}
            </button>
          </div>
        </div>
      )}

      <div className="px-2 md:px-3">
        {order && playlist ? (
          <div className="px-2 md:px-3">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
              <p className="text-sm text-fg-2">{t.collection.reorderHint}</p>
              <button
                type="button"
                onClick={saveOrder}
                className="h-9 shrink-0 rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink"
              >
                {t.collection.reorderDone}
              </button>
            </div>
            <ReorderList items={order} keyOf={(x) => x.id} onReorder={setOrder} rowClassName="rounded-xl bg-surface-1">
              {(track, handle) => (
                <div className="flex items-center gap-3 rounded-xl px-1 py-1.5">
                  {handle}
                  <Artwork src={track.thumb} className="size-10 rounded-[8px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{track.title}</span>
                    <span className="block truncate text-xs text-fg-2">{track.artist}</span>
                  </span>
                </div>
              )}
            </ReorderList>
          </div>
        ) : tracks.length > 0 ? (
          <TrackList
            key={kind === "playlist" ? playlist?.id : kind}
            tracks={tracks}
            playlistId={playlist?.id}
            showAlbum
            keep={
              playlist && radio
                ? {
                    kept: new Set(radio.kept),
                    toggle: (x) => void lib.toggleKeep(playlist.id, x.id),
                    setAll: (on) => void lib.setKept(playlist.id, on ? playlist.tracks.map((x) => x.id) : []),
                  }
                : undefined
            }
            selection={{
              noFavorite: kind === "favorites",
              extra:
                kind === "history"
                  ? undefined
                  : (chosen, done) => (
                      <Action
                        icon={<TrashIcon size={16} />}
                        label={t.selection.remove}
                        onClick={() => {
                          const ids = chosen.map((x) => x.id);
                          done();
                          if (kind === "favorites") void lib.removeFavorites(ids);
                          else if (playlist) void lib.removeManyFromPlaylist(playlist.id, ids);
                        }}
                      />
                    ),
            }}
          />
        ) : (
          <EmptyState
            icon={<MagnifyingGlassIcon size={28} />}
            title={kind === "history" ? t.collection.emptyHistory : t.collection.empty}
            body={
              kind === "favorites"
                ? t.collection.emptyFavoritesBody
                : kind === "history"
                  ? t.collection.emptyHistoryBody
                  : t.collection.emptyPlaylistBody
            }
            action={
              <Link to={paths.search} className="mt-2 h-11 rounded-full bg-accent px-6 text-sm leading-[44px] font-semibold text-accent-ink">
                {t.common.searchMusic}
              </Link>
            }
          />
        )}
      </div>

      {playlist && (
        <>
          <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title={playlist.name}>
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  setRenaming(true);
                }}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-3"
              >
                <PencilSimpleIcon size={18} className="text-fg-2" /> {t.collection.rename}
              </button>
              {playlist.tracks.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    setOrder(playlist.tracks);
                  }}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-3"
                >
                  <ArrowsDownUpIcon size={18} className="text-fg-2" /> {t.collection.reorder}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  setConfirmDelete(true);
                }}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-danger hover:bg-surface-3"
              >
                <TrashIcon size={18} /> {t.collection.deletePlaylist}
              </button>
            </div>
          </Modal>

          <NamePlaylistDialog
            open={renaming}
            initial={playlist.name}
            title={t.collection.renameTitle}
            action={t.collection.save}
            onClose={() => setRenaming(false)}
            onSubmit={(n) => {
              void lib.renamePlaylist(playlist.id, n);
              setRenaming(false);
            }}
          />

          <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t.collection.deleteTitle}>
            <p className="text-sm text-fg-2">
              {t.collection.deleteBody(playlist.name, playlist.tracks.length)}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false);
                  void lib.deletePlaylist(playlist.id);
                  navigate(paths.library);
                }}
                className="h-11 rounded-full bg-danger px-6 text-sm font-semibold text-white"
              >
                {t.collection.delete}
              </button>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

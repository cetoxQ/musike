import { CameraIcon, CaretRightIcon, ChartBarIcon, PlayIcon, ShuffleIcon, UserIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { shuffled } from "../lib/format";
import { saysLive } from "../lib/live";
import { useAccountSettings } from "../lib/accountSettings";
import { maxAmount, PERIODS, periodName, sinceOf, UNIT_MS, type PeriodId, type Unit } from "../lib/periods";
import { paths } from "../lib/routes";
import type { AlbumCard, Discover, PlayEntry } from "../lib/types";
import type { TopRange } from "../lib/apiTypes";
import { usePlayer } from "../player/player";
import { useAuth } from "../stores/auth";
import { useLibrary } from "../stores/library";
import { toast } from "../stores/ui";
import { RankedTracks } from "./Artist";


/** A picture from the gallery, cropped square and made small (a few tens of KB). */
async function squarePicture(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 384;
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 384, 384);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

/**
 * Your profile, laid out like an artist page: your most played, then what you keep (albums, singles and EPs,
 * artists, live, playlists) and artists you might also like. Only you see it.
 */
export default function Profile() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const user = useAuth((s) => s.user);
  const { favorites, artists, albums, playlists, ytPlaylists, history, playsVersion } = useLibrary();
  const playList = usePlayer((s) => s.playList);

  // Most played: the period from Settings (1 month unless changed), all time if it has too little, or one you
  // pick (a custom one never further back than the first play on record).
  const fallback = useAccountSettings((s) => s.profilePeriod) ?? "1m";
  const [chosen, setChosen] = useState<PeriodId | null>(null);
  const [auto, setAuto] = useState<PeriodId | null>(null);
  const range = chosen ?? auto ?? fallback;
  const picked = chosen != null;
  const setRange = (p: PeriodId) => setChosen(p);
  const [amount, setAmount] = useState(7);
  const [unit, setUnit] = useState<Unit>("days");
  const [first, setFirst] = useState<number | null>(null);
  const most = maxAmount(unit, first);
  const shownAmount = Math.min(Math.max(1, amount), most);
  const asked: TopRange = range === "all" ? "all" : { since: sinceOf(range, { amount: shownAmount, unit }, first) };
  const key = range === "custom" ? `custom:${shownAmount}:${unit}` : range;
  const top = useRemote<{ plays: PlayEntry[]; first: number | null }>(`profile-top:${key}:${playsVersion}`, (signal) =>
    api.topPlays(asked, 20, signal),
  );
  useEffect(() => {
    if (top.status === "ok") setFirst(top.data.first);
    if (!picked && range !== "all" && top.status === "ok" && top.data.plays.length < 5) setAuto("all");
  }, [top.status, picked, range]);
  const topTracks = top.status === "ok" ? top.data.plays.map((p) => ({ ...p.track, plays: t.artist.yourPlays(p.count) })) : [];

  // The picture: yours from the gallery, or a plain one.
  const [image, setImage] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api.profileImage(ctrl.signal).then(setImage, () => {});
    return () => ctrl.abort();
  }, []);
  const choose = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImage(await api.setProfileImage(await squarePicture(file)));
    } catch (e) {
      toast((e as Error).message || t.profile.imageFailed, "error");
    }
  };

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
  const banner = image || topTracks[0]?.art || favorites[0]?.art || "";

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
          <div className="relative shrink-0">
            <button
              type="button"
              aria-label={t.profile.changeImage}
              onClick={() => picker.current?.click()}
              className="group relative grid size-20 place-items-center overflow-hidden rounded-full bg-linear-to-br from-accent/80 to-surface-3 ring-2 ring-white/20 md:size-28"
            >
              {image ? <img src={image} alt="" className="size-full object-cover" /> : <UserIcon size={40} weight="fill" className="text-white/90 md:size-14" />}
              <span className="absolute right-1 bottom-1 grid size-7 place-items-center rounded-full bg-black/60 text-white ring-1 ring-white/30">
                <CameraIcon size={15} weight="fill" />
              </span>
            </button>
            {image && (
              <button
                type="button"
                aria-label={t.profile.removeImage}
                onClick={() => void api.setProfileImage(null).then(() => setImage(null), (e: Error) => toast(e.message, "error"))}
                className="absolute -top-1 -right-1 grid size-7 place-items-center rounded-full bg-black/70 text-white ring-1 ring-white/30"
              >
                <XIcon size={14} weight="bold" />
              </button>
            )}
            <input
              ref={picker}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void choose(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
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

      <Link
        to={paths.stats}
        className="mx-4 mt-5 flex items-center gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line transition-colors hover:bg-surface-2 md:mx-6"
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <ChartBarIcon size={22} weight="fill" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{t.stats.title}</span>
          <span className="truncate text-sm text-fg-2">{t.stats.teaser}</span>
        </span>
        <CaretRightIcon size={18} className="text-fg-3" />
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-6 pb-1 md:px-6">
        <h2 className="text-xl font-semibold tracking-tight">{t.profile.top}</h2>
        <select
          value={range}
          aria-label={t.profile.period}
          onChange={(e) => setRange(e.target.value as PeriodId)}
          className="h-9 rounded-full bg-surface-1 px-3 text-sm font-medium ring-1 ring-line focus:ring-accent focus:outline-none"
        >
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {periodName(t, p)}
            </option>
          ))}
        </select>
      </div>
      {range === "custom" && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-2 md:px-6">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={most}
            value={shownAmount}
            aria-label={t.profile.amount}
            onChange={(e) => setAmount(Math.trunc(Number(e.target.value)) || 1)}
            className="h-9 w-20 rounded-full bg-surface-1 px-3 text-sm tabular-nums ring-1 ring-line focus:ring-accent focus:outline-none"
          />
          <select
            value={unit}
            aria-label={t.profile.unit}
            onChange={(e) => setUnit(e.target.value as Unit)}
            className="h-9 rounded-full bg-surface-1 px-3 text-sm ring-1 ring-line focus:ring-accent focus:outline-none"
          >
            {(Object.keys(UNIT_MS) as Unit[]).map((u) => (
              <option key={u} value={u}>
                {t.profile.units[u]}
              </option>
            ))}
          </select>
          {first && (
            <span className="text-xs text-fg-3">{t.profile.since(new Date(first).toLocaleDateString([], { dateStyle: "medium" }))}</span>
          )}
        </div>
      )}
      {top.status === "loading" && <TrackListSkeleton rows={5} />}
      {top.status === "ok" &&
        (topTracks.length ? (
          <RankedTracks key={`profile-top-${range}`} tracks={topTracks} />
        ) : (
          <p className="px-4 pt-2 text-sm text-fg-2 md:px-6">{t.profile.noTop}</p>
        ))}
      {range !== "all" && !capabilities.playLog && topTracks.length > 0 && (
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

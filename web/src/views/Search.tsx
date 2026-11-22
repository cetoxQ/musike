import {
  ArrowRightIcon,
  ArrowUpLeftIcon,
  FunnelSimpleIcon,
  LinkIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { AlbumGrid } from "../components/AlbumTiles";
import { ArtistGrid } from "../components/ArtistTiles";
import { PlaylistGrid } from "../components/PlaylistTiles";
import { Artwork } from "../components/Artwork";
import { GenrePanel } from "../components/GenrePanel";
import { EmptyState, PageHeader } from "../components/Page";
import { RecentList } from "../components/RecentList";
import { useRecent } from "../stores/recent";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { MD, useMediaQuery } from "../hooks/useMediaQuery";
import { api } from "../lib/api";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { playlistIdFromUrl, trackFromLink, videoIdFromUrl } from "../lib/youtubeLink";
import type { AlbumCard, ArtistCard, PlaylistCard, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { parseList } from "./BatchSearch";

type Kind = "song" | "video" | "album" | "artist" | "playlist";
const KIND_PARAM: Record<Kind, string | null> = {
  song: null,
  video: "videos",
  album: "albums",
  artist: "artists",
  playlist: "playlists",
};
const kindOf = (param: string | null): Kind =>
  (Object.keys(KIND_PARAM) as Kind[]).find((k) => KIND_PARAM[k] !== null && KIND_PARAM[k] === param) ?? "song";

// The genre panel stays open when coming back from a genre page.
let genresOpenMemo = false;

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const kind = kindOf(params.get("type"));
  const t = useT();
  const [text, setText] = useState(q);
  const [results, setResults] = useState<Track[] | null>(null);
  const [albums, setAlbums] = useState<AlbumCard[] | null>(null);
  const [artists, setArtists] = useState<ArtistCard[] | null>(null);
  const [playlists, setPlaylists] = useState<PlaylistCard[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const recentCount = useRecent((s) => s.items.length);
  const pushRecent = useRecent((s) => s.push);
  const [linkTrack, setLinkTrack] = useState<Track | "loading" | "error" | null>(null);
  const [retry, setRetry] = useState(0);
  const [genresOpen, setGenresOpenState] = useState(() => genresOpenMemo);
  const input = useRef<HTMLInputElement>(null);
  const isMd = useMediaQuery(MD);
  const playTrack = usePlayer((s) => s.playTrack);

  const linkId = videoIdFromUrl(text);
  // A playlist link: on its own it opens the playlist; with a video in it, the video shows with a way to the list.
  const linkList = playlistIdFromUrl(text);
  const navigate = useNavigate();
  useEffect(() => {
    // Only when just pasted or typed: back here from the playlist, the page stays (with the way to it).
    if (linkList && !linkId && text.trim() !== q.trim()) navigate(paths.ytPlaylist(linkList));
  }, [linkList, linkId, text, q, navigate]);
  // "a, b, c" probably means three songs; offer to search each one (titles can have commas, so only offer).
  const listTerms = linkId || !text.includes(",") ? [] : parseList(text);

  const setGenresOpen = (open: boolean) => {
    genresOpenMemo = open;
    setGenresOpenState(open);
  };

  const setQuery = (next: string, nextKind = kind) => {
    const p = new URLSearchParams();
    if (next.trim()) p.set("q", next.trim());
    const type = KIND_PARAM[nextKind];
    if (type) p.set("type", type);
    setParams(p, { replace: true });
  };

  // Keep the box in sync when navigating back to an earlier query (without eating a trailing space while typing).
  useEffect(() => setText((current) => (current.trim() === q ? current : q)), [q]);

  // Search as you type, debounced.
  useEffect(() => {
    if (linkId || linkList || text.trim() === q) return;
    const timer = setTimeout(() => setQuery(text), 380);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (!q) {
      setResults(null);
      setAlbums(null);
      setArtists(null);
      setPlaylists(null);
      setState("idle");
      return;
    }
    const ctrl = new AbortController();
    setState("loading");
    // Only the list for the current tab is kept, so switching tabs never shows another tab's results.
    const show = (next: { tracks?: Track[]; albums?: AlbumCard[]; artists?: ArtistCard[]; playlists?: PlaylistCard[] }) => {
      setResults(next.tracks ?? null);
      setAlbums(next.albums ?? null);
      setArtists(next.artists ?? null);
      setPlaylists(next.playlists ?? null);
    };
    const found: Promise<unknown> =
      kind === "album"
        ? api.searchAlbums(q, ctrl.signal).then((list) => show({ albums: list }))
        : kind === "artist"
          ? api.searchArtists(q, ctrl.signal).then((list) => show({ artists: list }))
          : kind === "playlist"
            ? api.searchPlaylists(q, ctrl.signal).then((list) => show({ playlists: list }))
            : api.search(q, kind, ctrl.signal).then((list) => show({ tracks: list }));
    found
      .then(() => setState("ok"))
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setState("error");
      });
    return () => ctrl.abort();
  }, [q, kind, retry]);

  useEffect(() => {
    const term = text.trim();
    if (!term || linkId) return setSuggestions([]);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      api
        .suggest(term, ctrl.signal)
        .then((s) => setSuggestions(s.filter((x) => x.toLowerCase() !== term.toLowerCase()).slice(0, 6)))
        .catch(() => {});
    }, 140);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, linkId]);

  useEffect(() => {
    if (!linkId) return setLinkTrack(null);
    const ctrl = new AbortController();
    setLinkTrack("loading");
    trackFromLink(linkId, ctrl.signal)
      .then(setLinkTrack)
      .catch((e: Error) => e.name !== "AbortError" && setLinkTrack("error"));
    return () => ctrl.abort();
  }, [linkId]);

  useEffect(() => {
    if (isMd && !q) input.current?.focus();
  }, []);

  const tab = (k: Kind, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={kind === k}
      onClick={() => setQuery(text || q, k)}
      className={cn(
        "h-9 shrink-0 rounded-full px-4 text-sm font-medium transition-colors duration-200",
        kind === k ? "bg-fg text-bg" : "bg-surface-3 text-fg-2 hover:text-fg",
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="pb-8">
      <PageHeader title={t.search.title} />

      <div className="flex flex-col gap-3 px-4 pt-1 md:px-6">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            input.current?.blur();
            if (linkId) return;
            setQuery(text);
            // A search counts once it's asked for (Enter), not for every pause while typing.
            if (text.trim()) pushRecent({ kind: "query", q: text.trim() });
          }}
          className="relative"
        >
          <label htmlFor="search-input" className="sr-only">
            {t.search.inputLabel}
          </label>
          <MagnifyingGlassIcon size={20} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-fg-2" />
          <input
            id="search-input"
            ref={input}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.search.placeholder}
            className="h-12 w-full rounded-full border border-line-strong bg-surface-2 pr-24 pl-12 text-[16px] placeholder:text-fg-3 focus:border-accent focus:bg-surface-1 focus:outline-none md:h-13 [&::-webkit-search-cancel-button]:hidden"
          />
          <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-2">
            {!text && <kbd className="kbd hidden md:inline">/</kbd>}
            {text && (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setQuery("");
                  input.current?.focus();
                }}
                aria-label={t.search.clear}
                className="grid size-9 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
              >
                <XIcon size={18} />
              </button>
            )}
          </div>
        </form>

        {listTerms.length > 1 && (
          <Link
            to={paths.searchList}
            state={{ text }}
            className="flex items-center gap-3 rounded-[16px] bg-accent-soft px-4 py-3 text-sm ring-1 ring-line transition-colors hover:bg-surface-3"
          >
            <ListBulletsIcon size={20} className="shrink-0 text-accent-text" />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{t.search.searchSeparately(listTerms.length)}</span>
              <span className="block truncate text-fg-2">{listTerms.join(" · ")}</span>
            </span>
            <ArrowRightIcon size={18} className="shrink-0 text-fg-2" />
          </Link>
        )}

        {suggestions.length > 0 && (
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setText(s);
                  setQuery(s);
                }}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-[13px] text-fg-2 ring-1 ring-line transition-colors hover:text-fg"
              >
                <ArrowUpLeftIcon size={13} className="text-fg-3" /> {s}
              </button>
            ))}
          </div>
        )}

        {!linkId && (
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label={t.search.resultType} className="no-scrollbar flex max-w-full gap-2 overflow-x-auto">
              {tab("song", t.search.songs)}
              {tab("artist", t.search.artists)}
              {tab("album", t.search.albums)}
              {tab("playlist", t.search.playlists)}
              {tab("video", t.search.videos)}
            </div>
            <span className="flex-1" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-expanded={genresOpen}
                aria-controls="genre-panel"
                onClick={() => setGenresOpen(!genresOpen)}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
                  genresOpen ? "bg-accent-soft text-accent-text" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
                )}
              >
                <FunnelSimpleIcon size={16} /> {t.search.genres}
              </button>
              <Link
                to={paths.searchList}
                aria-label={t.search.list}
                title={t.search.list}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-fg-2 hover:bg-surface-3 hover:text-fg"
              >
                <ListBulletsIcon size={16} /> <span className="hidden sm:inline">{t.search.list}</span>
              </Link>
            </div>
          </div>
        )}

        {!linkId && genresOpen && <GenrePanel id="genre-panel" />}
      </div>

      <div className="mt-4 px-2 md:px-3">
        {linkId && (
          <div className="px-2 md:px-3">
            {linkTrack === "loading" && <TrackListSkeleton rows={1} />}
            {linkTrack && linkTrack !== "loading" && linkTrack !== "error" && (
              <button
                type="button"
                onClick={() => playTrack(linkTrack)}
                className="flex w-full items-center gap-4 rounded-[16px] bg-surface-2 p-3 text-left ring-1 ring-line transition-colors hover:bg-surface-3"
              >
                <Artwork src={linkTrack.thumb} className="aspect-video w-28 rounded-[10px] md:w-36" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-accent-text">
                    <LinkIcon size={14} /> {t.search.youtubeLink}
                  </span>
                  <span className="mt-1 line-clamp-2 font-medium">{linkTrack.title}</span>
                </span>
                <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
                  <PlayIcon size={22} weight="fill" />
                </span>
              </button>
            )}
            {linkTrack === "error" && (
              <p className="px-1 py-6 text-sm text-fg-2">{t.search.linkError}</p>
            )}
          </div>
        )}
        {linkList && (
          <div className="px-2 md:px-3">
            <Link
              to={paths.ytPlaylist(linkList)}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-fg-2 ring-1 ring-line hover:text-fg"
            >
              <LinkIcon size={16} /> {t.search.openPlaylist}
            </Link>
          </div>
        )}

        {!linkId && state === "loading" && <TrackListSkeleton />}

        {!linkId && state === "error" && (
          <EmptyState
            icon={<WarningCircleIcon size={28} />}
            title={t.search.failed}
            body={error}
            action={
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4"
              >
                {t.common.retry}
              </button>
            }
          />
        )}

        {!linkId && state === "ok" && albums && (albums.length ? (
          <AlbumGrid albums={albums} />
        ) : (
          <EmptyState icon={<MagnifyingGlassIcon size={28} />} title={t.search.nothingFound} body={t.search.nothingFoundBody(q, t.search.songs)} />
        ))}

        {!linkId && state === "ok" && artists && (artists.length ? (
          <ArtistGrid artists={artists} />
        ) : (
          <EmptyState icon={<MagnifyingGlassIcon size={28} />} title={t.search.nothingFound} body={t.search.nothingFoundBody(q, t.search.songs)} />
        ))}

        {!linkId && state === "ok" && playlists && (playlists.length ? (
          <PlaylistGrid playlists={playlists} />
        ) : (
          <EmptyState icon={<MagnifyingGlassIcon size={28} />} title={t.search.nothingFound} body={t.search.nothingFoundBody(q, t.search.songs)} />
        ))}

        {!linkId && state === "ok" && results && results.length === 0 && (
          <EmptyState
            icon={<MagnifyingGlassIcon size={28} />}
            title={t.search.nothingFound}
            body={t.search.nothingFoundBody(q, kind === "song" ? t.search.videos : t.search.songs)}
          />
        )}

        {!linkId && state === "ok" && results && results.length > 0 && <TrackList tracks={results} showAlbum={kind === "song"} />}

        {!linkId && state === "idle" && (
          <div className="px-2 md:px-3">
            {recentCount > 0 ? (
              <RecentList
                onSearch={(r) => {
                  setText(r);
                  setQuery(r);
                }}
              />
            ) : (
              <EmptyState
                icon={<MagnifyingGlassIcon size={28} />}
                title={t.search.idleTitle}
                body={t.search.idleBody}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

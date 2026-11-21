import {
  ArrowSquareOutIcon,
  CheckSquareIcon,
  HeartIcon,
  ListPlusIcon,
  MicrophoneStageIcon,
  VinylRecordIcon,
  PlayIcon,
  PlaylistIcon,
  QueueIcon,
  RadioIcon,
  EraserIcon,
  ShareNetworkIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { share } from "../lib/share";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { MD, useMediaQuery } from "../hooks/useMediaQuery";
import { useSwipeDown } from "../hooks/useSwipeDown";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";

function Item({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] transition-colors md:py-2 md:text-sm",
        "hover:bg-surface-3 focus-visible:bg-surface-3",
        danger ? "text-danger" : "text-fg",
      )}
    >
      <span className={cn("shrink-0", danger ? "text-danger" : "text-fg-2")}>{icon}</span>
      {children}
    </button>
  );
}

export function TrackMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const openAddToPlaylist = useUi((s) => s.openAddToPlaylist);
  const isFavorite = useLibrary((s) => (menu ? s.favorites.some((t) => t.id === menu.track.id) : false));
  const isMd = useMediaQuery(MD);
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const t = useT();
  const navigate = useNavigate();
  const [pos, setPos] = useState({ left: 0, top: 0 });
  // The phone's sheet closes when pulled down, like the Now Playing sheet.
  const y = useSwipeDown(sheet, close, !!menu && !isMd);

  useLayoutEffect(() => {
    if (!menu || !isMd || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    setPos({
      left: Math.min(menu.x, window.innerWidth - width - 12),
      top: menu.y + height > window.innerHeight - 12 ? Math.max(12, menu.y - height) : menu.y,
    });
  }, [menu, isMd]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  const content = menu && (
    <div role="menu" aria-label={t.trackMenu.actionsFor(menu.track.title)} data-escape-closes className="flex flex-col">
      {menu.select && (
        <>
          <Item icon={<CheckSquareIcon size={18} weight={menu.select.selected ? "fill" : "regular"} />} onClick={run(menu.select.toggle)}>
            {menu.select.selected ? t.trackMenu.deselect : t.trackMenu.select}
          </Item>
          <div className="mx-3 my-1 h-px bg-line" />
        </>
      )}
      <Item icon={<PlayIcon size={18} />} onClick={run(() => usePlayer.getState().playTrack(menu.track))}>
        {t.trackMenu.playNow}
      </Item>
      <Item icon={<QueueIcon size={18} />} onClick={run(() => usePlayer.getState().playNext(menu.track))}>
        {t.trackMenu.playNext}
      </Item>
      <Item icon={<ListPlusIcon size={18} />} onClick={run(() => usePlayer.getState().addToQueue(menu.track))}>
        {t.trackMenu.addToQueue}
      </Item>
      <Item icon={<RadioIcon size={18} />} onClick={run(() => void usePlayer.getState().startRadio(menu.track))}>
        {t.trackMenu.startRadio}
      </Item>
      <div className="mx-3 my-1 h-px bg-line" />
      <Item
        icon={<HeartIcon size={18} weight={isFavorite ? "fill" : "regular"} className={isFavorite ? "text-accent-text" : ""} />}
        onClick={run(() => void useLibrary.getState().toggleFavorite(menu.track))}
      >
        {isFavorite ? t.common.removeFromFavorites : t.common.addToFavorites}
      </Item>
      <Item icon={<PlaylistIcon size={18} />} onClick={() => openAddToPlaylist([menu.track])}>
        {t.trackMenu.addToPlaylist}
      </Item>
      {menu.playlistId && (
        <Item
          danger
          icon={<TrashIcon size={18} />}
          onClick={run(() => void useLibrary.getState().removeFromPlaylist(menu.playlistId!, menu.track.id))}
        >
          {t.trackMenu.removeFromPlaylist}
        </Item>
      )}
      <div className="mx-3 my-1 h-px bg-line" />
      {menu.track.artistId && (
        <Item
          icon={<MicrophoneStageIcon size={18} />}
          onClick={run(() =>
            navigate(paths.artist(menu.track.artistId!), {
              state: menu.track.artist.includes(",") ? undefined : { name: menu.track.artist },
            }),
          )}
        >
          {t.trackMenu.goToArtist}
        </Item>
      )}
      {menu.track.albumId && (
        <Item
          icon={<VinylRecordIcon size={18} />}
          onClick={run(() => navigate(paths.album(menu.track.albumId!), { state: { name: menu.track.album } }))}
        >
          {t.trackMenu.goToAlbum}
        </Item>
      )}
      <Item
        icon={<ArrowSquareOutIcon size={18} />}
        onClick={run(() => window.open(`https://www.youtube.com/watch?v=${menu.track.id}`, "_blank", "noopener"))}
      >
        {t.trackMenu.openYoutube}
      </Item>
      <Item
        icon={<ShareNetworkIcon size={18} />}
        onClick={run(() => share({ kind: "track", id: menu.track.id, title: menu.track.title, artist: menu.track.artist }))}
      >
        {t.share.share}
      </Item>
      <Item icon={<EraserIcon size={18} />} onClick={() => useUi.getState().openForget(menu.track)}>
        {t.forget.menu}
      </Item>
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {menu && (
        <div className="fixed inset-0 z-50" onContextMenu={(e) => e.preventDefault()}>
          <motion.div
            className={cn("absolute inset-0", isMd ? "bg-transparent" : "bg-scrim")}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          {isMd ? (
            <motion.div
              ref={box}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              style={pos}
              className="absolute w-64 origin-top-left rounded-2xl border border-line-strong bg-surface-2 p-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.45)]"
            >
              {content}
            </motion.div>
          ) : (
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 420, damping: 40 }}
              className="absolute inset-x-0 bottom-0"
            >
              <motion.div ref={sheet} style={{ y }} className="island safe-bottom rounded-b-none">
                <div className="island-core p-2">
                  <div className="mx-auto mt-1 mb-2 h-1 w-9 rounded-full bg-surface-4" />
                  <div className="flex items-center gap-3 px-3 pb-3">
                    <Artwork src={menu.track.thumb} className="size-12 rounded-[10px]" />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{menu.track.title}</p>
                      <p className="truncate text-sm text-fg-2">{menu.track.artist}</p>
                    </div>
                  </div>
                  <div className="mx-3 mb-1 h-px bg-line" />
                  {content}
                </div>
              </motion.div>
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

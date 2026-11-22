import { DesktopIcon, DeviceMobileIcon, DevicesIcon, PlayIcon, SpeakerHighIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import { usePlayer } from "../player/player";
import { positionOf, useControlled, useDevices, type Device } from "../stores/devices";
import { Artwork } from "./Artwork";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

/** Opens the devices list. Only where devices are in step (https); accent while controlling another device. */
export function DevicesButton({ size = "sm", className }: { size?: "sm" | "md"; className?: string }) {
  const status = useDevices((s) => s.status);
  const setOpen = useDevices((s) => s.setOpen);
  const controlled = useControlled();
  const t = useT();
  if (status === "off") return null;
  return (
    <IconButton label={t.devices.title} size={size} active={!!controlled} onClick={() => setOpen(true)} className={className}>
      <DevicesIcon size={size === "sm" ? 18 : 22} />
    </IconButton>
  );
}

/**
 * The browser refused to play here (after a reload, a page may play sound only after a click on it), typically when
 * another device asked: a button in plain sight, whose click is the one the browser waits for.
 */
export function AutoplayPrompt() {
  const blocked = usePlayer((s) => s.blocked && !s.remote);
  const unblock = usePlayer((s) => s.unblock);
  const t = useT();
  if (!blocked) return null;
  return (
    <button
      type="button"
      onClick={unblock}
      title={t.devices.clickToPlayHint}
      className="fixed top-[calc(env(safe-area-inset-top)+12px)] left-1/2 z-50 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-full bg-accent py-2.5 pr-5 pl-3 text-accent-ink shadow-[0_12px_32px_rgb(0_0_0/0.45)]"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-black/15">
        <PlayIcon size={16} weight="fill" />
      </span>
      <span className="min-w-0 text-left">
        <span className="block text-sm font-semibold">{t.devices.clickToPlay}</span>
        <span className="block truncate text-xs opacity-80">{t.devices.clickToPlayHint}</span>
      </span>
    </button>
  );
}

/** "Playing on Pixel 7", under the player, while the player shows (and controls) another device. */
export function ElsewhereNote({ className }: { className?: string }) {
  const controlled = useControlled();
  const setOpen = useDevices((s) => s.setOpen);
  const t = useT();
  if (!controlled) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={cn("flex w-full min-w-0 items-center gap-1.5 px-3 text-xs font-medium text-accent", className)}
    >
      <SpeakerHighIcon size={14} weight="fill" className="shrink-0" />
      <span className="truncate">
        {controlled.blocked
          ? t.devices.needsClick(controlled.name)
          : controlled.playing
            ? t.devices.playingOn(controlled.name)
            : t.devices.pausedOn(controlled.name)}
      </span>
    </button>
  );
}

/** Re-renders every second while something plays, for the positions. */
function useTick(on: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [on]);
}

function DeviceRow({ device, me, active, onPick }: { device: Device; me: boolean; active: boolean; onPick: () => void }) {
  const t = useT();
  const s = device.state;
  const Icon = device.form === "phone" ? DeviceMobileIcon : DesktopIcon;
  const playing = !!s?.playing && !!s.track;
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        aria-label={me ? t.devices.playHere : t.devices.playOn(device.name)}
        aria-current={active || undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-3 active:scale-[0.99]",
          active && "bg-surface-3",
        )}
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full bg-surface-1 ring-1 ring-line",
            active ? "text-accent" : "text-fg-2",
          )}
        >
          {playing ? <SpeakerHighIcon size={20} weight="fill" /> : <Icon size={20} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm font-medium", active && "text-accent")}>
            {device.name}
            {me && <span className="font-normal text-fg-3"> ({t.devices.thisDevice})</span>}
          </span>
          <span className="block truncate text-xs text-fg-2">
            {s?.track
              ? `${playing ? "" : `${t.devices.paused}: `}${s.track.title}${s.track.artist ? ` - ${s.track.artist}` : ""}`
              : t.devices.idle}
          </span>
        </span>
        {s?.track && (
          <span className="shrink-0 font-mono text-xs text-fg-3 tabular-nums">
            {formatTime(positionOf(s))}
            {s.duration > 0 && ` / ${formatTime(s.duration)}`}
          </span>
        )}
      </button>
    </li>
  );
}

export function DevicesDialog() {
  const open = useDevices((s) => s.open);
  const setOpen = useDevices((s) => s.setOpen);
  const status = useDevices((s) => s.status);
  const devices = useDevices((s) => s.devices);
  const me = useDevices((s) => s.me);
  const active = useDevices((s) => s.active);
  const transfer = useDevices((s) => s.transfer);
  const remote = usePlayer((s) => s.remote);
  const t = useT();
  useTick(open && devices.some((d) => d.state?.playing));
  // This device first, then the others as they came.
  const list = [...devices].sort((a, b) => Number(b.id === me) - Number(a.id === me));

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t.devices.title}>
      {remote?.track && (
        <div className="mb-3 flex items-center gap-3 rounded-2xl bg-surface-1 p-2 ring-1 ring-line">
          <Artwork src={remote.track.thumb} className="size-12 rounded-[10px]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{remote.track.title}</p>
            <p className="truncate text-xs text-accent">
              {remote.playing ? t.devices.playingOn(remote.name) : t.devices.pausedOn(remote.name)}
            </p>
          </div>
        </div>
      )}
      {status === "connecting" && <p className="mb-2 text-sm text-fg-2">{t.devices.connecting}</p>}
      <ul className="flex flex-col gap-1">
        {list.map((d) => (
          <DeviceRow
            key={d.id}
            device={d}
            me={d.id === me}
            active={d.id === active}
            onPick={() => {
              transfer(d.id);
              setOpen(false);
            }}
          />
        ))}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-fg-3">{t.devices.note}</p>
    </Modal>
  );
}

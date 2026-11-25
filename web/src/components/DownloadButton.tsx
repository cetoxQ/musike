import { ArrowCircleDownIcon, CircleNotchIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useDownloads } from "../hooks/useDownloads";
import { useT } from "../i18n";
import type { Track } from "../lib/types";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

/** A list's tracks to the phone, to play without the network: next to Play and Shuffle (only in the Android app). */
export function DownloadButton({ tracks }: { tracks: Track[] }) {
  const downloads = useDownloads();
  const [confirm, setConfirm] = useState(false);
  const t = useT();
  if (!downloads || !tracks.length) return null;

  const states = tracks.map((x) => downloads.state(x.id)?.status);
  const done = states.filter((s) => s === "done").length;
  const busy = states.filter((s) => s === "queued" || s === "downloading").length;
  const all = done === tracks.length;

  return (
    <>
      {busy ? (
        <IconButton label={t.downloads.progress(done, tracks.length)} size="lg" active onClick={() => setConfirm(true)}>
          <CircleNotchIcon size={24} className="animate-spin" />
          <span className="absolute -bottom-1 font-mono text-[10px] tabular-nums">
            {done}/{tracks.length}
          </span>
        </IconButton>
      ) : all ? (
        <IconButton label={t.downloads.downloaded} size="lg" active onClick={() => setConfirm(true)}>
          {/* Not the check of "saved to the library", next to it. */}
          <ArrowCircleDownIcon size={26} weight="fill" />
        </IconButton>
      ) : (
        <IconButton
          label={done ? t.downloads.downloadRest(tracks.length - done) : t.downloads.downloadAll}
          size="lg"
          onClick={() => downloads.add(tracks)}
        >
          <DownloadSimpleIcon size={24} />
        </IconButton>
      )}

      <Modal open={confirm} onClose={() => setConfirm(false)} title={busy ? t.downloads.stopTitle : t.downloads.removeTitle}>
        <p className="text-sm text-fg-2">{busy ? t.downloads.stopBody(busy) : t.downloads.removeBody(done)}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(false)} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirm(false);
              // Stopping leaves what's already downloaded; removing deletes the list's files.
              const ids = tracks
                .filter((x) => (busy ? downloads.state(x.id)?.status !== "done" : true))
                .map((x) => x.id);
              void downloads.remove(ids);
            }}
            className="h-11 rounded-full bg-danger px-6 text-sm font-semibold text-white"
          >
            {busy ? t.downloads.stop : t.downloads.remove}
          </button>
        </div>
      </Modal>
    </>
  );
}

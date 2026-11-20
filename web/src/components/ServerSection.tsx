import { ArrowClockwiseIcon, CloudArrowUpIcon, CloudSlashIcon, DesktopIcon, DeviceMobileIcon, HardDrivesIcon, WarningIcon } from "@phosphor-icons/react";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useT } from "../i18n";
import { connection, link } from "../lib/api";
import { desktop } from "../lib/desktop";
import { cn } from "../lib/format";
import { useAuth } from "../stores/auth";
import { toast } from "../stores/ui";
import { describeImport } from "./BackupSection";
import { Field } from "./AuthScreens";

const action =
  "flex h-11 items-center justify-center gap-2 rounded-full bg-surface-1 px-4 text-sm font-medium ring-1 ring-line transition-[transform,background-color] hover:bg-surface-3 active:scale-[0.98] disabled:opacity-50";

/** A warning under an http:// address: everything travels unencrypted. */
export function InsecureNote({ url }: { url: string }) {
  const t = useT();
  if (!url.startsWith("http://")) return null;
  return (
    <p className="flex items-start gap-2 rounded-[12px] bg-danger/10 p-3 text-xs text-fg-2 ring-1 ring-danger/30">
      <WarningIcon size={16} className="mt-px shrink-0 text-danger" /> {t.server.insecure}
    </p>
  );
}

/** The apps: the library and the music on this phone (computer), or on a Musike server (switching restarts the app). */
export function ServerSection() {
  const t = useT();
  // The same choice in the desktop app, about the computer.
  const words = desktop
    ? { ...t.server, ...t.server.computer, thisPhone: t.server.computer.thisDevice, onThisPhone: t.server.computer.onThisDevice, phoneKept: t.server.computer.deviceKept }
    : t.server;
  const DeviceIcon = desktop ? DesktopIcon : DeviceMobileIcon;
  const signedIn = useAuth((s) => !s.enabled || !!s.user);
  const [choice, setChoice] = useState(connection?.mode ?? "device");
  const [address, setAddress] = useState(connection?.url ?? "");
  const [busy, setBusy] = useState<"connect" | "device" | "copy" | null>(null);
  const [error, setError] = useState("");
  if (!connection) return null;
  const c = connection;

  const run = async (what: "connect" | "device" | "copy", fn: () => Promise<void>) => {
    setBusy(what);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const connect = (e: FormEvent) => {
    e.preventDefault();
    void run("connect", () => c.connect(address));
  };

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-fg-3">{words.title}</h3>
      <p className="text-sm text-fg-2">{words.body}</p>

      <div role="radiogroup" aria-label={words.title} className="flex rounded-full bg-surface-1 p-1 ring-1 ring-line">
        {(
          [
            ["device", DeviceIcon, words.thisPhone],
            ["server", HardDrivesIcon, words.musikeServer],
          ] as const
        ).map(([value, Icon, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={choice === value}
            onClick={() => setChoice(value)}
            className={cn(
              "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition-colors",
              choice === value ? "bg-surface-4 text-fg shadow-[inset_0_1px_0_var(--highlight)]" : "text-fg-2 hover:text-fg",
            )}
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
        {choice === "device" ? (
          c.mode === "device" ? (
            <p className="text-sm text-fg-2">{words.onThisPhone}</p>
          ) : (
            <>
              <p className="text-sm text-fg-2">{words.phoneKept}</p>
              <button type="button" disabled={!!busy} onClick={() => void run("device", () => c.useDevice())} className={action}>
                <DeviceIcon size={18} /> {busy === "device" ? t.account.working : words.switchBack}
              </button>
            </>
          )
        ) : (
          <>
            {c.mode === "server" && <p className="text-sm font-medium">{t.server.connectedTo(c.url)}</p>}
            {c.mode === "server" && <OfflineNote />}
            <form onSubmit={connect} className="flex flex-col gap-2">
              <Field id="server-address" label={t.server.address} value={address} onChange={setAddress} autoComplete="url" />
              <button
                type="submit"
                disabled={!!busy || !address.trim()}
                className="flex h-11 items-center justify-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                {busy === "connect" ? t.server.connecting : t.server.connect}
              </button>
            </form>
            <InsecureNote url={address.trim().startsWith("https://") ? "https://" : address.trim() ? "http://" : ""} />
            {c.mode === "server" && signedIn && (
              <button
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run("copy", async () => {
                    toast(describeImport(t, await c.uploadLocalLibrary()));
                  })
                }
                className={action}
              >
                <CloudArrowUpIcon size={18} /> {busy === "copy" ? t.server.copying : words.copyLibrary}
              </button>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="px-1 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

const noLink = () => () => {};

/** Connected to a server that doesn't answer: since when, what waits for it, and a way to try now. */
function OfflineNote() {
  const t = useT();
  // Re-renders when the server comes and goes (or a change is queued).
  const state = useSyncExternalStore(link?.subscribe ?? noLink, () => (link ? `${link.online}:${link.pending}:${link.since}` : ""));
  const [trying, setTrying] = useState(false);
  if (!link || link.online || !state) return null;
  const since = new Date(link.since ?? Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div role="status" className="flex flex-col gap-2 rounded-[14px] bg-surface-1 p-3 text-sm ring-1 ring-line">
      <p className="flex items-start gap-2 text-fg-2">
        <CloudSlashIcon size={18} className="mt-0.5 shrink-0 text-fg-3" />
        <span>
          {t.offline.status(since)}
          {link.pending > 0 && <> {t.offline.pending(link.pending)}</>}
        </span>
      </p>
      <button
        type="button"
        disabled={trying}
        onClick={() => {
          setTrying(true);
          void link?.retry().finally(() => setTrying(false));
        }}
        className="flex h-10 items-center justify-center gap-2 self-start rounded-full bg-surface-2 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3 disabled:opacity-50"
      >
        <ArrowClockwiseIcon size={16} /> {trying ? t.offline.trying : t.offline.retry}
      </button>
    </div>
  );
}

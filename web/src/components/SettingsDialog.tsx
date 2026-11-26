import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  CarProfileIcon,
  MoonIcon,
  ShareNetworkIcon,
  SpeakerHighIcon,
  SunIcon,
  UserCircleIcon,
  TranslateIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LANGUAGES, useI18n, useT, type Lang } from "../i18n";
import { capabilities, type Channel } from "../lib/api";
import { desktop } from "../lib/desktop";
import { cn } from "../lib/format";
import { useShare } from "../lib/share";
import { saveAccountSettings, useAccountSettings } from "../lib/accountSettings";
import { DEFAULT_PERIODS, periodName, type PeriodId } from "../lib/periods";
import { car, updater } from "../lib/api";
import { isNewer } from "../lib/updates";
import { useAppUpdate } from "../stores/appUpdate";
import { useDownloads } from "../hooks/useDownloads";
import { usePlayer } from "../player/player";
import { useAuth } from "../stores/auth";
import { useSystem } from "../stores/system";
import { toast, useUi } from "../stores/ui";
import { AccountSection } from "./AccountSection";
import { ServerSection } from "./ServerSection";
import { BackupSection } from "./BackupSection";
import { SpotifyImport } from "./SpotifyImport";
import { AccentPicker, LayoutSection } from "./CustomizeSection";
import { Modal } from "./Modal";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  grid = false,
}: {
  label: string;
  value: T;
  options: [T, ReactNode][];
  onChange: (v: T) => void;
  /** Two per row: for longer lists (the languages), which don't fit one row on a phone. */
  grid?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("bg-surface-1 p-1 ring-1 ring-line", grid ? "grid grid-cols-2 gap-1 rounded-[22px]" : "flex rounded-full")}
    >
      {options.map(([v, content]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-center text-[13px] font-medium leading-tight transition-colors duration-200",
            value === v ? "bg-surface-4 text-fg shadow-[inset_0_1px_0_var(--highlight)]" : "text-fg-2 hover:text-fg",
          )}
        >
          {content}
        </button>
      ))}
    </div>
  );
}

/**
 * The "install it yourself" hint is shell-specific: winget only exists on Windows, so the desktop app
 * picks the command for the platform it is running on. The browser build has no bridge and keeps winget.
 */
function depFix(tool: "deno" | "ffmpeg", platform: string | undefined): string {
  if (!platform || platform === "win32") return tool === "deno" ? "winget install DenoLand.Deno" : "winget install yt-dlp.FFmpeg";
  if (platform === "darwin") return `brew install ${tool}`;
  return tool === "deno" ? "curl -fsSL https://deno.land/install.sh | sh" : "sudo apt install ffmpeg";
}

function Dependency({ name, role, path, fix }: { name: string; role: string; path: string | null; fix: string }) {
  const t = useT();
  return (
    <li className="flex items-center gap-3 py-2.5" title={path ?? undefined}>
      {path ? (
        <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-accent-text" />
      ) : (
        <WarningCircleIcon size={20} weight="fill" className="shrink-0 text-danger" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{name}</span>
        <span className="block text-xs text-fg-2">
          {path ? (
            role
          ) : (
            <>
              {t.settings.depMissingBefore} <code className="font-mono text-fg">{fix}</code> {t.settings.depMissingAfter}
            </>
          )}
        </span>
      </span>
    </li>
  );
}

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const { info, status, load, update } = useSystem();
  const [channel, setChannel] = useState<Channel>("stable");
  const logBox = useRef<HTMLPreElement>(null);
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  // With accounts on, only admins update yt-dlp (it changes the server for everyone).
  const canManage = useAuth((s) => !s.enabled || s.user?.role === "admin");

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (info) setChannel(info.ytdlp.channel);
  }, [info?.ytdlp.channel]);

  const job = info?.job;
  const running = job?.status === "running";

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [job?.log.length]);

  const y = info?.ytdlp;
  const missing = !!info && !y?.path;
  const switching = !!y?.version && channel !== y.channel;
  const target = y?.latest[channel];

  let action: string;
  if (running) action = job?.kind === "install" ? t.settings.installing : t.settings.updating;
  else if (missing) action = t.settings.install;
  else if (switching) action = channel === "nightly" ? t.settings.toNightly : t.settings.toStable;
  else if (y?.updateAvailable && target) action = t.settings.updateTo(target);
  else action = t.settings.check;

  const chip = !info ? null : missing ? (
    <span className="rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">{t.settings.chipMissing}</span>
  ) : y?.updateAvailable ? (
    <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-text">{t.settings.chipUpdate}</span>
  ) : (
    <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-medium text-fg-2">{t.settings.chipOk}</span>
  );

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t.settings.title}>
      {/* Side padding keeps outset rings and the scrollbar from clipping the cards' edges. */}
      <div className="scroll-area -mx-2 flex max-h-[70dvh] flex-col gap-5 overflow-y-auto px-2 pb-1">

        <ServerSection />

        <AccountSection />

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-fg-3">{t.settings.appearance}</h3>
          <Segmented
            label={t.settings.theme}
            value={theme}
            onChange={setTheme}
            options={[
              ["dark", <><MoonIcon size={15} /> {t.settings.dark}</>],
              ["light", <><SunIcon size={15} /> {t.settings.light}</>],
            ]}
          />
          <AccentPicker />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
            <TranslateIcon size={14} /> {t.settings.language}
          </h3>
          <Segmented
            label={t.settings.language}
            value={lang}
            onChange={setLang}
            grid={LANGUAGES.length > 3}
            options={LANGUAGES.map(({ id, name }): [Lang, ReactNode] => [id, <span lang={id}>{name}</span>])}
          />
        </section>

        <PlaybackSection />

        <ShareSection />

        <ProfileSection />

        {updater && <UpdateSection />}

        <DownloadsSection />

        {car && <CarSection />}

        <LayoutSection />

        <BackupSection />

        <SpotifyImport />

        {capabilities.engineSettings && (
        <section className="flex flex-col gap-3">
          <h3 className="text-xs font-medium text-fg-3">{t.settings.engine}</h3>

          <div className="flex flex-col gap-4 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold tracking-tight">yt-dlp</p>
                <p className="font-mono text-[13px] text-fg-2 tabular-nums">
                  {status === "loading" && !info ? t.settings.checking : y?.version ?? t.settings.noVersion}
                  {y?.version && <span className="text-fg-3"> · {y.channel === "nightly" ? t.settings.nightly : t.settings.stable}</span>}
                </p>
              </div>
              {chip}
            </div>

            <p className="text-sm text-fg-2">
              {t.settings.engineBody}
            </p>

            {!missing && (
              <div className="flex flex-col gap-1.5">
                <Segmented
                  label={t.settings.channel}
                  value={channel}
                  onChange={setChannel}
                  options={[
                    ["stable", t.settings.stableOption],
                    ["nightly", t.settings.nightlyOption],
                  ]}
                />
                <p className="px-1 text-xs text-fg-3">
                  {channel === "nightly"
                    ? t.settings.nightlyBody + (y?.latest.nightly ? t.settings.latest(y.latest.nightly) : "")
                    : t.settings.stableBody + (y?.latest.stable ? t.settings.latest(y.latest.stable) : "")}
                </p>
              </div>
            )}

            {canManage && (
            <button
              type="button"
              disabled={running || !info || (missing && !info.canInstall)}
              onClick={() => void update(channel)}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-60"
            >
              {running ? (
                <ArrowsClockwiseIcon size={20} weight="bold" className="animate-spin" />
              ) : missing ? (
                <DownloadSimpleIcon size={20} weight="bold" />
              ) : (
                <ArrowsClockwiseIcon size={20} weight="bold" />
              )}
              {action}
            </button>
            )}

            {missing && info && !info.canInstall && (
              <p className="text-sm text-danger">
                {t.settings.noWinget}
              </p>
            )}

            {job && (job.status === "running" || Date.now() - (job.finishedAt ?? 0) < 5 * 60_000) && (
              <div className="flex flex-col gap-2">
                {job.status !== "running" && (
                  <p className={cn("text-sm font-medium", job.status === "error" ? "text-danger" : "text-accent-text")}>
                    {job.message}
                  </p>
                )}
                <pre
                  ref={logBox}
                  aria-live="polite"
                  className="max-h-36 overflow-y-auto rounded-[10px] bg-bg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-2 scroll-area"
                >
                  {job.log.length ? job.log.join("\n") : t.settings.starting}
                </pre>
              </div>
            )}
          </div>

          {info && (
            <ul className="divide-y divide-line px-1">
              <Dependency name="Deno" role={t.settings.denoRole} path={info.deno} fix={depFix("deno", desktop?.platform)} />
              <Dependency name="FFmpeg" role={t.settings.ffmpegRole} path={info.ffmpeg} fix={depFix("ffmpeg", desktop?.platform)} />
            </ul>
          )}
        </section>
        )}
      </div>
    </Modal>
  );
}

/** Where shared links open: YouTube (the default) or YouTube Music. */
/** How this device plays: the same volume for every track. */
function PlaybackSection() {
  const t = useT();
  const even = usePlayer((s) => s.evenVolume);
  const setEven = usePlayer((s) => s.setEvenVolume);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <SpeakerHighIcon size={14} /> {t.settings.playback}
      </h3>
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[14px] bg-surface-1 p-3 ring-1 ring-line">
        <span>
          <span className="block text-sm font-medium">{t.settings.evenVolume}</span>
          <span className="block text-xs text-fg-2">{t.settings.evenVolumeBody}</span>
        </span>
        <input type="checkbox" checked={even} onChange={(e) => setEven(e.target.checked)} className="peer sr-only" />
        <span
          aria-hidden="true"
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
            even ? "bg-accent" : "bg-surface-4",
          )}
        >
          <span
            className={cn(
              "absolute top-1 left-1 size-4 rounded-full transition-transform duration-200 ease-out-expo",
              even ? "translate-x-4 bg-accent-ink" : "bg-fg-2",
            )}
          />
        </span>
      </label>
    </section>
  );
}

function ShareSection() {
  const t = useT();
  const site = useShare((s) => s.site) ?? "youtube";
  const setSite = useShare((s) => s.setSite);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <ShareNetworkIcon size={14} /> {t.share.setting}
      </h3>
      <Segmented
        label={t.share.setting}
        value={site}
        onChange={setSite}
        options={[
          ["youtube", t.share.youtube],
          ["ytmusic", t.share.ytmusic],
        ]}
      />
    </section>
  );
}

/** Android Auto: whether the app may open itself from the car, and the car's log to send along. */
function CarSection() {
  const t = useT();
  const [info, setInfo] = useState<Awaited<ReturnType<NonNullable<typeof car>["info"]>> | null>(null);
  /** Reinstall's download, 0 to 1, while it runs. */
  const [fetching, setFetching] = useState<number | null>(null);
  const reinstall = () => {
    setFetching(0);
    car
      ?.reinstall(setFetching)
      .catch(() => toast(t.car.reinstallFailed, "error"))
      .finally(() => setFetching(null));
  };
  /** Musike Video's download, 0 to 1, while it runs. */
  const [fetchingVideo, setFetchingVideo] = useState<number | null>(null);
  const installVideo = () => {
    setFetchingVideo(0);
    car
      ?.installVideo(setFetchingVideo)
      .catch(() => toast(t.car.videoFailed, "error"))
      .finally(() => setFetchingVideo(null));
  };
  useEffect(() => {
    const read = () => void car?.info().then(setInfo).catch(() => {});
    read();
    // Back from the system's settings: read it again.
    const back = () => document.visibilityState === "visible" && read();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, []);
  if (!info) return null;
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <CarProfileIcon size={14} /> {t.car.settings}
      </h3>
      <div className="flex flex-col gap-2 rounded-[14px] bg-surface-1 p-3 ring-1 ring-line">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t.car.background}</span>
          <span className={cn("shrink-0 text-xs font-medium", info.background ? "text-accent" : "text-fg-3")}>
            {info.background ? t.car.allowed : t.car.notAllowed}
          </span>
        </div>
        <p className="text-xs text-fg-2">
          {t.car.backgroundBody} {info.xiaomi && t.car.backgroundXiaomi}
        </p>
        <button
          type="button"
          onClick={() => void car?.openBackgroundSettings().catch(() => {})}
          className="flex h-9 items-center self-start rounded-full bg-surface-2 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3"
        >
          {t.car.allow}
        </button>
      </div>
      <div className="flex flex-col gap-2 rounded-[14px] bg-surface-1 p-3 ring-1 ring-line">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{t.car.video}</span>
          <span className={cn("shrink-0 text-xs font-medium", info.videoApp ? "text-accent" : "text-fg-3")}>
            {info.videoApp ? t.car.videoInstalled(info.videoApp) : t.car.videoMissing}
          </span>
        </div>
        <p className="text-xs text-fg-2">{t.car.videoBody}</p>
        {(!info.videoApp || isNewer(__APP_VERSION__, info.videoApp)) && (
          <button
            type="button"
            disabled={fetchingVideo !== null}
            onClick={installVideo}
            className="flex h-9 items-center self-start rounded-full bg-surface-2 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3 disabled:opacity-60"
          >
            {fetchingVideo !== null
              ? t.car.videoInstalling(Math.round(fetchingVideo * 100))
              : info.videoApp
                ? t.car.videoUpdate
                : t.car.videoInstall}
          </button>
        )}
      </div>
      {/* Musike itself on the car's screen, parked: Android Auto allows it from Android 15 on. */}
      {info.screenSupported && (
        <div className="flex flex-col gap-2 rounded-[14px] bg-surface-1 p-3 ring-1 ring-line">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{t.car.screen}</span>
            <span className={cn("shrink-0 text-xs font-medium", info.screenListed ? "text-accent" : "text-fg-3")}>
              {info.screenListed ? t.car.screenReady : t.car.screenNotListed}
            </span>
          </div>
          <p className="text-xs text-fg-2">{t.car.screenBody}</p>
          {!info.screenListed && (
            <button
              type="button"
              disabled={fetching !== null}
              onClick={reinstall}
              className="flex h-9 items-center self-start rounded-full bg-surface-2 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3 disabled:opacity-60"
            >
              {fetching === null ? t.car.reinstall : t.car.reinstalling(Math.round(fetching * 100))}
            </button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-1 p-3 ring-1 ring-line">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">{t.car.log}</span>
          <span className="text-xs text-fg-2">{t.car.logBody(info.log.length)}</span>
        </span>
        {info.log.length > 0 && (
          <button
            type="button"
            onClick={() => void car?.shareLog(info.log.join("\n"))}
            className="flex h-9 shrink-0 items-center rounded-full bg-surface-2 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3"
          >
            {t.car.sendLog}
          </button>
        )}
      </div>
    </section>
  );
}

/** This app's version, and a newer one from GitHub: checked on its own every few hours, or now. */
function UpdateSection() {
  const t = useT();
  const { available, status, progress, check, install } = useAppUpdate();
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <ArrowsClockwiseIcon size={14} /> {t.update.settings}
      </h3>
      <div className="flex items-center justify-between gap-3 rounded-[14px] bg-surface-1 p-3 ring-1 ring-line">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            {status === "downloading"
              ? t.update.downloading(Math.round(progress * 100))
              : available
                ? t.update.available(available.version)
                : t.update.current(__APP_VERSION__)}
          </span>
          <span className="text-xs text-fg-2">{t.update.settingsBody}</span>
        </span>
        <button
          type="button"
          disabled={status === "checking" || status === "downloading"}
          onClick={() => void (available ? install() : check(true))}
          className={cn(
            "flex h-9 shrink-0 items-center rounded-full px-4 text-sm font-medium ring-1 ring-line disabled:opacity-60",
            available ? "bg-accent text-accent-ink" : "bg-surface-2 hover:bg-surface-3",
          )}
        >
          {available ? t.update.install : status === "checking" ? t.update.checking : t.update.check}
        </button>
      </div>
    </section>
  );
}

/** The tracks downloaded to the phone: how much room they take, playing them all, deleting them (Android app). */
function DownloadsSection() {
  const t = useT();
  const downloads = useDownloads();
  const [confirm, setConfirm] = useState(false);
  if (!downloads) return null;
  const { count, bytes, pending } = downloads.summary();
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <DownloadSimpleIcon size={14} /> {t.downloads.settings}
      </h3>
      <div className="flex flex-col gap-3 rounded-[14px] bg-surface-1 p-3 ring-1 ring-line">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{t.downloads.summary(count, Math.round(bytes / 1048576))}</span>
          <span className="text-xs text-fg-2">{pending ? t.downloads.pending(pending) : t.downloads.settingsBody}</span>
        </div>
        {count > 0 && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => usePlayer.getState().playList(downloads.tracks(), 0)}
              className="flex h-9 items-center rounded-full bg-surface-2 px-4 text-sm font-medium ring-1 ring-line hover:bg-surface-3"
            >
              {t.downloads.playAll}
            </button>
            <button
              type="button"
              onClick={() => setConfirm(true)}
              className="flex h-9 items-center rounded-full bg-surface-2 px-4 text-sm font-medium text-danger ring-1 ring-line hover:bg-surface-3"
            >
              {t.downloads.removeAll}
            </button>
          </div>
        )}
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={t.downloads.removeAllTitle}>
        <p className="text-sm text-fg-2">{t.downloads.removeBody(count)}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirm(false)} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirm(false);
              void downloads.removeAll();
            }}
            className="h-11 rounded-full bg-danger px-6 text-sm font-semibold text-white"
          >
            {t.downloads.remove}
          </button>
        </div>
      </Modal>
    </section>
  );
}

/** The period the profile's "most played" opens on (follows the account with a server). */
function ProfileSection() {
  const t = useT();
  const period = useAccountSettings((s) => s.profilePeriod) ?? "1m";
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <UserCircleIcon size={14} /> {t.profile.defaultPeriod}
      </h3>
      <select
        value={period}
        aria-label={t.profile.defaultPeriod}
        onChange={(e) => saveAccountSettings({ profilePeriod: e.target.value as PeriodId })}
        className="h-10 rounded-full bg-surface-1 px-4 text-sm ring-1 ring-line focus:ring-accent focus:outline-none"
      >
        {DEFAULT_PERIODS.map((p) => (
          <option key={p} value={p}>
            {periodName(t, p)}
          </option>
        ))}
      </select>
    </section>
  );
}

import { getT } from "../i18n";
import { ApiError, type CarSettings, type Connection, type Downloads, type Updater, type MusikeApi, type ServerLink, type SystemMedia } from "./apiTypes";
import { desktop } from "./desktop";
import { desktopDownloads } from "./desktopDownloads";
import { httpBackend } from "./httpApi";

// The HTTP backend: the Musike server this page came from (web app, desktop app). The Android build swaps this module
// for native/api.ts.
export * from "./apiTypes";

const http = httpBackend({ base: "", fetch: (input, init) => fetch(input, init) });

export const api: MusikeApi = http.api;

/** What a media element plays for a track: here, the server's stream proxy. The Android backend resolves it on the phone. */
export const streamSource = (id: string, kind: "audio" | "video", height: number): string | Promise<string> =>
  http.streamPath(id, kind, height);

/** Saves a text file the way this platform does it: a browser download (the desktop app shows "Save as"). */
export async function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Shares a link: the system's share sheet where the browser has one (not in the desktop app), otherwise copied.
 * Called straight from a click: the share sheet needs it.
 */
export async function shareLink(title: string, url: string): Promise<"shared" | "copied" | "cancelled"> {
  if (!desktop && typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return "copied";
  }
  // http, where the clipboard API isn't there.
  const area = Object.assign(document.createElement("textarea"), { value: url, readOnly: true });
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy");
  return "copied";
}

/** Shares a picture (the listening report): the share sheet where there is one with files, otherwise downloaded. */
export async function shareImage(blob: Blob, name: string, title: string): Promise<"shared" | "saved" | "cancelled"> {
  const file = new File([blob], name, { type: blob.type });
  if (!desktop && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "saved";
}

/** Only the Android app needs its own bridge to the system's media controls. */
export const systemMedia: SystemMedia | null = null;

/** What this build can do. The Android build has no video yet, no yt-dlp to manage, and retries expired streams. */
/** playLog: every play kept with its time (a server's database), so plays can be counted by period. */
export const capabilities = { video: true, engineSettings: true, retryOnError: false, playLog: true };

/** Media elements hide the HTTP error body; fetch it to show the real reason. */
export const explainStreamError = (url: string, _error?: MediaError | null) => http.explain(url);

/**
 * Where the library lives, for the apps: the Android app (native/api.ts) and the desktop app, which shows either
 * this computer's own library or a Musike server's pages. In a browser: null.
 */
export const connection: Connection | null = desktop?.connect ? desktopConnection(desktop.connect, desktop.localLibrary) : null;

function desktopConnection(
  connect: NonNullable<NonNullable<typeof desktop>["connect"]>,
  localLibrary: NonNullable<typeof desktop>["localLibrary"],
): Connection {
  const server = desktop?.server ?? null;
  return {
    mode: server ? "server" : "device",
    url: server ?? desktop?.lastServer ?? "",

    async connect(input) {
      const t = getT();
      const result = await connect(input);
      if ("error" in result) {
        if (result.error === "cancelled") return;
        throw new ApiError(400, result.error === "invalid" ? t.server.invalidAddress : t.server.unreachable);
      }
    },

    async useDevice() {
      // Sign out of the server first, so the session doesn't linger there.
      if (server) await Promise.race([api.logout(), new Promise((r) => setTimeout(r, 5000))]).catch(() => {});
      await connect(null);
    },

    async uploadLocalLibrary() {
      const library = await localLibrary?.();
      if (!library) throw new ApiError(404, getT().server.nothingToCopy);
      return api.importLibrary({ format: "musike-backup", version: 1, exportedAt: new Date().toISOString(), library }, "merge");
    },
  };
}

/** Whether the server answers: only the Android app connected to one (native/api.ts). */
export const link: ServerLink | null = null;

/** Android Auto: only the Android app (native/api.ts). */
export const startCar: (() => void) | null = null;

/** YouTube links opened with the app or shared to it: only the Android app (native/api.ts). */
export const openedLinks: ((open: (url: string) => void) => () => void) | null = null;

/** Settings > Android Auto: only the Android app (native/api.ts). */
export const car: CarSettings | null = null;

/** Updates from GitHub: the Windows app through its shell; the browser has none (the server updates on its own). */
export const updater: Updater | null = desktop?.update ?? null;

/**
 * Tracks kept on the device to play without the network: the Android app (native/downloads.ts), and the desktop app
 * with this computer's own library (its server keeps them). Not a Musike server's page: those files would be the
 * server's, not this computer's.
 */
export const downloads: Downloads | null = desktop?.update && !desktop.server ? desktopDownloads() : null;

/**
 * The cinema view's full screen, done by the Android app itself (native/api.ts): its web view doesn't keep a page in
 * full screen. Elsewhere the browser's Fullscreen API does it.
 */
export const appFullscreen: ((on: boolean, landscape: boolean) => Promise<void>) | null = null;

/**
 * Devices in step (see stores/devices.ts): the WebSocket address, with a fresh single-use ticket. Only over https:
 * on plain http the app works as it always did, on its own. (The desktop app is http://localhost: never.)
 */
export const syncAddress: (() => Promise<string>) | null =
  location.protocol === "https:"
    ? async () => {
        const { ticket } = await http.request<{ ticket: string }>("/api/sync/ticket", { method: "POST" });
        return `wss://${location.host}/api/sync?ticket=${encodeURIComponent(ticket)}`;
      }
    : null;

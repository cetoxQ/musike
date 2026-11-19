import { getT } from "../i18n";
import { ApiError, type Connection, type MusikeApi, type SystemMedia } from "./apiTypes";
import { desktop } from "./desktop";
import { httpBackend } from "./httpApi";

// The HTTP backend: the Musike server this page came from (web app, desktop app). The Android build swaps this module
// for native/api.ts.
export * from "./apiTypes";

const http = httpBackend({ base: "", fetch: (input, init) => fetch(input, init) });

export const api: MusikeApi = http.api;

/** What a media element plays for a track: here, the server's stream proxy. The Android backend resolves it on the phone. */
export const streamSource = (id: string, kind: "audio" | "video", quality: "sd" | "hd"): string | Promise<string> =>
  http.streamPath(id, kind, quality);

/** Saves a text file the way this platform does it: a browser download (the desktop app shows "Save as"). */
export async function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Only the Android app needs its own bridge to the system's media controls. */
export const systemMedia: SystemMedia | null = null;

/** What this build can do. The Android build has no video yet, no yt-dlp to manage, and retries expired streams. */
export const capabilities = { video: true, engineSettings: true, retryOnError: false };

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

/** Android Auto: only the Android app (native/api.ts). */
export const startCar: (() => void) | null = null;

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

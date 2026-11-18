import { type Connection, type MusikeApi, type SystemMedia } from "./apiTypes";
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

/** Only the Android app chooses where its library lives (the phone, or a Musike server). */
export const connection: Connection | null = null;

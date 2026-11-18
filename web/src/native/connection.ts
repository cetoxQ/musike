import { Capacitor } from "@capacitor/core";
import { getT } from "../i18n";
import { ApiError, type Connection, type ErrorCode, type MusikeApi } from "../lib/apiTypes";
import { httpBackend } from "../lib/httpApi";
import { nativeFetch } from "./http";

// Where the Android app gets its library and music: the phone itself, or a Musike server with an account. Read once
// at startup; switching restarts the app, so every part of it starts on the same side.

const KEY = "musike:server";
const TOKEN_KEY = "musike:server-token";
/** Requests to the server say they come from the app (Android's HTTP stack would send Java's own User-Agent). */
const HEADERS = { "user-agent": "Musike Android" };

interface Saved {
  mode: "device" | "server";
  url: string;
}

export function savedConnection(): Saved {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Saved>;
    const url = typeof s.url === "string" ? s.url : "";
    return { mode: s.mode === "server" && url ? "server" : "device", url };
  } catch {
    return { mode: "device", url: "" };
  }
}

function save(s: Saved) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

/** The session token for the server, in the app's private storage (the password is never kept). */
const token = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string | null) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)),
};

/** "192.168.1.10:4180" becomes "http://192.168.1.10:4180". Only http and https, and only the address (no path). */
export function serverAddress(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/** Capacitor's proxy for web view requests (Android's HTTP stack, answered from the app's origin). */
const PROXY = "/_capacitor_http_interceptor_?u=";

/** The server URL inside a proxied one. */
function unproxied(src: string): string {
  const at = src.indexOf(PROXY);
  return at === -1 ? src : decodeURIComponent(src.slice(at + PROXY.length));
}

/** The Musike server as the app's backend: its API with the app's token, and its stream proxy for the audio. */
export function serverBackend(url: string) {
  const http = httpBackend({ base: url, fetch: nativeFetch, token, headers: HEADERS });

  // A media element can't send the token: stream URLs carry a signed link token instead, renewed before it runs out.
  // A server without accounts needs none.
  let link: { token: string; expiresAt: number } | "none" | null = null;
  async function linkToken(): Promise<string | null> {
    if (link === "none") return null;
    if (link && link.expiresAt - Date.now() > 60 * 60_000) return link.token;
    try {
      link = await http.request<{ token: string; expiresAt: number }>("/api/auth/stream-link", { method: "POST" });
      return link.token;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        link = "none";
        return null;
      }
      throw e;
    }
  }

  return {
    api: http.api,
    async streamUrl(id: string): Promise<string> {
      const st = await linkToken();
      const direct = url + http.streamPath(id, "audio", "sd") + (st ? `?st=${encodeURIComponent(st)}` : "");
      // The app's page is https://localhost: the web view won't play audio from an http:// server itself. Android's
      // HTTP stack fetches it instead, through Capacitor's proxy on the app's own origin (Range requests included).
      return url.startsWith("http://") && Capacitor.isNativePlatform() ? `${PROXY}${encodeURIComponent(direct)}` : direct;
    },
    /** Why a stream failed, from the server itself. The next stream gets a fresh link token. */
    async explain(streamUrl: string, error?: MediaError | null): Promise<{ message: string; code?: ErrorCode }> {
      link = null;
      const r = await http.explain(unproxied(streamUrl));
      // The server served it, yet the player failed: say what the player said, to tell a format from a load problem.
      if (error && r.message === getT().player.browserCantPlay) {
        return { ...r, message: `${r.message} (${error.code}${error.message ? `: ${error.message}` : ""})` };
      }
      return r;
    },
  };
}

export function makeConnection(saved: Saved, current: MusikeApi, phoneLibrary: () => Promise<unknown>): Connection {
  return {
    mode: saved.mode,
    url: saved.url,

    async connect(input) {
      const t = getT();
      const url = serverAddress(input);
      if (!url) throw new ApiError(400, t.server.invalidAddress);
      const res = await within(nativeFetch(`${url}/api/health`, { headers: HEADERS }), 8000).catch(() => null);
      const body = res?.ok ? ((await res.json().catch(() => null)) as { ok?: unknown } | null) : null;
      if (body?.ok !== true) throw new ApiError(502, t.server.unreachable);
      token.set(null);
      save({ mode: "server", url });
      location.replace("/");
    },

    async useDevice() {
      // Sign out of the server first, so the session doesn't linger there (if the server can't be reached, it expires).
      if (saved.mode === "server") await within(current.logout(), 5000).catch(() => {});
      token.set(null);
      save({ mode: "device", url: saved.url });
      location.replace("/");
    },

    async uploadLocalLibrary() {
      const library = await phoneLibrary();
      return current.importLibrary({ format: "musike-backup", version: 1, exportedAt: new Date().toISOString(), library }, "merge");
    },
  };
}

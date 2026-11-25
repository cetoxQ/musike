import type { Update } from "./apiTypes";

// Updates come from this fork's GitHub releases. The repository is public, so GitHub answers without a token
// (up to 60 questions an hour from one address: the app asks at most every few hours).

/** The repository whose releases the apps update from (desktop/src/main.mts and MusikeDevicePlugin.java too). */
export const UPDATE_REPO = "cetoxQ/musike";

/** 1.10.0 > 1.9.2; "v" in front and anything after a dash are left out. */
export function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map((n) => Number(n) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export interface Release extends Update {
  /** The download for this platform. */
  url: string;
}

/** The latest published release, when it's newer than this app and has a file matching `asset`. */
export async function latestRelease(asset: RegExp, fetcher: typeof fetch = fetch): Promise<Release | null> {
  const res = await fetcher(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!res.ok) return null;
  const release = (await res.json()) as {
    tag_name?: string;
    html_url?: string;
    assets?: { name: string; browser_download_url: string }[];
  };
  const version = release.tag_name?.replace(/^v/, "") ?? "";
  if (!version || !isNewer(version, __APP_VERSION__)) return null;
  const file = release.assets?.find((a) => asset.test(a.name));
  if (!file) return null;
  return { version, page: release.html_url ?? `https://github.com/${UPDATE_REPO}/releases/latest`, url: file.browser_download_url };
}

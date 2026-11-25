import { App } from "@capacitor/app";
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle, type PluginListenerHandle } from "@capacitor/core";
import type { Updater } from "../lib/apiTypes";
import { latestRelease, type Release } from "../lib/updates";
import { installTvMode } from "../tv/tvMode";

/** MusikeDevicePlugin.java: what kind of device this is, the cinema view's full screen, and installing updates. */
const Device = registerPlugin<{
  info(): Promise<{ tv: boolean }>;
  fullscreen(options: { on: boolean; landscape: boolean }): Promise<void>;
  installUpdate(options: { url: string }): Promise<void>;
  addListener(event: "updateProgress", fn: (e: { fraction: number }) => void): Promise<PluginListenerHandle>;
}>("MusikeDevice", {
  web: () => ({ info: async () => ({ tv: false }), fullscreen: async () => {} }),
});

const APK = /-Android\.apk$/;

/**
 * Updates from GitHub: the APK is downloaded by the app itself and handed to Android's installer, which asks to
 * confirm (and, the first time, to allow Musike to install apps). It installs over this one only when signed with
 * the same key, as every release of this fork is.
 */
async function download(release: Release, progress: (fraction: number) => void) {
  const sub = await Device.addListener("updateProgress", (e) => progress(e.fraction));
  try {
    await Device.installUpdate({ url: release.url });
  } finally {
    void sub.remove();
  }
}

export const androidUpdater: (Updater & { reinstall(progress: (fraction: number) => void): Promise<void> }) | null =
  Capacitor.getPlatform() === "android"
    ? (() => {
        let found: Release | null = null;
        return {
          /** The latest release again, newer or not (Settings > Android Auto, to be listed on the car's screen). */
          async reinstall(progress: (fraction: number) => void) {
            const release = await latestRelease(APK, fetch, true);
            if (!release) throw new Error("no release");
            await download(release, progress);
          },
          async check() {
            found = await latestRelease(APK);
            return found;
          },
          async install(progress) {
            const release = found ?? (await latestRelease(APK));
            if (release) await download(release, progress);
          },
        };
      })()
    : null;

/**
 * Full screen in the Android app: the system bars hide (a swipe from the edge shows them for a moment) and a landscape
 * clip turns the screen sideways, whatever the rotation setting; off, both come back as they were. The web view's own
 * Fullscreen API ends at once (Capacitor's BridgeWebChromeClient), so the page can't do it alone.
 */
export const androidFullscreen =
  Capacitor.getPlatform() === "android"
    ? (on: boolean, landscape: boolean) => Device.fullscreen({ on, landscape }).catch(() => {})
    : null;

// How the app fits into Android itself: Android TV, the Back button and the system bars.
if (Capacitor.isNativePlatform()) {
  // One APK for phones and TVs: on a TV, switch to the remote-friendly 10-foot UI (web/src/tv).
  void Device.info()
    .then(({ tv }) => {
      if (!tv) return;
      document.documentElement.dataset.tv = "1";
      installTvMode();
    })
    .catch(() => {});

  // Back closes what's on top (a dialog, a menu), then goes back through pages, then sends the app to the
  // background, where the music keeps playing.
  void App.addListener("backButton", () => {
    const overlay = [...document.querySelectorAll("[data-escape-closes]")].some((el) => el.getClientRects().length > 0);
    if (overlay) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      return;
    }
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) window.history.back();
    else void App.minimizeApp();
  });

  // Status and navigation bar icons stay readable in both themes.
  const syncBars = () => {
    const light = document.documentElement.dataset.theme === "light";
    void SystemBars.setStyle({ style: light ? SystemBarsStyle.Light : SystemBarsStyle.Dark });
  };
  syncBars();
  new MutationObserver(syncBars).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

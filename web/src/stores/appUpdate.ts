import { create } from "zustand";
import { getT } from "../i18n";
import { updater, type Update } from "../lib/api";
import { toast } from "./ui";

/** Asked at most this often on its own (GitHub allows 60 unauthenticated questions an hour per address). */
const EVERY_MS = 6 * 3600_000;
const LAST_KEY = "musike:update-checked";

interface AppUpdateState {
  /** A newer release, once found. */
  available: Update | null;
  status: "idle" | "checking" | "downloading" | "error";
  progress: number;
  /** Looks for a newer release; on its own (not forced) only every few hours, and it says so only when there is one. */
  check: (forced?: boolean) => Promise<void>;
  install: () => Promise<void>;
}

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  available: null,
  status: "idle",
  progress: 0,
  async check(forced = false) {
    if (!updater || get().status === "checking" || get().status === "downloading") return;
    if (!forced) {
      try {
        if (Date.now() - Number(localStorage.getItem(LAST_KEY) ?? 0) < EVERY_MS) return;
        localStorage.setItem(LAST_KEY, String(Date.now()));
      } catch {
        /* storage unavailable: ask anyway */
      }
    }
    set({ status: "checking" });
    try {
      const available = await updater.check();
      set({ available, status: "idle" });
      const t = getT().update;
      if (available) toast(t.available(available.version), undefined, { label: t.install, run: () => void get().install() });
      else if (forced) toast(t.upToDate);
    } catch {
      set({ status: forced ? "error" : "idle" });
      if (forced) toast(getT().update.checkFailed, "error");
    }
  },
  async install() {
    if (!updater || get().status === "downloading") return;
    set({ status: "downloading", progress: 0 });
    try {
      await updater.install((progress) => set({ progress }));
      // Android: the installer is open now; Windows: the app is closing.
      set({ status: "idle" });
    } catch {
      set({ status: "error" });
      toast(getT().update.installFailed, "error");
    }
  },
}));

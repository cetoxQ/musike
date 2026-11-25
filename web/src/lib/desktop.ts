/** Bridge exposed by the Electron preload script when Musike runs as the desktop app. */
interface DesktopBridge {
  platform: string;
  setTheme: (theme: "dark" | "light") => void;
  /** Missing in desktop builds older than 1.2. */
  setLanguage?: (lang: string) => void;
  /** Settings > Server (missing in builds that only have this computer's library): the server shown, or null. */
  server?: string | null;
  lastServer?: string;
  /** Switches to a Musike server, or back to this computer with null: the app starts over there. */
  connect?: (url: string | null) => Promise<{ ok: true } | { error: "invalid" | "unreachable" | "cancelled" }>;
  /** This computer's own library (null when there is none). */
  localLibrary?: () => Promise<unknown>;
  /** Updates from GitHub (missing in builds before 1.6): only the Windows app finds any. */
  update?: {
    check(): Promise<{ version: string; page: string } | null>;
    install(progress: (fraction: number) => void): Promise<void>;
  };
}

export const desktop = (window as Window & { musikeDesktop?: DesktopBridge }).musikeDesktop;

if (desktop) {
  document.documentElement.dataset.desktop = "true";
  // Match the native window buttons to the theme picked before this script ran.
  desktop.setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
}

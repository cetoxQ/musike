import { contextBridge, ipcRenderer } from "electron";

// Where the app is (this computer, or a Musike server), asked once as the page starts.
const place = ipcRenderer.sendSync("musike:server") as { server: string | null; last: string };

// The only bridge between the web app and the desktop shell.
contextBridge.exposeInMainWorld("musikeDesktop", {
  platform: process.platform,
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("musike:theme", theme),
  setLanguage: (lang: string) => ipcRenderer.send("musike:lang", lang),
  retry: () => ipcRenderer.send("musike:retry"),
  /** The Musike server the app shows, or null for this computer's own library; and the last server used. */
  server: place.server,
  lastServer: place.last,
  /** Switches to a Musike server (or back to this computer with null): the app starts over there. */
  connect: (url: string | null) => ipcRenderer.invoke("musike:connect", url),
  /** This computer's own library, to copy into an account on the server. */
  localLibrary: () => ipcRenderer.invoke("musike:local-library"),
  /** A newer release on GitHub, or null; installing it downloads it, runs it and closes the app. */
  update: {
    check: () => ipcRenderer.invoke("musike:update-check"),
    install: (progress: (fraction: number) => void) => {
      const listener = (_e: unknown, fraction: number) => progress(fraction);
      ipcRenderer.on("musike:update-progress", listener);
      return ipcRenderer.invoke("musike:update-install").finally(() => ipcRenderer.off("musike:update-progress", listener));
    },
  },
});

import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { LibraryStorage } from "../../../server/src/library";

const where = { directory: Directory.Data, encoding: Encoding.UTF8 } as const;

async function readText(path: string): Promise<string | null> {
  try {
    const { data } = await Filesystem.readFile({ path, ...where });
    return typeof data === "string" ? data : await data.text();
  } catch {
    return null;
  }
}

/**
 * A library in the app's private storage. Each save goes to a temp file first and then replaces the real one,
 * so a crash mid-write can't leave a half-written library; if it happens between the two steps, the temp file
 * is the newest complete copy.
 */
export function fileStorage(file: string): LibraryStorage & { remove(): Promise<void> } {
  const tmp = file.replace(/\.json$/, "") + ".tmp.json";
  return {
    read: async () => (await readText(file)) ?? (await readText(tmp)),
    write: async (json) => {
      await Filesystem.writeFile({ path: tmp, data: json, ...where });
      await Filesystem.deleteFile({ path: file, directory: Directory.Data }).catch(() => {});
      await Filesystem.rename({ from: tmp, to: file, directory: Directory.Data, toDirectory: Directory.Data });
    },
    remove: async () => {
      for (const path of [file, tmp]) await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => {});
    },
  };
}

/** The phone's own library. */
export const nativeStorage = fileStorage("library.json");

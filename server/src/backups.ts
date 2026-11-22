import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { ServerLibrary } from "./storage.js";

const NAME = /^musike-\d{4}-\d{2}-\d{2}\.(db|json)$/;

/**
 * A copy of the library every day, in <data>/backups, keeping the newest MUSIKE_BACKUPS (7; 0 turns them off):
 * musike.db copied whole and consistent while Musike runs (VACUUM INTO), or library.json as it is. Restoring is
 * copying one back over musike.db (or library.json) with Musike stopped. They're in the same volume as the library:
 * against mistakes and a damaged file, not a lost disk, so copy the folder elsewhere too.
 */
export function keepBackups(store: ServerLibrary, keep = config.backups): () => void {
  if (keep <= 0) return () => {};
  const dir = path.join(config.dataDir, "backups");

  async function backUp() {
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `musike-${new Date().toISOString().slice(0, 10)}.${store.kind === "sqlite" ? "db" : "json"}`);
    if (existsSync(file)) return; // today's is made
    const part = `${file}.part`;
    await rm(part, { force: true });
    if (store.db) store.db.prepare("VACUUM INTO ?").run(part);
    else if (existsSync(path.join(config.dataDir, "library.json"))) await copyFile(path.join(config.dataDir, "library.json"), part);
    else return;
    await rename(part, file);
    const old = (await readdir(dir)).filter((n) => NAME.test(n)).sort().reverse().slice(keep);
    for (const name of old) await rm(path.join(dir, name), { force: true });
  }

  const run = () => backUp().catch((e: Error) => console.warn(`  Library backup failed: ${e.message}`));
  // A minute after starting (not while it starts), then looked at every few hours: one copy a day.
  const first = setTimeout(run, 60_000);
  const daily = setInterval(run, 4 * 3600_000);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}

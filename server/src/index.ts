import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { startServer } from "./app.js";
import { accounts as accountsOf } from "./auth.js";
import { config } from "./config.js";
import { openDb } from "./db.js";

// Command line, next to the running server (e.g. docker compose exec musike node server.mjs reset-password ava):
// a forgotten password, the owner's included, which no admin can reset from the app.
if (process.argv[2] === "reset-password") {
  const username = process.argv[3];
  if (!username) {
    console.error("Usage: reset-password <username>");
    process.exit(2);
  }
  const db = await openDb(path.join(config.dataDir, "musike.db"));
  try {
    const { user, password } = await accountsOf(db).resetByName(username);
    console.log(`Temporary password for ${user.username}: ${password}`);
    console.log("Their devices were signed out; the new password is chosen at the next sign-in.");
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
  process.exit();
}

const { port, tools, library, accounts } = await startServer();

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => `http://${i!.address}:${port}`);
console.log(`\n  Musike is running`);
console.log(`  Local:   http://localhost:${port}`);
for (const url of lan) console.log(`  Network: ${url}`);
if (!existsSync(config.webDist)) console.log(`  (web app not built: run "pnpm build" or use "pnpm dev")`);
console.log(`  yt-dlp:  ${tools.ytdlp ?? "NOT FOUND (install it from Musike's Settings)"}${config.ytdlpChannel ? ` (kept on ${config.ytdlpChannel})` : ""}`);
if (!tools.deno) console.log(`  Deno:    not found (YouTube may fail without it)`);
if (!tools.ffmpeg) console.log(`  FFmpeg:  not found (HD video unavailable)`);
console.log(`  Data:    ${path.relative(process.cwd(), config.dataDir) || config.dataDir}`);
console.log(`  Library: ${library === "sqlite" ? "musike.db (SQLite)" : "library.json"}`);
console.log(
  `  Accounts: ${accounts === "off" ? "off" : accounts === "setup" ? "on, waiting for the admin: open Musike in a browser to choose the password" : "on"}\n`,
);

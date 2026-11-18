import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";

// Defenses that don't depend on accounts: what other sites can make a browser do to Musike, and the headers that
// tell browsers how to treat Musike's pages.

const CHANGES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** "host:port" of an origin, or "" when it isn't one ("null" from sandboxed frames and files). */
function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
}

/**
 * Requests that change something must come from Musike's own pages. Browsers send Origin with every such
 * request; a page on another site (or another port of the same address, which the cookie's SameSite doesn't
 * cover) gets refused. Requests without Origin (curl, scripts) and apps using "Authorization: Bearer" (no cookie
 * to borrow) aren't affected. Behind a proxy that rewrites Host, list the public address in MUSIKE_ALLOWED_ORIGINS.
 */
export function sameOriginWrites(app: FastifyInstance) {
  const extra = new Set(config.allowedOrigins.map(hostOf).filter(Boolean));
  app.addHook("onRequest", async (req: FastifyRequest) => {
    if (!CHANGES.has(req.method) || !req.url.startsWith("/api/")) return;
    if (req.headers.authorization?.startsWith("Bearer ")) return;
    const origin = req.headers.origin;
    if (origin === undefined) return;
    const from = hostOf(origin);
    if (from && (from === req.host || from === req.headers.host || extra.has(from))) return;
    app.log.warn(
      { event: "cross_origin_refused", origin, host: req.host, ip: req.ip },
      "request from another origin refused (behind a proxy: forward the Host header, or set MUSIKE_ALLOWED_ORIGINS)",
    );
    throw new HttpError(403, msg("crossOrigin"));
  });
  // Only JSON bodies: a form on another site can post text/plain without asking the browser first.
  app.removeContentTypeParser("text/plain");
  // An empty body is fine whatever its label: Android's HTTP stack (and curl -d '') label a POST without a body as a
  // form. Anything else that isn't JSON is refused.
  app.addContentTypeParser("*", { parseAs: "string", bodyLimit: 1024 }, (_req, body, done) => {
    if (body === "") done(null, undefined);
    else done(new HttpError(415, msg("jsonOnly")), undefined);
  });
}

/** The inline scripts of the built index.html, as CSP hashes (recomputed when the file changes). */
function inlineScriptHashes(webDist: string): () => string[] {
  const file = path.join(webDist, "index.html");
  let cached: { mtime: number; hashes: string[] } | null = null;
  return () => {
    try {
      const mtime = statSync(file).mtimeMs;
      if (cached?.mtime !== mtime) {
        const html = readFileSync(file, "utf8");
        const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
          (m) => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`,
        );
        cached = { mtime, hashes };
      }
      return cached.hashes;
    } catch {
      return [];
    }
  };
}

/**
 * Headers on every answer: no framing by other sites, no MIME sniffing, no referrer sent to other sites,
 * API answers never cached (they're per user), and a Content-Security-Policy on the pages: scripts only from
 * Musike itself (and its one inline script, by hash), artwork from https, nothing else from outside.
 */
export function securityHeaders(app: FastifyInstance, webDist: string) {
  const hashes = inlineScriptHashes(webDist);
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "same-origin");
    const url = req.url;
    if (url.startsWith("/api/") && !url.startsWith("/api/stream/") && !reply.hasHeader("cache-control")) {
      reply.header("cache-control", "no-store");
    }
    if (String(reply.getHeader("content-type") ?? "").startsWith("text/html")) {
      reply.header(
        "content-security-policy",
        [
          "default-src 'self'",
          `script-src 'self' ${hashes().join(" ")}`.trim(),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          "media-src 'self' blob: data:",
          "font-src 'self' data:",
          "connect-src 'self'",
          "worker-src 'self'",
          "manifest-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join("; "),
      );
    }
    return payload;
  });
}

/**
 * At most this many password checks (scrypt: 32 MB and about 100 ms each) at once, whoever asks. Beyond it,
 * a sign-in is refused right away instead of queueing: a flood can't pile up work or memory.
 */
export function passwordGate(max = 8) {
  let running = 0;
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (running >= max) throw new HttpError(429, msg("tooManyAttempts", { seconds: 2 }));
    running++;
    try {
      return await fn();
    } finally {
      running--;
    }
  };
}

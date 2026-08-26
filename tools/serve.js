/* =============================================================================
   serve — the development server.

   Deliberately dependency-free. ES modules are refused by the browser unless
   the .js response carries a JavaScript MIME type, and the file has to be
   reachable from any Host header so it can be proxied or tunnelled. Those two
   requirements are the whole reason this file exists rather than `npx serve`.
   ============================================================================= */

import { createServer } from "node:http";
import { createReadStream, statSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const PORT = Number(process.env.PORT || 3000);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/* The data file is the one asset that must never be held in a stale cache while
   it is being iterated on; everything else can be cached briefly. */
const NO_CACHE = new Set([".json"]);

createServer((req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
  catch { res.writeHead(400).end("Bad request"); return; }

  if (path === "/") path = "/index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("Forbidden"); return; }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end(`404 — ${path}`);
    return;
  }

  const ext = extname(file);
  res.writeHead(200, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Content-Length": statSync(file).size,
    "Cache-Control": NO_CACHE.has(ext) ? "no-store" : "public, max-age=0, must-revalidate",
    "Access-Control-Allow-Origin": "*",
  });
  if (req.method === "HEAD") { res.end(); return; }
  createReadStream(file).pipe(res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Archive dev server → http://0.0.0.0:${PORT}  (root: ${ROOT})`);
});

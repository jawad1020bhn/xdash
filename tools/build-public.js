/* =============================================================================
   build-public — assemble the deployable site into public/

   The app itself is build-free: ES modules served straight off disk. But a
   static host (Vercel) wants a single output directory, and the repo root is
   not that directory — it also holds the 17.7 MB capture export, the build
   tools, the docs and the dev server. This script copies exactly the files
   the browser loads into public/, nothing more:

     index.html  offline.html  manifest.webmanifest  sw.js
     src/  styles/  icons/  data/posts.slim.json

   POSTS.json is deliberately NOT copied. The loader prefers the slim
   projection (src/core/data.js) and only falls back to the export when no
   projection exists, so shipping the raw capture would add 17.7 MB to every
   deployment for a file no visitor ever downloads.

   The slim projection is regenerated first; if POSTS.json is absent but a
   previously built projection is on disk, the build continues with a warning
   rather than failing the deploy.

   Usage:  npm run build          (build-slim, then this)
   Output: public/  — declared as "outputDirectory" in vercel.json
   ============================================================================= */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

/* Every path the deployed site needs, relative to the repo root. */
const FILES = ["index.html", "offline.html", "manifest.webmanifest", "sw.js"];
const DIRS = ["src", "styles", "icons", "data"];

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

function walkSize(path) {
  const st = statSync(path);
  if (st.isFile()) return st.size;
  let total = 0;
  for (const child of readdirSync(path)) total += walkSize(join(path, child));
  return total;
}

function main() {
  /* 1 · Refresh the projection. A missing POSTS.json is survivable when an
     earlier projection is already on disk. */
  try {
    execFileSync(process.execPath, [join(ROOT, "tools", "build-slim.js")], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    if (!existsSync(join(ROOT, "data", "posts.slim.json"))) {
      console.error(
        "build-slim failed and no data/posts.slim.json exists — cannot deploy an empty archive.",
      );
      process.exit(1);
    }
    console.warn("build-slim failed; continuing with the existing data/posts.slim.json.");
  }

  /* 2 · Start from a clean slate so removed files never linger in the output. */
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  /* 3 · Copy the site. */
  let bytes = 0;
  const copy = (rel, options) => {
    const src = join(ROOT, rel);
    if (!existsSync(src)) {
      console.error(`Missing required path: ${rel}`);
      process.exit(1);
    }
    cpSync(src, join(OUT, rel), options);
    bytes += walkSize(src);
  };

  for (const file of FILES) copy(file);
  for (const dir of DIRS) copy(dir, { recursive: true });

  console.log("");
  console.log(`public/  ${mb(bytes)} — site assembled for deployment`);
  console.log(`output → public/ (declared as "outputDirectory" in vercel.json)`);
}

main();

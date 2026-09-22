/**
 * scripts/build-demo.mjs
 *
 * Builds the public demo served from https://ys941.github.io/instapilot-ai/.
 *
 * The demo is a static export: the dashboard runs against a fictional channel,
 * with /api answered in the browser by lib/demo/api.ts from fixtures generated
 * by scripts/demo/make-fixtures.cjs. Everything that needs a server — the API
 * routes, the auth proxy and the startup instrumentation — is taken out of the
 * build and restored from git afterwards, even if the build fails, so running
 * this locally leaves the working tree as it was.
 *
 *   npm run build:demo      → out/
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BASE_PATH = "/instapilot-ai";
const SERVER_ONLY = ["app/api", "proxy.ts", "instrumentation.ts"];

const git = (args) => execFileSync("git", args, { encoding: "utf8" });
const run = (cmd, args, env) =>
  execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env });

const dirty = git(["status", "--porcelain", "--", ...SERVER_ONLY]).trim();
if (dirty) {
  console.error("Uncommitted changes in files this build removes and restores:\n" + dirty);
  process.exit(1);
}

const env = { ...process.env, NEXT_PUBLIC_DEMO: "1", NEXT_PUBLIC_BASE_PATH: BASE_PATH };

// Fixtures and cards for the fictional channel → public/demo/ (git-ignored).
run("node", ["scripts/demo/make-fixtures.cjs"], env);

for (const path of SERVER_ONLY) rmSync(path, { recursive: true, force: true });
try {
  run("npx", ["next", "build"], env);
} finally {
  for (const path of SERVER_ONLY) if (!existsSync(path)) git(["checkout", "--", path]);
}

// Next 16 exports route-group prefetch data as nested folders
// (`__next.<group>/settings/__PAGE__.txt`) but the client requests dot-joined
// names (`__next.<group>.settings.__PAGE__.txt`). Write flattened copies so a
// static host serves what the client asks for.
function flattenSegmentData(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (!statSync(full).isDirectory()) continue;
    if (name.startsWith("__next.")) {
      const walk = (d) => {
        for (const f of readdirSync(d)) {
          const p = join(d, f);
          if (statSync(p).isDirectory()) walk(p);
          else copyFileSync(p, join(dir, `${name}.${relative(full, p).split(sep).join(".")}`));
        }
      };
      walk(full);
    } else {
      flattenSegmentData(full);
    }
  }
}
flattenSegmentData("out");

/**
 * lib/attribution.server.ts
 *
 * Server-only attribution enforcement. Never import this from a client
 * component — it uses `node:fs`. Client code should import AUTHOR from
 * `./attribution` instead.
 *
 * Two checks run once, when the server starts:
 *
 *   1. ACKNOWLEDGEMENT — ATTRIBUTION_ACK must be set to the author's profile.
 *   2. VISIBLE CREDIT  — the dashboard footer must still render that credit.
 *
 * The second check fails only on *positive evidence* that the credit was
 * removed. If it cannot inspect anything (an unusual deployment layout, a
 * standalone bundle, a read-only filesystem) it warns and lets the app start,
 * so a legitimate deployment is never broken by a check that simply could not
 * see the file.
 *
 * Removing these checks does not remove the obligation — see LICENSE clause 2.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { AUTHOR, hasAttributionAck } from "./attribution";

export { AUTHOR, hasAttributionAck };

/** Source files that are expected to render the credit. */
const FOOTER_SOURCES = [
  join("components", "dashboard", "Footer.tsx"),
  join("src", "components", "dashboard", "Footer.tsx"),
];

/** A footer still wired to the credit references both of these. */
const SOURCE_MARKERS = ["AUTHOR.url", "AUTHOR.handle"] as const;

export type CreditCheck =
  | { status: "ok"; where: string }
  | { status: "missing"; where: string }
  | { status: "unverifiable"; reason: string };

/** Looks for the literal author URL inside the built output (bounded scan). */
function creditInBuild(root: string): boolean | null {
  const buildDir = join(root, ".next", "server");
  if (!existsSync(buildDir)) return null;

  let filesRead = 0;
  const MAX_FILES = 400;

  const walk = (dir: string): boolean => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (filesRead >= MAX_FILES) return false;
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        if (walk(full)) return true;
        continue;
      }
      if (!/\.(js|mjs|cjs)$/.test(entry) || s.size > 4_000_000) continue;
      filesRead++;
      try {
        if (readFileSync(full, "utf8").includes(AUTHOR.url)) return true;
      } catch {
        /* unreadable, keep going */
      }
    }
    return false;
  };

  return walk(buildDir);
}

/** Verifies the dashboard still credits the author. */
export function checkVisibleCredit(root = process.cwd()): CreditCheck {
  for (const rel of FOOTER_SOURCES) {
    const full = join(root, rel);
    if (!existsSync(full)) continue;
    let src: string;
    try {
      src = readFileSync(full, "utf8");
    } catch {
      return { status: "unverifiable", reason: `${rel} could not be read` };
    }
    const intact =
      SOURCE_MARKERS.every((m) => src.includes(m)) || src.includes(AUTHOR.url);
    return intact
      ? { status: "ok", where: rel }
      : { status: "missing", where: rel };
  }

  const inBuild = creditInBuild(root);
  if (inBuild === true) return { status: "ok", where: ".next build output" };
  if (inBuild === false) return { status: "missing", where: ".next build output" };

  return { status: "unverifiable", reason: "no footer source or build output found" };
}

const ackFailure = `
────────────────────────────────────────────────────────────────────────
  This project will not start without attribution.

  It is free to use, fork, rebrand and sell — the one condition is that
  credit to the original author stays visible. That is clause 2 of the
  LICENCE, not a preference.

  Add this to your .env.local (or your host's environment):

      ATTRIBUTION_ACK="${AUTHOR.url}"

  Nothing is transmitted. No network call is made, no telemetry is
  collected, no licence server is contacted — the value is compared to a
  string in this file and that is all.

  Built by ${AUTHOR.name} · ${AUTHOR.url}
────────────────────────────────────────────────────────────────────────
`;

const creditFailure = (where: string) => `
────────────────────────────────────────────────────────────────────────
  The author credit has been removed from ${where}.

  Clause 2 of the LICENCE requires any deployment other people can see to
  display visible credit to the original author:

      Built by ${AUTHOR.name} - ${AUTHOR.url}

  Restore the credit in the dashboard footer and the app will start.

  Everything around it is still yours: rename the app, change the colours,
  the logo, the persona, the niche. Sell it. Keep the money. Just leave
  the one line that says who built it.
────────────────────────────────────────────────────────────────────────
`;

/**
 * Runs both attribution checks. Called once from instrumentation.ts.
 * Throws if attribution is missing; warns if it cannot be verified.
 */
export function assertAttribution(): void {
  if (!hasAttributionAck()) {
    console.error(ackFailure);
    throw new Error(
      `Attribution required: set ATTRIBUTION_ACK="${AUTHOR.url}" to start this app. See LICENSE clause 2.`,
    );
  }

  const credit = checkVisibleCredit();

  if (credit.status === "missing") {
    console.error(creditFailure(credit.where));
    throw new Error(
      `Attribution required: the author credit is missing from ${credit.where}. See LICENSE clause 2.`,
    );
  }

  if (credit.status === "unverifiable") {
    console.warn(
      `[attribution] Could not verify the visible credit (${credit.reason}). ` +
        `Clause 2 of the LICENCE still requires it to be displayed.`,
    );
  }
}

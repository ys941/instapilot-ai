/**
 * lib/attribution.ts
 *
 * Attribution constants — safe to import from client components.
 *
 * Keep this file free of Node built-ins (`node:fs`, `node:path`, …). The
 * dashboard footer imports AUTHOR from here, and the footer is a client
 * component, so anything Node-only would be pulled into the browser bundle
 * and break the build. The filesystem checks live in `attribution.server.ts`.
 *
 * Clause 2 of the LICENCE requires that any deployment other people can see
 * displays visible credit to the original author.
 */

export const AUTHOR = {
  name: "Yati Bhardwaj",
  handle: "ys941",
  url: "https://github.com/ys941",
} as const;

/** Accepted forms of the acknowledgement, normalised. */
const ACCEPTED = new Set([
  "https://github.com/ys941",
  "http://github.com/ys941",
  "github.com/ys941",
  "@ys941",
  "ys941",
]);

const normalise = (v: string) => v.trim().replace(/\/+$/, "").toLowerCase();

/** True when the operator has acknowledged the attribution requirement. */
export function hasAttributionAck(): boolean {
  const raw = process.env.ATTRIBUTION_ACK;
  return typeof raw === "string" && ACCEPTED.has(normalise(raw));
}

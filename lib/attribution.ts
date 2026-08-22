/**
 * lib/attribution.ts
 *
 * Attribution requirement.
 *
 * This project is free to use, fork and build on. The one condition is that
 * credit to the original author stays visible: the dashboard footer links to
 * the author's GitHub profile, and the server refuses to boot until the
 * operator has acknowledged that condition.
 *
 * To run it, set this in your .env.local:
 *
 *     ATTRIBUTION_ACK="https://github.com/ys941"
 *
 * Removing this check is technically trivial — it is a deliberate speed bump,
 * not DRM. Please just leave the credit in.
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

function normalise(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

/** True when the operator has acknowledged the attribution requirement. */
export function hasAttributionAck(): boolean {
  const raw = process.env.ATTRIBUTION_ACK;
  return typeof raw === "string" && ACCEPTED.has(normalise(raw));
}

const FAILURE_MESSAGE = `
────────────────────────────────────────────────────────────────────────
  This project will not start without attribution.

  It is free to use, fork and build on — the one condition is that
  credit to the original author stays visible.

  Add this to your .env.local (or your host's environment):

      ATTRIBUTION_ACK="${AUTHOR.url}"

  That is the whole requirement. Nothing is sent anywhere, no network
  call is made, and no data leaves your machine — the value is only
  compared locally.

  Built by ${AUTHOR.name} · ${AUTHOR.url}
────────────────────────────────────────────────────────────────────────
`;

/**
 * Throws unless the attribution requirement has been acknowledged.
 * Called once from instrumentation.ts when the server starts.
 */
export function assertAttribution(): void {
  if (hasAttributionAck()) return;
  console.error(FAILURE_MESSAGE);
  throw new Error(
    `Attribution required: set ATTRIBUTION_ACK="${AUTHOR.url}" to start this app. See lib/attribution.ts.`,
  );
}

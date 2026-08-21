/**
 * Generates the GitHub social preview card (1280x640 PNG).
 *
 * GitHub shows this image whenever the repo is linked on X, Reddit, Slack,
 * Discord or Hacker News. Without it, shares render a generic grey card.
 *
 * Upload the result at: Settings → General → Social preview
 *
 *   node scripts/make-social-preview.mjs
 */
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const W = 1280;
const H = 640;
const SANS = "Segoe UI, Helvetica Neue, Arial, sans-serif";
const MONO = "Consolas, Menlo, monospace";

const FEATURES = [
  ["Writes", "copy, cards, carousels"],
  ["Renders", "vertical Shorts + voiceover"],
  ["Publishes", "Instagram + YouTube"],
  ["Replies", "comments &amp; DMs, in voice"],
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0D1117"/>
      <stop offset="55%" stop-color="#12182A"/>
      <stop offset="100%" stop-color="#1A1024"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#A371F7"/>
      <stop offset="100%" stop-color="#F778BA"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="6" fill="url(#accent)"/>

  <!-- title -->
  <text x="72" y="150" font-family="${SANS}" font-size="72" font-weight="700" fill="#FFFFFF">InstaPilot AI</text>

  <!-- tagline -->
  <text x="72" y="212" font-family="${SANS}" font-size="31" fill="#C9D1D9">
    An autonomous content team for Instagram + YouTube Shorts.
  </text>
  <text x="72" y="256" font-family="${SANS}" font-size="31" fill="#C9D1D9">
    Any niche. Your accounts. Your keys. <tspan fill="#F778BA" font-weight="600">Fully unattended.</tspan>
  </text>

  <!-- feature row -->
  ${FEATURES.map((f, i) => {
    const x = 72 + i * 288;
    return `<rect x="${x}" y="318" width="264" height="96" rx="10" fill="#FFFFFF" fill-opacity="0.045" stroke="#A371F7" stroke-opacity="0.32"/>
    <text x="${x + 22}" y="356" font-family="${SANS}" font-size="23" font-weight="700" fill="#A371F7">${f[0]}</text>
    <text x="${x + 22}" y="386" font-family="${SANS}" font-size="17" fill="#8B949E">${f[1]}</text>`;
  }).join("\n  ")}

  <!-- stack line -->
  <text x="72" y="486" font-family="${MONO}" font-size="20" fill="#7D8590">
    Next.js  ·  TypeScript  ·  Prisma  ·  Postgres  ·  ffmpeg  ·  self-hosted  ·  MIT
  </text>

  <!-- footer -->
  <line x1="72" y1="530" x2="${W - 72}" y2="530" stroke="#30363D"/>
  <text x="72" y="576" font-family="${MONO}" font-size="23" fill="#E6EDF3">github.com/ys941/instapilot-ai</text>
  <text x="${W - 72}" y="576" font-family="${SANS}" font-size="21" fill="#7D8590" text-anchor="end">no API keys bundled</text>
</svg>`;

writeFileSync("scripts/social-preview.svg", svg);

await sharp(Buffer.from(svg)).png().toFile("scripts/social-preview.png");
console.log("wrote scripts/social-preview.png (1280x640)");

#!/usr/bin/env node
/**
 * scripts/youtube-auth.mjs
 *
 * One-command CLI to obtain a long-lived YouTube refresh token for the app.
 *
 * It runs the OAuth "installed app" loopback flow:
 *   1. Opens Google's consent screen in your browser.
 *   2. Spins a temporary localhost server to catch the redirect automatically
 *      (no copy-pasting auth codes, no OAuth Playground).
 *   3. Exchanges the code and prints YOUTUBE_REFRESH_TOKEN.
 *
 * Prereqs (one-time, in Google Cloud Console):
 *   • Enable "YouTube Data API v3".
 *   • OAuth consent screen → set publishing status to **In production**
 *     (Testing-status apps issue refresh tokens that expire in 7 days).
 *   • Credentials → Create OAuth client ID → **Desktop app** → copy ID + secret.
 *
 * Usage (from the cardioflow-ai folder):
 *   YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/youtube-auth.mjs
 * or pass them as flags:
 *   node scripts/youtube-auth.mjs --id xxx --secret yyy
 */

import http from "http";
import { spawn } from "child_process";
import { google } from "googleapis";

// -- Parse credentials from flags or env --------------------------------------
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const CLIENT_ID     = arg("id")     ?? process.env.YOUTUBE_CLIENT_ID;
const CLIENT_SECRET = arg("secret") ?? process.env.YOUTUBE_CLIENT_SECRET;
const PORT          = Number(arg("port") ?? 4773);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Missing credentials. Provide them via env vars or flags:

  YOUTUBE_CLIENT_ID=xxx YOUTUBE_CLIENT_SECRET=yyy node scripts/youtube-auth.mjs
  node scripts/youtube-auth.mjs --id xxx --secret yyy

Create a Desktop-app OAuth client at:
  https://console.cloud.google.com/apis/credentials
`);
  process.exit(1);
}

const REDIRECT_URI = `http://localhost:${PORT}`;
// Scopes:
//   youtube.upload    — upload videos / Shorts
//   youtube.readonly  — read channel + video stats (analytics, insights)
//   youtube.force-ssl — read & reply to comments (Grok auto-replies on Shorts)
//   yt-analytics.readonly — detailed time-series analytics (optional but useful)
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",     // request a refresh token
  prompt:      "consent",     // force a fresh refresh token every run
  scope:       SCOPES,
});

// -- Open the browser (cross-platform) ----------------------------------------
function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      // Use PowerShell Start-Process — cmd's `start` mis-parses `&` in OAuth URLs,
      // truncating the URL and dropping params like response_type.
      spawn("powershell", ["-NoProfile", "-Command", "Start-Process", `'${url}'`], { stdio: "ignore", detached: true }).unref();
    } else {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch { /* ignore — URL is printed for manual paste */ }
}

console.log("\n▶ Opening Google consent screen in your browser...");
console.log("  If it doesn't open, paste this URL manually:\n");
console.log("  " + authUrl + "\n");
openBrowser(authUrl);

// -- Catch the redirect on localhost ------------------------------------------
const server = http.createServer(async (req, res) => {
  if (!req.url || !req.url.startsWith("/?")) { res.writeHead(404); res.end(); return; }
  const code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
  const err  = new URL(req.url, REDIRECT_URI).searchParams.get("error");

  if (err) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<h2>Authorization failed: ${err}</h2><p>You can close this tab.</p>`);
    console.error("\n✗ Authorization failed:", err);
    server.close(); process.exit(1);
  }
  if (!code) { res.writeHead(400); res.end("No code"); return; }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>✓ Success — the app is authorized.</h2><p>You can close this tab and return to the terminal.</p>");

    if (!tokens.refresh_token) {
      console.error(`
✗ No refresh token returned.
  This happens when you've already granted access before. Either:
    • Revoke prior access at https://myaccount.google.com/permissions and re-run, or
    • This run used prompt=consent which should force one — try again.
`);
      server.close(); process.exit(1);
    }

    console.log("\n✓ Refresh token obtained. Add these to Railway / .env.local:\n");
    console.log("YOUTUBE_CLIENT_ID="     + CLIENT_ID);
    console.log("YOUTUBE_CLIENT_SECRET=" + CLIENT_SECRET);
    console.log("YOUTUBE_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("\n(Optional) YOUTUBE_CHANNEL_ID=<your channel ID — display only>\n");
    server.close(); process.exit(0);
  } catch (e) {
    res.writeHead(500); res.end("Token exchange failed");
    console.error("\n✗ Token exchange failed:", e?.message ?? e);
    server.close(); process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`  Waiting for Google to redirect to ${REDIRECT_URI} ...`);
});

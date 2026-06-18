/**
 * lib/videoGenerator.ts
 *
 * Converts the app's rendered card images (1080×1080 JPEGs) into a vertical
 * MP4 suitable for YouTube Shorts.
 *
 * Why: YouTube only accepts video uploads, not the static image cards we publish
 * to Instagram. This module turns one card (or a carousel's worth of slides) into
 * a short, branded vertical clip with an audio track (YouTube prefers an audio
 * stream).
 *
 * Engine: ffmpeg-static (a self-contained ffmpeg binary, libx264 included) is
 * spawned directly — no system ffmpeg required, works on Railway/Nixpacks.
 *
 * Visual quality:
 *   - 720×1280 vertical (9:16) — the proven-reliable ceiling on the production
 *     container. 1080×1920 was REMOVED: the memory/CPU-constrained container
 *     stalled ffmpeg at frame=0 and SIGKILLed it on every 1080p attempt.
 *   - The branded cards are now authored 9:16 (1080×1920), so each is scaled to
 *     FILL the 720×1280 frame exactly (scale=720:1280) — no black bars. A non-9:16
 *     image (e.g. uploaded square media) falls back to scale-to-fit + pad over a
 *     flat brand-navy background so it is never cropped.
 *   - Per-card fade in/out at the cut → a clean, smooth transition between cards
 *     (cheaper and more memory-safe than an xfade filtergraph holding every
 *     full-res segment in memory at once).
 *   - No Ken Burns/zoompan motion — it was a stall/memory source on this
 *     container; a clean static slideshow with fades is the goal.
 *   - H.264 high profile, yuv420p, crf 21, +faststart, AAC 128k, preset
 *     `veryfast`, `-threads 1` (quality vs. the watchdog budget — never `slow`).
 *
 * Pipeline (kept deliberately simple, debuggable, and memory-bounded):
 *   1. Render each image to its own normalised vertical H.264 clip (one ffmpeg
 *      call per image, streaming filters — never buffers all segments at once).
 *   2. Concatenate the clips with the concat demuxer using stream-copy (fast,
 *      lossless — all clips share identical codec params). Skipped for one image.
 *   3. Mux audio (selected music faded, or silence).
 *
 * Reliability: publishing must NEVER break. The render is bounded by the SIGKILL
 * watchdog and serialised through the single-flight queue (both kept intact);
 * if it fails or times out, the caller falls back gracefully (null). The chosen
 * tier is logged.
 */

import { spawn } from "child_process";
import { mkdtemp, writeFile, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

// Brand dark navy used as a fallback letterbox background (matches the app theme).
const BG_COLOR = "0x0B1220";

// Vertical (9:16) render resolution. The production container is memory/CPU
// constrained and CANNOT encode 1080×1920 — ffmpeg stalled at `frame=0` for the
// whole watchdog window and got SIGKILLed on EVERY 1080p attempt. 720×1280 is the
// proven reliable ceiling on this container (and a fully valid Short resolution),
// so it is the ONLY render tier. The old 1080p `hd-*` tiers were removed because
// they always failed and just burned ~2× the watchdog before falling back.
const SD_WIDTH  = 720;
const SD_HEIGHT = 1280;

export interface ShortRenderOptions {
  /** Seconds each image is shown. Default 5. Shorts must stay ≤ 60s total. */
  secondsPerImage?: number;
  /** Optional PER-CARD durations (seconds), one per image. Lets the caller show the
   *  HOOK cover briefly (~2s, so viewers reach value fast → fewer instant swipe-aways)
   *  and content slides longer. Falls back to secondsPerImage for any missing entry. */
  durations?: number[];
  /** Frame rate. Default 24. */
  fps?: number;
  /** Optional background-music MP3 bytes (mixed under the video, faded). */
  audio?: Buffer | null;
  /**
   * Optional AI-narration audio (WAV/MP3 bytes) for the WHOLE Short. When present,
   * it's mixed at full volume OVER the music (which is auto-ducked) and becomes the
   * dominant track. Pair `durations` so the cards span the narration length.
   */
  voiceTrack?: Buffer | null;
  /**
   * Optional ASS subtitle document (word-by-word captions, already timed to the
   * voiceTrack from t=0). When present it's BURNED into the video. Requires a
   * re-encode of the video stream (heavier) — only used when voiceTrack is set.
   */
  assSubtitles?: string | null;
  /**
   * Force the legacy simple render path (720×1280, no Ken Burns motion).
   * Optional — existing callers omit it. Mainly an escape hatch / for tests.
   */
  legacy?: boolean;
}

/** Which render style/quality a single attempt uses. */
type RenderTier = {
  label: string;
  width: number;
  height: number;
  motion: boolean; // retained for shape compatibility; always false (720p simple slideshow only)
};

function ffmpegBin(): string {
  // Prefer the bundled static binary, but only if it actually exists on disk —
  // on some hosts (e.g. Railway/Nixpacks) ffmpeg-static's postinstall download
  // doesn't survive the build, leaving a dangling path. Fall back to a system
  // ffmpeg on PATH (installed via NIXPACKS_PKGS=ffmpeg).
  const bin = ffmpegStatic as unknown as string | null;
  if (bin && existsSync(bin)) return bin;
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  return "ffmpeg"; // resolve from PATH
}

// Hard watchdog: a wedged ffmpeg (stuck pipe, runaway encode) must never hang the
// publish loop forever. If a single ffmpeg call runs longer than this we SIGKILL it
// and reject. Each call here is one short still-card encode/concat/mux. At
// 720p/preset=veryfast a typical per-card clip finishes in a few seconds, well
// within this budget. The carousel Short now has ~7–10 cards (a ~45–60s total),
// so the bound is 180s to comfortably cover the longer per-card + concat + mux
// pipeline on the memory/CPU-constrained container without ever stalling forever.
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS) || 240_000;

/** Run ffmpeg with the given args; resolves on exit 0, rejects with stderr tail otherwise. */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), args, { windowsHide: true });
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };

    // Watchdog: SIGKILL a process that exceeds the timeout, then reject.
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      finish(() => reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s — killed`)));
    }, FFMPEG_TIMEOUT_MS);

    proc.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 20_000) stderr = stderr.slice(-20_000); });
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code, signal) => {
      finish(() => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited code=${code} signal=${signal ?? "none"}: ${stderr.split("\n").slice(-6).join(" | ")}`));
      });
    });
  });
}

// Single-flight render queue: serialize renderCardsToShortMp4 so only ONE ffmpeg
// pipeline runs at a time. Concurrent renders on a memory-limited container OOM-kill
// x264; chaining each render onto the previous one (a simple promise chain) keeps
// peak memory bounded to a single encode.
let _renderChain: Promise<unknown> = Promise.resolve();
function runSerialized<T>(task: () => Promise<T>): Promise<T> {
  const next = _renderChain.then(task, task);
  // Keep the chain alive even if a task rejects (swallow here; result propagates via `next`).
  _renderChain = next.catch(() => {});
  return next;
}

/**
 * Probe the duration (seconds) of an audio buffer via ffmpeg. Returns 0 on failure.
 * Used to size a Short's card durations to the AI narration length so the slides span
 * the voiceover. Tolerates ffmpeg's non-zero exit (an `-i`-only call has no output).
 */
export async function probeAudioDurationSec(audio: Buffer): Promise<number> {
  if (!audio || audio.length === 0) return 0;
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cf-probe-"));
    const p = join(dir, "a");
    await writeFile(p, audio);
    return await new Promise<number>((resolve) => {
      const proc = spawn(ffmpegBin(), ["-i", p], { windowsHide: true });
      let err = "";
      const t = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} resolve(0); }, 20_000);
      proc.stderr.on("data", (d) => { err += d.toString(); });
      proc.on("error", () => { clearTimeout(t); resolve(0); });
      proc.on("close", () => {
        clearTimeout(t);
        const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
      });
    });
  } catch {
    return 0;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Assemble per-card narration clips into ONE voice track, inserting `padsSec[i]`
 * seconds of trailing silence after clip i. This lets each Short card be held for a
 * MINIMUM time (the "seconds per card" setting) while keeping the voice perfectly in
 * sync: card i shows for (clip_i speech + pad_i silence), then card i+1 begins exactly
 * when clip_{i+1} starts. Returns the concatenated WAV, or null on failure.
 */
export async function assembleVoiceTrack(clips: Buffer[], padsSec: number[]): Promise<Buffer | null> {
  const present = clips.filter((c) => c && c.length > 0);
  if (present.length === 0) return null;
  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cf-voice-"));
    const inputs: string[] = [];
    const filters: string[] = [];
    const labels: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i];
      if (!c || c.length === 0) continue;
      const idx = labels.length; // ffmpeg input index (sequential as added)
      const p = join(dir, `c${idx}.wav`);
      await writeFile(p, c);
      inputs.push("-i", p);
      const pad = Math.max(0, padsSec[i] ?? 0);
      filters.push(
        `[${idx}:a]aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono` +
        (pad > 0.02 ? `,apad=pad_dur=${pad.toFixed(3)}` : "") +
        `[a${idx}]`,
      );
      labels.push(`[a${idx}]`);
    }
    if (labels.length === 0) return null;
    const out = join(dir, "voice.wav");
    const fc = `${filters.join(";")};${labels.join("")}concat=n=${labels.length}:v=0:a=1[out]`;
    await runFfmpeg(["-y", ...inputs, "-filter_complex", fc, "-map", "[out]", out]);
    return await readFile(out);
  } catch {
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Render an array of card image buffers into a single vertical Short MP4.
 * Pass one buffer for a normal post, or multiple for a carousel.
 * Returns the MP4 Buffer, or null on failure (caller should fall back gracefully).
 *
 * Signature is stable: callers pass `{ secondsPerImage, audio }`. New options are
 * optional and additive.
 */
export function renderCardsToShortMp4(
  images: Buffer[],
  opts: ShortRenderOptions = {},
): Promise<Buffer | null> {
  // Serialize all renders — only one ffmpeg pipeline runs at a time (OOM guard).
  return runSerialized(() => renderCardsToShortMp4Impl(images, opts));
}

async function renderCardsToShortMp4Impl(
  images: Buffer[],
  opts: ShortRenderOptions = {},
): Promise<Buffer | null> {
  const valid = images.filter((b) => b && b.length > 0);
  if (valid.length === 0) {
    console.warn("[VideoGen] No images supplied — cannot render Short");
    return null;
  }

  // Hard ceiling = YouTube Shorts max (~3 min). The Short's length ADAPTS to its
  // content; this is only the safety cap so a render can never run away.
  const MAX_SECS = 180;
  let perImage = Math.max(2, opts.secondsPerImage ?? 5);
  const fps    = opts.fps ?? 24;  // still cards don't need 30fps; fewer frames = lighter encode

  let used: Buffer[];
  let durations: number[];

  const voiced = !!(opts.voiceTrack && opts.voiceTrack.length > 0)
    && Array.isArray(opts.durations) && opts.durations.length > 0;

  if (voiced) {
    // VOICEOVER: the per-card durations are AUTHORITATIVE — they're already synced to
    // the assembled narration track (card i is exactly as long as its spoken segment +
    // its silence pad). So keep EVERY card and its exact duration; never drop cards or
    // rescale (that would desync the voice). Only clamp the total to the hard ceiling.
    used = valid.slice(0, opts.durations!.length);
    durations = used.map((_, i) => Math.max(1, opts.durations![i] ?? perImage));
    const total = durations.reduce((a, b) => a + b, 0);
    if (total > MAX_SECS) {
      const scale = MAX_SECS / total;
      durations = durations.map((d) => Math.max(1, d * scale));
    }
  } else {
    // SILENT/MUSIC: trim images / per-image duration to fit the ceiling.
    const maxImages = Math.min(valid.length, Math.floor(MAX_SECS / Math.max(2, perImage)) || 1);
    used = valid.slice(0, maxImages);
    if (used.length * perImage > MAX_SECS) perImage = Math.floor(MAX_SECS / used.length);
    durations = used.map((_, i) => Math.max(2, Math.round(opts.durations?.[i] ?? perImage)));
    const total = durations.reduce((a, b) => a + b, 0);
    if (total > MAX_SECS) {
      const scale = MAX_SECS / total;
      durations = durations.map((d) => Math.max(2, Math.floor(d * scale)));
    }
  }

  // ── Render tier ──────────────────────────────────────────────────────────
  // 720×1280 is the ONLY tier: it is the proven-reliable ceiling on the
  // production container. The 1080p `hd-premium`/`hd-simple` tiers were removed
  // because they ALWAYS stalled at frame=0 and got SIGKILLed, wasting the
  // watchdog budget before this 720p path took over anyway. A clean, reliable
  // 720p slideshow with per-card fades + music mux (the former "sd-simple") is
  // the goal — no Ken Burns/zoompan (a likely stall/memory source here).
  const tiers: RenderTier[] = [
    { label: "sd-simple", width: SD_WIDTH, height: SD_HEIGHT, motion: false },
  ];

  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];
    try {
      const buf = await renderWithTier(used, durations, fps, opts.audio ?? null, tier, opts.voiceTrack ?? null, opts.assSubtitles ?? null);
      if (buf && buf.length > 0) {
        console.log(`[VideoGen] Rendered ${used.length}-card Short via "${tier.label}" (${tier.width}x${tier.height}, ${Math.round(buf.length / 1024)} KB, music=${opts.audio ? "yes" : "no"}, voice=${opts.voiceTrack ? "yes" : "no"}, captions=${opts.assSubtitles ? "yes" : "no"})`);
        return buf;
      }
      console.warn(`[VideoGen] Tier "${tier.label}" produced empty output — falling back`);
    } catch (err: any) {
      const isLast = t === tiers.length - 1;
      const msg = err?.message ?? String(err);
      if (isLast) console.error(`[VideoGen] Final tier "${tier.label}" failed:`, msg);
      else console.warn(`[VideoGen] Tier "${tier.label}" failed (${msg}) — falling back to "${tiers[t + 1].label}"`);
    }
  }

  console.error("[VideoGen] All render tiers failed — no Short produced");
  return null;
}

/**
 * Render the full pipeline (per-card clips → concat → audio mux) at one tier.
 * Throws on ffmpeg failure/timeout so the caller can fall back.
 */
async function renderWithTier(
  used: Buffer[],
  durations: number[],
  fps: number,
  audio: Buffer | null,
  tier: RenderTier,
  voiceTrack: Buffer | null = null,
  assSubtitles: string | null = null,
): Promise<Buffer> {
  const { width, height } = tier;
  const totalDuration = durations.reduce((a, b) => a + b, 0);

  let dir: string | null = null;
  try {
    dir = await mkdtemp(join(tmpdir(), "cf-short-"));

    // Per-card fade is the "transition": a fade-in opens each clip and a fade-out
    // closes it, so consecutive clips dissolve through black at the cut. This is
    // far cheaper and more memory-safe than an xfade filtergraph (which would have
    // to hold every full-res segment in memory simultaneously at 1080p).
    const clipPaths: string[] = [];
    for (let i = 0; i < used.length; i++) {
      const perImage = Math.max(2, durations[i] ?? durations[0] ?? 5);
      const fadeDur = Math.min(0.4, perImage / 4); // ~0.3–0.4s, never longer than the clip
      const fadeOutStartClip = Math.max(0, perImage - fadeDur);
      const imgPath  = join(dir, `img-${i}.jpg`);
      const clipPath = join(dir, `clip-${i}.mp4`);
      await writeFile(imgPath, used[i]);

      // BOTH tiers feed the still as a looped, time-bounded input
      // (`-loop 1 -t <secs>`) — the SAME shape as the proven-reliable simple
      // path. This is the fix for the production frame=0 deadlock: the old
      // premium path fed the image ONCE (`-i imgPath`) and then split it into a
      // 1-frame blurred background and a multi-frame zoompan foreground. The
      // `overlay` of a 1-frame input against a multi-frame input never produced
      // a single output frame on the weak container CPU (it sat at
      // `frame= 0 … time=N/A` until the watchdog SIGKILLed it). Looping the
      // input gives every branch the SAME continuous frame stream, so overlay
      // pairs frames immediately and the encoder starts emitting at once.
      //
      // Output is explicitly BOUNDED by `-frames:v` (= perImage*fps) in addition
      // to the `-t` on the input, so no invocation can ever sit unbounded at
      // frame=0.
      const frames = Math.max(1, Math.round(perImage * fps));
      const inputArgs = ["-loop", "1", "-t", String(perImage), "-i", imgPath];

      // Decide FILL vs CONTAIN per card by its aspect ratio. The cards are now
      // authored 9:16 (1080×1920) to match the 720×1280 (9:16) video, so they
      // FILL the frame exactly (scale=720:1280, no black bars). If a non-9:16
      // image ever comes through (e.g. an uploaded square/landscape media image),
      // fall back to the old contain/pad behaviour so it's never cropped.
      const is916 = await isNineBySixteen(used[i], width, height);
      const filter = is916
        ? buildFillFilter(width, height, fadeDur, fadeOutStartClip)
        : buildSimpleFilter(width, height, fadeDur, fadeOutStartClip);

      await runFfmpeg([
        "-y",
        "-threads", "1",                         // cap memory/CPU — containers OOM-kill multi-thread x264
        ...inputArgs,
        "-filter_complex", filter,
        "-r", String(fps),
        "-frames:v", String(frames),             // hard output-frame bound — can never stall unbounded
        "-c:v", "libx264",
        "-profile:v", "high",
        "-preset", "veryfast",                   // fast preset — balance quality vs the watchdog budget
        "-crf", "21",
        "-pix_fmt", "yuv420p",
        "-an",
        "-movflags", "+faststart",
        clipPath,
      ]);
      clipPaths.push(clipPath);
    }

    // ── Concat the silent clips (stream copy — all share identical codec params) ──
    let videoPath = clipPaths[0];
    if (clipPaths.length > 1) {
      const listPath = join(dir, "list.txt");
      await writeFile(listPath, clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
      videoPath = join(dir, "video.mp4");
      await runFfmpeg([
        "-y", "-f", "concat", "-safe", "0", "-i", listPath,
        "-c", "copy", "-movflags", "+faststart", videoPath,
      ]);
    }

    // ── Add audio — voiceover (+ducked music +burned captions), music, or silence ──
    const outPath = join(dir, "out.mp4");
    if (voiceTrack && voiceTrack.length > 0) {
      // VOICEOVER: narration at full volume OVER ducked music, with optional burned-in
      // word-by-word captions. Burning captions requires a video re-encode (heavier);
      // when there are no captions the video is stream-copied (light) and only audio is
      // (re)muxed. Only reached when narration is enabled (the Settings toggle).
      const voicePath = join(dir, "voice.wav");
      await writeFile(voicePath, voiceTrack);
      const fadeOutStart = Math.max(0, totalDuration - 2);
      const burn = !!(assSubtitles && assSubtitles.trim());
      const fc: string[] = [];
      if (burn) {
        const assPath = join(dir, "subs.ass");
        await writeFile(assPath, assSubtitles!);
        // Linux production paths have no special chars; escape colons/backslashes defensively.
        const esc = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        // Supply the bundled caption font so the captions render in our font (libass
        // would otherwise fall back to a system default — Arial doesn't exist on Linux).
        const fontsDir = join(process.cwd(), "public", "fonts").replace(/\\/g, "/").replace(/:/g, "\\:");
        fc.push(`[0:v]subtitles=${esc}:fontsdir=${fontsDir}[v]`);
      }
      const inputs: string[] = ["-i", videoPath, "-i", voicePath];
      if (audio && audio.length > 0) {
        const musicPath = join(dir, "music.mp3");
        await writeFile(musicPath, audio);
        inputs.push("-stream_loop", "-1", "-i", musicPath);
        // Keep the music well under the narration so the voice stays crisp & clear.
        fc.push(`[2:a]volume=0.06,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2[mu]`);
        fc.push(`[1:a]volume=1.0[vo]`);
        fc.push(`[vo][mu]amix=inputs=2:duration=first:dropout_transition=0[a]`);
      } else {
        fc.push(`[1:a]volume=1.0[a]`);
      }
      const vmap   = burn ? "[v]" : "0:v";
      const vcodec = burn
        ? ["-c:v", "libx264", "-profile:v", "high", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p"]
        : ["-c:v", "copy"];
      await runFfmpeg([
        "-y",
        "-threads", "1",
        ...inputs,
        "-filter_complex", fc.join(";"),
        "-map", vmap, "-map", "[a]",
        ...vcodec,
        "-c:a", "aac", "-b:a", "128k",
        "-t", String(totalDuration),
        "-movflags", "+faststart",
        outPath,
      ]);
    } else if (audio && audio.length > 0) {
      const musicPath = join(dir, "music.mp3");
      await writeFile(musicPath, audio);
      const fadeOutStart = Math.max(0, totalDuration - 2);
      // Loop the track if it's shorter than the video; fade in/out; gentle volume.
      const audioFilter = `volume=0.32,afade=t=in:st=0:d=1,afade=t=out:st=${fadeOutStart}:d=2`;
      await runFfmpeg([
        "-y",
        "-i", videoPath,
        "-stream_loop", "-1", "-i", musicPath,
        "-filter_complex", `[1:a]${audioFilter}[a]`,
        "-map", "0:v", "-map", "[a]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
        "-t", String(totalDuration),
        "-movflags", "+faststart",
        outPath,
      ]);
    } else {
      await runFfmpeg([
        "-y",
        "-i", videoPath,
        "-f", "lavfi", "-t", String(totalDuration), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
        "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
        "-shortest",
        "-movflags", "+faststart",
        outPath,
      ]);
    }

    return await readFile(outPath);
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Is this card image 9:16 (within tolerance), i.e. the SAME aspect as the
 * 720×1280 video? When true we FILL the frame exactly (no black bars). Best-effort:
 * probes with sharp; on any failure assumes the target aspect (the branded cards are
 * always authored 9:16 now), so the common path never pays for a probe miss.
 */
async function isNineBySixteen(img: Buffer, width: number, height: number): Promise<boolean> {
  const target = width / height; // 720/1280 = 0.5625
  try {
    const meta = await sharp(img).metadata();
    if (!meta.width || !meta.height) return true; // assume target (cards are 9:16)
    const ar = meta.width / meta.height;
    return Math.abs(ar - target) < 0.02; // ~3.5% tolerance
  } catch {
    return true; // assume target — branded cards are 9:16
  }
}

/**
 * FILL filter: the card and the video are BOTH 9:16, so a straight
 * `scale=720:1280` fills the frame perfectly — no letterbox pad, no black bars.
 * Per-card fade in/out gives the clean transition. Fed a looped, time-bounded
 * still (`-loop 1 -t`) and hard-capped by `-frames:v` at the call site, so it can
 * never sit unbounded at frame=0.
 */
function buildFillFilter(
  width: number,
  height: number,
  fadeDur: number,
  fadeOutStart: number,
): string {
  return [
    `[0:v]scale=${width}:${height},` +
      `fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${fadeOutStart}:d=${fadeDur},setsar=1,format=yuv420p`,
  ].join(";");
}

/**
 * The 720p clip filter: card centred over a flat brand-navy background via
 * scale + pad (no blur, no Ken Burns/zoompan) + per-card fade in/out for a clean
 * transition. This is the EXACT graph that ran reliably as "sd-simple" on the
 * production container; zoompan/overlay-based motion was removed because it
 * stalled the encoder at frame=0 there. Fed a looped, time-bounded still
 * (`-loop 1 -t`) and hard-capped by `-frames:v` at the call site, so it can
 * never sit unbounded at frame=0. Used as the FALLBACK for any non-9:16 image so
 * it is contained (never cropped) instead of filled.
 */
function buildSimpleFilter(
  width: number,
  height: number,
  fadeDur: number,
  fadeOutStart: number,
): string {
  return [
    `[0:v]scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${BG_COLOR},` +
      `fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${fadeOutStart}:d=${fadeDur},setsar=1,format=yuv420p`,
  ].join(";");
}

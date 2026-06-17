/**
 * lib/renderLock.ts
 *
 * Process-wide single-flight lock for MEMORY-HEAVY media renders (YouTube Short
 * builds + Instagram carousel renders).
 *
 * WHY: the Railway container is memory-constrained. A Short build holds ~10 large
 * card JPEG buffers (1080×1920) + a 2.5–4 MB music buffer + the final MP4 buffer in
 * memory at once. Multiple publish triggers — the 30 s /api/scheduler/check route,
 * the 5 min runCatchup interval, and the auto-publish path — are NOT coordinated, so
 * two builds could run concurrently and OOM-kill the process (observed in prod:
 * interleaved [SlideGen] slide renders → "Killed" / "Stopping Container").
 *
 * The ffmpeg stage already had its own mutex, but the heavy slide/music work runs
 * BEFORE ffmpeg, outside it. This lock wraps the ENTIRE build so only ONE render is
 * ever in memory at a time, across every trigger. It is a FIFO promise chain: each
 * caller awaits the previous one, then runs, then releases — work is serialized, not
 * dropped, so nothing is lost, only queued.
 */

let _chain: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` exclusively — only one render runs process-wide at a time. Callers queue
 * behind each other (FIFO). The lock is always released even if `fn` throws.
 */
export function withRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  // Chain onto the previous job; swallow its result/err so one caller's failure
  // never rejects the next caller's wait.
  const run = _chain.then(fn, fn);
  // Advance the chain to this job's settlement (success OR failure) so the next
  // caller waits for THIS render to finish before starting.
  _chain = run.then(() => undefined, () => undefined);
  return run;
}

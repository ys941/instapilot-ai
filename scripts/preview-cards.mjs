/**
 * scripts/preview-cards.mjs
 *
 * Renders one card per content type through the real generator
 * (lib/postTypeImageGenerator.ts) into public/previews/, so you can eyeball a
 * design change without generating posts. Needs no database: the brand falls
 * back to the neutral defaults when the DB is unreachable.
 *
 *   node scripts/preview-cards.mjs
 *
 * The sample copy is deliberately generic — the cards take their niche,
 * handle and labels from the brand configured in Settings.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "previews");
fs.mkdirSync(outDir, { recursive: true });

// Fail fast instead of waiting on a database that isn't there.
process.env.DATABASE_URL ||= "postgresql://preview:preview@127.0.0.1:1/preview?connect_timeout=1";

// jiti (installed with Tailwind) runs the TypeScript generator directly.
const require = createRequire(import.meta.url);
const jiti = require("jiti")(path.join(root, "scripts", "preview-cards.mjs"), {
  alias: { "@": root },
  interopDefault: true,
});
const { renderPostToJpeg } = jiti(path.join(root, "lib", "postTypeImageGenerator.ts"));

const quizOptions = "A. Option one\nB. Option two\nC. Option three\nD. Option four";

const SAMPLES = {
  EDUCATIONAL: { hook: "Three ideas worth knowing", content: "- The first idea, explained in one line\n- The second idea, with a concrete number\n- The third idea, and why it matters" },
  QUIZ: { hook: "Which of these is true?", content: `QUESTION: Which of these is true?\n${quizOptions}` },
  MYTH_FACT: { hook: "The common belief everyone repeats", content: "MYTH: The common belief everyone repeats\nFACT: What the evidence actually shows\nTHE EVIDENCE:\n- A supporting point with a source" },
  PRO_TIP: { hook: "One tip that saves you an hour a week", content: "THE EVIDENCE:\n- Why it works, in one sentence\nHOW TO APPLY IT:\n- The first step to take today\nREMEMBER: small habits compound" },
  CASE_STUDY: { hook: "How one small change doubled the result", content: "THE SETUP: Where things started\nKEY DETAILS:\n- What was going on\nTHE APPROACH:\n- What was tried\nOUTCOME: What happened next" },
  IMAGE_QUIZ: { hook: "Can you spot what's wrong here?", content: `SETUP: A photo of the finished result\nWHAT YOU SEE:\n- One clue\n- Another clue\nQUESTION: What went wrong?\n${quizOptions}` },
  KNOWLEDGE_QUIZ: { hook: "What's the right answer?", content: `SETUP: A realistic situation\nKEY POINTS:\n- A fact to weigh up\n- Another fact to weigh up\nQUESTION: What's the answer?\n${quizOptions}` },
  PREVENTIVE: { hook: "Five steps to get started", content: "- Step one\n- Step two\n- Step three\n- Step four\n- Step five" },
  CTA: { hook: "Follow for more like this", content: "", cta: "Follow for more!" },
  REEL: { hook: "Watch this before you start", content: "Hook, three quick points, and a call to action.", reelScript: "HOOK (0-3s): Watch this before you start\nPOINT 1: The first thing\nPOINT 2: The second thing\nCTA: Follow for more" },
};

for (const [postType, s] of Object.entries(SAMPLES)) {
  const buf = await renderPostToJpeg({
    postType,
    title: postType,
    hook: s.hook,
    content: s.content,
    cta: s.cta ?? "",
    reelScript: s.reelScript,
    themeIndex: 0,
  });
  const file = `${postType.toLowerCase().replace(/_/g, "-")}.jpg`;
  if (buf) fs.writeFileSync(path.join(outDir, file), buf);
  console.log(`${buf ? "✓" : "✗"} ${file}`);
}
process.exit(0);

﻿/**
 * InstaPilot AI  -  File Storage Utility
 *
 * Persists AI-generated content to the local `generated/` directory tree.
 * All operations are async (fs/promises) with full error handling.
 *
 * Directory layout:
 *   generated/
 *     posts/       â† ContentResult JSON files
 *     carousels/   â† CarouselSlide[] JSON files
 *     quizzes/     â† Quiz JSON files
 *     reels/       â† Reel script JSON files
 *     hashtags/    â† HashtagPack JSON files
 *     images/      â† Image prompt text files
 */

import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type {
  ContentResult,
  PostType,
  CarouselSlide,
  HashtagPack,
  StoredFile,
  FileList,
} from "@/types";

// --- Config ---------------------------------------------------
const BASE_DIR = path.join(process.cwd(), "generated");

const TYPE_TO_DIR: Record<string, string> = {
  post: "posts",
  carousel: "carousels",
  quiz: "quizzes",
  reel: "reels",
  hashtag: "hashtags",
  image: "images",
};

// --- Helpers --------------------------------------------------
async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function buildFileName(prefix: string, ext: string = "json"): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const id = randomUUID().slice(0, 8);
  return `${prefix}-${ts}-${id}.${ext}`;
}

async function writeJSON(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function getFileStat(
  filePath: string,
  type: StoredFile["type"]
): Promise<StoredFile> {
  const stat = await fs.stat(filePath);
  return {
    id: randomUUID(),
    fileName: path.basename(filePath),
    filePath,
    type,
    size: stat.size,
    createdAt: stat.birthtime.toISOString(),
  };
}

// --- savePost -------------------------------------------------
/**
 * Saves a generated ContentResult to `generated/posts/`.
 * Returns the absolute file path.
 */
export async function savePost(
  content: ContentResult,
  type: PostType
): Promise<string> {
  const dir = path.join(BASE_DIR, "posts");
  await ensureDir(dir);

  const prefix = `${type.toLowerCase()}-${slugify(content.hook.slice(0, 30))}`;
  const fileName = buildFileName(prefix);
  const filePath = path.join(dir, fileName);

  await writeJSON(filePath, {
    ...content,
    savedAt: new Date().toISOString(),
    type,
  });

  return filePath;
}

// --- saveCarousel ---------------------------------------------
/**
 * Saves carousel slides to `generated/carousels/`.
 * Returns the absolute file path.
 */
export async function saveCarousel(slides: CarouselSlide[]): Promise<string> {
  const dir = path.join(BASE_DIR, "carousels");
  await ensureDir(dir);

  const fileName = buildFileName("carousel");
  const filePath = path.join(dir, fileName);

  await writeJSON(filePath, {
    slides,
    totalSlides: slides.length,
    savedAt: new Date().toISOString(),
  });

  return filePath;
}

// --- saveHashtagPack ------------------------------------------
/**
 * Saves a HashtagPack to `generated/hashtags/`.
 * Returns the absolute file path.
 */
export async function saveHashtagPack(pack: HashtagPack): Promise<string> {
  const dir = path.join(BASE_DIR, "hashtags");
  await ensureDir(dir);

  const prefix = `hashtag-${slugify(pack.name)}`;
  const fileName = buildFileName(prefix);
  const filePath = path.join(dir, fileName);

  await writeJSON(filePath, {
    ...pack,
    savedAt: new Date().toISOString(),
  });

  return filePath;
}

// --- saveReelScript -------------------------------------------
/**
 * Saves a reel script string to `generated/reels/`.
 * Returns the absolute file path.
 */
export async function saveReelScript(
  script: string,
  topic?: string
): Promise<string> {
  const dir = path.join(BASE_DIR, "reels");
  await ensureDir(dir);

  const prefix = `reel${topic ? "-" + slugify(topic) : ""}`;
  const fileName = buildFileName(prefix);
  const filePath = path.join(dir, fileName);

  await writeJSON(filePath, {
    script,
    topic,
    wordCount: script.split(/\s+/).length,
    savedAt: new Date().toISOString(),
  });

  return filePath;
}

// --- saveImagePrompt ------------------------------------------
/**
 * Saves an image generation prompt to `generated/images/`.
 * Returns the absolute file path.
 */
export async function saveImagePrompt(
  prompt: string,
  postType?: PostType
): Promise<string> {
  const dir = path.join(BASE_DIR, "images");
  await ensureDir(dir);

  const fileName = buildFileName("image-prompt", "txt");
  const filePath = path.join(dir, fileName);

  const content = [
    `Post Type: ${postType || "UNKNOWN"}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "=== IMAGE PROMPT ===",
    "",
    prompt,
  ].join("\n");

  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

// --- getGeneratedFiles ----------------------------------------
/**
 * Lists all files in a given `generated/` subdirectory.
 *
 * @param directory - one of: "posts", "carousels", "quizzes", "reels", "hashtags", "images"
 */
export async function getGeneratedFiles(directory: string): Promise<FileList> {
  const subDir = TYPE_TO_DIR[directory] || directory;
  const dirPath = path.join(BASE_DIR, subDir);

  await ensureDir(dirPath);

  let entries: string[];
  try {
    entries = await fs.readdir(dirPath);
  } catch {
    return { files: [], total: 0, directory: dirPath };
  }

  // Filter out .gitkeep and non-files
  const filtered = entries.filter(
    (e) => !e.startsWith(".") && (e.endsWith(".json") || e.endsWith(".txt"))
  );

  // Determine type
  const typeMap: Record<string, StoredFile["type"]> = {
    posts: "post",
    carousels: "carousel",
    quizzes: "quiz",
    reels: "reel",
    hashtags: "hashtag",
    images: "image",
  };
  const fileType: StoredFile["type"] = typeMap[subDir] || "post";

  const files = await Promise.all(
    filtered.map((name) => getFileStat(path.join(dirPath, name), fileType))
  );

  // Sort newest first
  files.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    files,
    total: files.length,
    directory: dirPath,
  };
}

// --- deleteFile -----------------------------------------------
/**
 * Deletes a file at the given absolute path.
 * Returns true on success, false on failure.
 */
export async function deleteFile(filePath: string): Promise<boolean> {
  // Safety: only allow deletion within the generated/ directory
  const resolvedBase = path.resolve(BASE_DIR);
  const resolvedTarget = path.resolve(filePath);

  if (!resolvedTarget.startsWith(resolvedBase)) {
    console.error(
      `[fileStorage] Refused to delete outside generated/: ${filePath}`
    );
    return false;
  }

  try {
    await fs.unlink(resolvedTarget);
    return true;
  } catch (err) {
    console.error(`[fileStorage] Failed to delete ${filePath}:`, err);
    return false;
  }
}

// --- readFile -------------------------------------------------
/**
 * Reads and parses a JSON file from the generated/ directory.
 * Returns null if the file doesn't exist or can't be parsed.
 */
export async function readGeneratedFile<T = unknown>(
  filePath: string
): Promise<T | null> {
  const resolvedBase = path.resolve(BASE_DIR);
  const resolvedTarget = path.resolve(filePath);

  if (!resolvedTarget.startsWith(resolvedBase)) {
    console.error(`[fileStorage] Refused to read outside generated/: ${filePath}`);
    return null;
  }

  try {
    const raw = await fs.readFile(resolvedTarget, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}


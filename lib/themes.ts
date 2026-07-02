/**
 * lib/themes.ts
 *
 * The 10 app themes. The `id` matches the [data-theme="id"] block in globals.css
 * and is what next-themes persists. `swatch`/`bg` are only for the selector preview.
 * Pure data — safe to import in client + server.
 */

export interface ThemeMeta {
  id:     string;
  label:  string;
  swatch: [string, string, string]; // accent gradient stops (for the preview dot)
  bg:     string;                    // page bg preview
}

export const THEMES: ThemeMeta[] = [
  { id: "crimson",  label: "Crimson",      swatch: ["#E53E3E", "#FC8181", "#9B2C2C"], bg: "#0a0a0f" },
  { id: "amethyst", label: "Amethyst",     swatch: ["#A855F7", "#C48AFF", "#6D28D9"], bg: "#0e0a14" },
  { id: "sapphire", label: "Sapphire",     swatch: ["#3B82F6", "#7DB2FF", "#1D4ED8"], bg: "#080c16" },
  { id: "emerald",  label: "Emerald",      swatch: ["#10B981", "#6EE7B7", "#047857"], bg: "#08100e" },
  { id: "sunset",   label: "Sunset",       swatch: ["#FB923C", "#FDBA74", "#EC4899"], bg: "#120b0a" },
  { id: "rose",     label: "Rosé",         swatch: ["#F43F5E", "#FB7185", "#BE185D"], bg: "#120a0e" },
  { id: "cyber",    label: "Cyber Teal",   swatch: ["#2DD4BF", "#67E8F9", "#0891B2"], bg: "#060e10" },
  { id: "gold",     label: "Gold",         swatch: ["#F5C518", "#FBD34D", "#B4820A"], bg: "#100d06" },
  { id: "indigo",   label: "Indigo Night", swatch: ["#6366F1", "#818CF8", "#4338CA"], bg: "#0a0b14" },
  { id: "slate",    label: "Slate Mono",   swatch: ["#94A3B8", "#CBD5E1", "#64748B"], bg: "#0b0d10" },
];

export const THEME_IDS = THEMES.map((t) => t.id);
export const DEFAULT_THEME = "crimson";

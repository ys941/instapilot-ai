import type { MetadataRoute } from "next";

// PWA manifest — Next serves this at /manifest.webmanifest and auto-links it.
// Enables "Install app" (Chrome/Edge) and "Add to Home Screen" (Safari) as a
// standalone web app. Brand-driven: name/short_name/description follow the
// configured brand so the installed app is white-labeled.
const APP_NAME =
  process.env.NEXT_PUBLIC_APP_NAME ?? process.env.BRAND_NAME ?? "InstaPilot AI";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "AI-powered content automation for Instagram & YouTube.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0A0A0F",
    theme_color: "#0A0A0F",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

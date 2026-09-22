"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { IS_DEMO, installDemoApi } from "@/lib/demo/api";

// Install before any component mounts, so the first data fetch is answered by
// the demo fixtures. A no-op outside the demo build.
installDemoApi();

/** The public demo's banner. Renders nothing in a normal build. */
export function DemoShim() {
  const [open, setOpen] = useState(true);
  if (!IS_DEMO || !open) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border px-4 py-2.5 text-xs shadow-2xl backdrop-blur sm:text-sm"
      style={{ background: "rgb(var(--surface-rgb) / 0.95)", borderColor: "rgb(var(--accent-rgb) / 0.35)", color: "rgba(255,255,255,0.85)" }}
    >
      <span className="flex-1">
        <b style={{ color: "rgb(var(--accent-rgb))" }}>Live demo</b> — a fictional brand with sample posts, in your browser.
        Nothing is uploaded and no AI is called.{" "}
        <a className="underline" style={{ color: "rgb(var(--accent-2-rgb))" }} href="https://github.com/ys941/instapilot-ai#readme" target="_blank" rel="noopener noreferrer">
          Self-host it
        </a>{" "}
        to connect your own accounts.
      </span>
      <button onClick={() => setOpen(false)} aria-label="Dismiss" className="rounded-lg p-1 opacity-60 hover:opacity-100">
        <X size={16} />
      </button>
    </div>
  );
}

/** Static builds can't redirect on the server, so the demo does it here. */
export function DemoRedirect({ to }: { to: string }) {
  if (typeof window !== "undefined") window.location.replace(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}${to}`);
  return null;
}

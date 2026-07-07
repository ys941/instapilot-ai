"use client";

import { useEffect } from "react";

/** Registers the service worker so the app is installable (Chrome/Edge) and
 *  runs standalone. No UI. Best-effort — failures are ignored. */
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const register = () =>
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}

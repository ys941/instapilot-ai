"use client";

import { useState, FormEvent } from "react";
import { motion } from "framer-motion";
import { useBrand } from "@/components/BrandContext";

export default function LoginPage() {
  const brand = useBrand();
  const [key, setKey]       = useState("");
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res  = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
        credentials: "same-origin",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        window.location.replace("/");
      } else {
        setError(data.error ?? "Invalid access key. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: "rgb(var(--bg-rgb))",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-inter, Inter, sans-serif)", position: "relative", overflow: "hidden",
    }}>
      {/* Background glow */}
      <div style={{
        position: "absolute", top: "30%", left: "50%", transform: "translate(-50%,-50%)",
        width: 600, height: 600, borderRadius: "50%",
        background: "radial-gradient(circle, rgb(var(--accent-rgb) / 0.08) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Animated ECG SVG */}
      <svg style={{ position: "absolute", top: "50%", left: 0, right: 0, width: "100%", opacity: 0.07, transform: "translateY(-50%)" }} viewBox="0 0 1440 80" preserveAspectRatio="none">
        <polyline
          points="0,40 160,40 200,40 220,8 240,72 260,40 360,40 480,40 520,40 540,4 560,76 580,40 680,40 800,40 840,40 860,10 880,70 900,40 1000,40 1120,40 1160,40 1180,6 1200,74 1220,40 1440,40"
          fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth="2.5" strokeLinecap="round"
        />
      </svg>

      {/* Login card */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        style={{
          position: "relative", zIndex: 10,
          width: "100%", maxWidth: 420, padding: "0 20px",
        }}
      >
        <div style={{
          background: "rgb(var(--surface-rgb) / 0.92)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24,
          padding: "44px 40px 40px",
          boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 1px rgb(var(--accent-rgb) / 0.08)",
        }}>
          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 64, height: 64, borderRadius: 18,
              background: "linear-gradient(135deg, rgb(var(--accent-rgb) / 0.2), rgb(var(--accent-2-rgb) / 0.1))",
              border: "1.5px solid rgb(var(--accent-rgb) / 0.3)", marginBottom: 16,
            }}>
              <svg viewBox="0 0 40 40" width={32} height={32}>
                <path d="M20 34C10 26 4 20 4 13 4 7.5 8.5 4 13 5c3.5.8 5.5 3 7 6 1.5-3 3.5-5.2 7-6 4.5-1 9 2.5 9 8 0 7-6 13-16 21z" fill="none" stroke="rgb(var(--accent-rgb))" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h1 style={{
              margin: 0, fontSize: 22, fontWeight: 700, color: "#fff",
              fontFamily: "var(--font-sora, Sora, sans-serif)", letterSpacing: "-0.02em",
            }}>{brand.appName}</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "rgba(255,255,255,0.35)" }}>
              Enter your access key to continue
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.4)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                Access Key
              </label>
              <input
                type="password"
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder="Enter your access key"
                autoFocus
                required
                style={{
                  width: "100%", padding: "13px 16px", borderRadius: 12,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)",
                  color: "#fff", fontSize: 15, outline: "none", boxSizing: "border-box",
                  transition: "border-color 0.2s",
                  fontFamily: "inherit",
                }}
                onFocus={e => { e.target.style.borderColor = "rgb(var(--accent-rgb) / 0.5)"; }}
                onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.10)"; }}
              />
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
                style={{
                  marginBottom: 16, padding: "10px 14px", borderRadius: 10,
                  background: "rgba(230,57,70,0.1)", border: "1px solid rgba(230,57,70,0.25)",
                  color: "#ff6b7a", fontSize: 13,
                }}
              >
                {error}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading || !key}
              style={{
                width: "100%", padding: "13px 16px", borderRadius: 12, border: "none",
                background: loading || !key
                  ? "rgba(255,255,255,0.06)"
                  : "linear-gradient(135deg, rgb(var(--accent-rgb)), rgb(var(--accent-2-rgb)))",
                color: loading || !key ? "rgba(255,255,255,0.25)" : "#fff",
                fontSize: 15, fontWeight: 600, cursor: loading || !key ? "not-allowed" : "pointer",
                transition: "all 0.2s", letterSpacing: "0.01em",
                fontFamily: "inherit",
              }}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: 24, fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
            {brand.handle ? `@${brand.handle} · ` : ""}{brand.appName}
          </p>
        </div>
      </motion.div>
    </div>
  );
}

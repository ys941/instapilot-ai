"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User, Instagram, Cpu, Bell, AlertTriangle,
  Eye, EyeOff, CheckCircle, Loader2, Trash2,
  RotateCcw, Save, AlertCircle, RefreshCw,
  ShieldCheck, Clock, Database, Globe, Calendar,
  Activity, Sparkles, Zap, FileText, Plus, X,
  ChevronDown, ChevronUp, RotateCw, BookImage, Radio, LogOut, Youtube,
  Building2, Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";
import {
  useSelectedBrand, withBrand, ALL_BRANDS, type BrandRecord,
} from "@/components/dashboard/useSelectedBrand";
import { useBrandContext } from "@/components/BrandContext";

const tabs = [
  { id: "brand",         label: "Brand",         icon: Sparkles },
  { id: "content-types", label: "Content Types", icon: FileText },
  { id: "account",       label: "Account",       icon: User },
  { id: "accounts",      label: "Accounts",      icon: Layers },
  { id: "instagram",     label: "Instagram",      icon: Instagram },
  { id: "ai",            label: "AI Config",      icon: Cpu },
  { id: "prompts",       label: "AI Prompts",     icon: FileText },
  { id: "auto-post",     label: "Auto-Post",      icon: Zap },
  { id: "stories",       label: "Stories",        icon: BookImage },
  { id: "youtube",       label: "YouTube",        icon: Youtube },
  { id: "webhook",       label: "Webhook",        icon: Radio },
  { id: "notifications", label: "Notifications",  icon: Bell },
  { id: "danger",        label: "Danger Zone",    icon: AlertTriangle },
];

// ─── Shared UI helpers ────────────────────────────────────────────────────────
function GlassInput({
  label, type = "text", value, onChange, placeholder, masked = false, readOnly = false,
}: {
  label: string; type?: string; value: string; onChange?: (v: string) => void;
  placeholder?: string; masked?: boolean; readOnly?: boolean;
}) {
  const [show, setShow] = useState(false);
  const inputType = masked ? (show ? "text" : "password") : type;
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={cn(
            "w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none transition-all",
            readOnly && "opacity-60 cursor-default",
          )}
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          onFocus={(e) => { if (!readOnly) { e.target.style.borderColor = "rgba(239,68,68,0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(239,68,68,0.08)"; } }}
          onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
        />
        {masked && !readOnly && (
          <button type="button" onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}

function GlassSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        {options.map((o) => <option key={o} value={o} style={{ background: "#111118" }}>{o}</option>)}
      </select>
    </div>
  );
}

function Toggle({ label, description, value, onChange, disabled = false }: {
  label: string; description: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0", disabled && "opacity-50")}>
      <div>
        <p className="text-sm text-white/80 font-medium">{label}</p>
        <p className="text-xs text-white/35 mt-0.5">{description}</p>
      </div>
      <motion.button
        onClick={() => { if (!disabled) onChange(!value); }}
        disabled={disabled}
        aria-disabled={disabled}
        className={cn("relative w-11 h-6 rounded-full transition-all flex-shrink-0 ml-4", value ? "bg-gradient-to-r from-red-500 to-pink-500" : "bg-white/10", disabled && "cursor-not-allowed")}
        style={value ? { boxShadow: "0 0 12px rgba(239,68,68,0.4)" } : {}}
      >
        <motion.div
          animate={{ x: value ? 20 : 2 }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
          className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
        />
      </motion.button>
    </div>
  );
}

function SaveButton({ onClick, loading, label = "Save Changes" }: {
  onClick: () => void; loading?: boolean; label?: string;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
      style={{ background: "linear-gradient(135deg, #ef4444, #ec4899)" }}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {loading ? "Saving..." : label}
    </motion.button>
  );
}

function SkeletonBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 rounded-xl animate-pulse bg-white/5" />
      ))}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background:      "rgba(17,17,24,0.8)",
  backdropFilter:  "blur(20px)",
  border:          "1px solid rgba(255,255,255,0.07)",
};

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT TAB
// ─────────────────────────────────────────────────────────────────────────────
function AccountTab() {
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");

  useEffect(() => {
    fetch("/api/settings/account")
      .then((r) => r.json())
      .then((d) => { if (d.success) { setName(d.data.name ?? ""); setEmail(d.data.email ?? ""); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving account settings...");
    try {
      const res  = await fetch("/api/settings/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Account saved ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={4} />;

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Account Settings</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <GlassInput label="Full Name"      value={name}  onChange={setName}  placeholder="Your name" />
        <GlassInput label="Email Address"  type="email"  value={email} onChange={setEmail} placeholder="you@example.com" />
      </div>
      <div className="pt-4 border-t border-white/[0.05]">
        <h4 className="text-sm font-semibold text-white/70 mb-2">Login Access Key</h4>
        <div className="rounded-xl p-4 border border-white/[0.06] flex items-start gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
          <ShieldCheck size={15} className="text-white/30 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs text-white/55 leading-relaxed">
              This app uses an <strong className="text-white/70">APP_ACCESS_KEY</strong> environment variable for login — not a username/password.
            </p>
            <p className="text-xs text-white/35 leading-relaxed">
              To change your login key, update <code className="text-red-400/80 bg-red-500/10 px-1 py-0.5 rounded text-[10px]">APP_ACCESS_KEY</code> in your Railway environment variables, then redeploy.
            </p>
          </div>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNTS TAB  (multi-brand manager — list / add / edit / delete)
// ─────────────────────────────────────────────────────────────────────────────

interface BrandFormState {
  label:          string;
  igToken:        string;
  igAcctId:       string;
  igUsername:     string;
  fbPageId:       string;
  ytClientId:     string;
  ytClientSecret: string;
  ytRefreshToken: string;
}

const emptyForm: BrandFormState = {
  label: "", igToken: "", igAcctId: "", igUsername: "", fbPageId: "",
  ytClientId: "", ytClientSecret: "", ytRefreshToken: "",
};

function BrandForm({
  initial, onSubmit, onCancel, submitting, mode,
}: {
  initial: BrandFormState;
  onSubmit: (v: BrandFormState) => void;
  onCancel: () => void;
  submitting: boolean;
  mode: "add" | "edit";
}) {
  const [form, setForm] = useState<BrandFormState>(initial);
  const set = (k: keyof BrandFormState) => (v: string) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <div className="rounded-2xl p-5 space-y-4 border border-white/[0.08]" style={{ background: "rgba(255,255,255,0.02)" }}>
      <GlassInput label="Account Label" value={form.label} onChange={set("label")} placeholder="e.g. Brand B" />

      <div className="pt-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
          <Instagram size={12} /> Instagram
        </p>
        <div className="space-y-3">
          <GlassInput label="Access Token"        value={form.igToken}   onChange={set("igToken")}   placeholder="Paste long-lived IG token" masked />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GlassInput label="Business Account ID" value={form.igAcctId}  onChange={set("igAcctId")}  placeholder="17841…" />
            <GlassInput label="Username"            value={form.igUsername} onChange={set("igUsername")} placeholder="@yourhandle" />
          </div>
          <GlassInput label="Facebook Page ID"    value={form.fbPageId}  onChange={set("fbPageId")}  placeholder="Optional" />
        </div>
      </div>

      <div className="pt-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/40 mb-2 flex items-center gap-1.5">
          <Youtube size={12} /> YouTube
        </p>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GlassInput label="Client ID"     value={form.ytClientId}     onChange={set("ytClientId")}     placeholder="Optional" />
            <GlassInput label="Client Secret" value={form.ytClientSecret} onChange={set("ytClientSecret")} placeholder="Optional" masked />
          </div>
          <GlassInput label="Refresh Token"   value={form.ytRefreshToken} onChange={set("ytRefreshToken")} placeholder="Optional" masked />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
        >
          Cancel
        </button>
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={() => { if (!form.label.trim()) { toast.error("Account label is required"); return; } onSubmit(form); }}
          disabled={submitting}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #ef4444, #ec4899)" }}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {mode === "add" ? "Add Account" : "Save Changes"}
        </motion.button>
      </div>
    </div>
  );
}

function AccountsTab() {
  const { brandId, setBrand, refresh } = useSelectedBrand();
  const [brands,   setBrands]   = useState<BrandRecord[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [adding,   setAdding]   = useState(false);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/brands");
      const json = await res.json();
      const list: BrandRecord[] = Array.isArray(json) ? json : (json?.data ?? []);
      setBrands(list);
    } catch {
      toast.error("Could not load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const formToBody = (f: BrandFormState) => ({
    label:          f.label.trim(),
    igToken:        f.igToken.trim()        || undefined,
    igAcctId:       f.igAcctId.trim()       || undefined,
    igUsername:     f.igUsername.trim()     || undefined,
    fbPageId:       f.fbPageId.trim()       || undefined,
    ytClientId:     f.ytClientId.trim()     || undefined,
    ytClientSecret: f.ytClientSecret.trim() || undefined,
    ytRefreshToken: f.ytRefreshToken.trim() || undefined,
  });

  const handleAdd = async (f: BrandFormState) => {
    setBusy(true);
    const tid = toast.loading("Adding account…");
    try {
      const res  = await fetch("/api/brands", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToBody(f)),
      });
      const data = await res.json();
      if (res.ok && (data.id || data.data?.id)) {
        toast.success("Account added ✅", { id: tid });
        setAdding(false);
        await load();
        refresh();
      } else {
        toast.error(data.error ?? "Failed to add account", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = async (id: string, f: BrandFormState) => {
    setBusy(true);
    const tid = toast.loading("Saving…");
    try {
      const res  = await fetch(`/api/brands/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToBody(f)),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success("Account updated ✅", { id: tid });
        setEditId(null);
        await load();
        refresh();
      } else {
        toast.error(data.error ?? "Update failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const handleToggleActive = async (b: BrandRecord) => {
    const tid = toast.loading(b.active ? "Disabling…" : "Enabling…");
    try {
      const res = await fetch(`/api/brands/${b.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !b.active }),
      });
      if (res.ok) {
        toast.success(b.active ? "Account disabled" : "Account enabled", { id: tid });
        await load();
        refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not update", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    }
  };

  const handleDelete = async (b: BrandRecord) => {
    if (b.isPrimary) { toast.error("The primary account cannot be deleted"); return; }
    if (!window.confirm(`Delete "${b.label}"? This cannot be undone.`)) return;
    const tid = toast.loading("Deleting…");
    try {
      const res = await fetch(`/api/brands/${b.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Account deleted", { id: tid });
        if (brandId === b.id) setBrand(brands.find((x) => x.isPrimary)?.id ?? "");
        await load();
        refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Delete failed (the primary account cannot be deleted)", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    }
  };

  if (loading) return <SkeletonBlock rows={4} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Accounts</h3>
          <p className="text-xs text-white/40 mt-0.5">
            Manage the Instagram + YouTube accounts (brands) this dashboard controls.
          </p>
        </div>
        {!adding && (
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
            onClick={() => { setEditId(null); setAdding(true); }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #ef4444, #ec4899)" }}
          >
            <Plus size={15} /> Add Account
          </motion.button>
        )}
      </div>

      {adding && (
        <BrandForm
          mode="add"
          initial={emptyForm}
          submitting={busy}
          onSubmit={handleAdd}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="space-y-3">
        {brands.map((b) => (
          <div key={b.id}>
            <div
              className={cn(
                "rounded-2xl p-4 border flex items-center gap-4 transition-all",
                brandId === b.id ? "border-red-500/30" : "border-white/[0.07]",
              )}
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-500/30 to-pink-600/20 flex items-center justify-center flex-shrink-0">
                <Building2 size={18} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-white truncate">{b.label}</p>
                  {b.isPrimary && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">Primary</span>
                  )}
                  {brandId === b.id && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Selected</span>
                  )}
                  {!b.active && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.06] text-white/40">Disabled</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <span className="flex items-center gap-1 text-[11px] text-white/40">
                    <Instagram size={10} /> {b.igUsername || (b.hasInstagram ? "connected" : "—")}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-white/40">
                    <Youtube size={10} /> {b.ytChannelTitle || (b.hasYouTube ? "connected" : "—")}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {brandId !== b.id && (
                  <button
                    onClick={() => setBrand(b.id)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
                  >
                    Select
                  </button>
                )}
                <button
                  onClick={() => handleToggleActive(b)}
                  disabled={b.isPrimary}
                  title={b.isPrimary ? "The primary account is always active" : (b.active ? "Disable" : "Enable")}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/50 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {b.active ? "Disable" : "Enable"}
                </button>
                <button
                  onClick={() => { setAdding(false); setEditId(editId === b.id ? null : b.id); }}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all"
                  title="Edit"
                >
                  <RotateCw size={13} />
                </button>
                {!b.isPrimary && (
                  <button
                    onClick={() => handleDelete(b)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400/60 border border-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all"
                    title="Delete"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {editId === b.id && (
              <div className="mt-2">
                <BrandForm
                  mode="edit"
                  submitting={busy}
                  initial={{
                    ...emptyForm,
                    label:      b.label,
                    igUsername: b.igUsername ?? "",
                    // Secrets are never returned by the API — leave blank; only
                    // non-empty fields are sent on save so existing creds persist.
                  }}
                  onSubmit={(f) => handleEdit(b.id, f)}
                  onCancel={() => setEditId(null)}
                />
                <p className="text-[11px] text-white/30 mt-1.5 px-1">
                  Leave credential fields blank to keep the existing values. The primary account resolves its credentials from environment variables.
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INSTAGRAM TAB
// ─────────────────────────────────────────────────────────────────────────────
function InstagramTab() {
  const { brandId } = useSelectedBrand();
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [testing,  setTesting]  = useState(false);

  const [tokenMasked,  setTokenMasked]  = useState("");
  const [accountId,    setAccountId]    = useState("");
  const [tokenValid,   setTokenValid]   = useState<boolean | null>(null);
  const [tokenError,   setTokenError]   = useState<string | null>(null);
  const [accountName,  setAccountName]  = useState<string | null>(null);
  const [expiresAt,    setExpiresAt]    = useState<string | null>(null);
  const [source,       setSource]       = useState<"database" | "env">("env");
  const [newToken,     setNewToken]     = useState("");
  const [newIgId,      setNewIgId]      = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch(withBrand("/api/settings/instagram", brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setTokenMasked(d.data.tokenMasked ?? "");
          setAccountId(d.data.accountId    ?? "");
          setTokenValid(d.data.tokenValid);
          setTokenError(d.data.tokenError);
          setAccountName(d.data.accountName);
          setExpiresAt(d.data.expiresAt);
          setSource(d.data.source);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!newToken.trim()) { toast.error("Paste a new access token first"); return; }
    setSaving(true);
    const tid = toast.loading("Validating token with Instagram...");
    try {
      const res  = await fetch(withBrand("/api/settings/instagram", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accessToken: newToken.trim(), accountId: newIgId.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Connected as ${data.data.accountName || "your account"} ✅`, { id: tid });
        setTokenMasked(`${newToken.slice(0, 12)}...${newToken.slice(-4)}`);
        setTokenValid(true);
        setTokenError(null);
        setAccountName(data.data.accountName);
        setExpiresAt(data.data.expiresAt);
        setAccountId(data.data.accountId || newIgId);
        setSource("database");
        setNewToken(""); setNewIgId("");
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error  -  try again", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    const tokenToTest = newToken.trim();
    setTesting(true);
    if (tokenToTest) {
      const tid = toast.loading("Testing new token...");
      try {
        const res  = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${tokenToTest}`);
        const data = await res.json();
        if (data.error) toast.error(`Invalid: ${data.error.message}`, { id: tid });
        else            toast.success(`Valid ✅  -  connected as ${data.name}`, { id: tid });
      } catch { toast.error("Could not reach Instagram API", { id: tid }); }
    } else {
      const tid = toast.loading("Testing saved token...");
      try {
        const res  = await fetch(withBrand("/api/settings/instagram", brandId));
        const data = await res.json();
        if (data.success && data.data.tokenValid) {
          toast.success(`Token is valid ✅  -  ${data.data.accountName}`, { id: tid });
          setTokenValid(true); setTokenError(null);
        } else {
          toast.error(`Token invalid: ${data.data.tokenError}`, { id: tid });
          setTokenValid(false); setTokenError(data.data.tokenError);
        }
      } catch { toast.error("Test failed", { id: tid }); }
    }
    setTesting(false);
  };

  const daysUntilExpiry = expiresAt
    ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))
    : null;

  const expiryColor =
    daysUntilExpiry === null     ? "text-white/30"
    : daysUntilExpiry <= 0       ? "text-red-400"
    : daysUntilExpiry <= 7       ? "text-orange-400"
    : daysUntilExpiry <= 14      ? "text-yellow-400"
    :                              "text-emerald-400";

  if (loading) return <SkeletonBlock rows={3} />;

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Instagram Connection</h3>

      <div className={cn("rounded-xl p-4 border flex items-start gap-3",
        tokenValid === true  ? "bg-emerald-500/5 border-emerald-500/20"
        : tokenValid === false ? "bg-red-500/5 border-red-500/20"
        : "bg-white/5 border-white/10"
      )}>
        <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5",
          tokenValid === true  ? "bg-emerald-500/15"
          : tokenValid === false ? "bg-red-500/15"
          : "bg-white/10"
        )}>
          <Instagram size={16} className={tokenValid === true ? "text-emerald-400" : tokenValid === false ? "text-red-400" : "text-white/30"} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-white">
              {tokenValid === true  ? `Connected  -  ${accountName ?? "Instagram"}`
               : tokenValid === false ? "Token expired / invalid"
               : "Not configured"}
            </p>
            <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium",
              source === "database"
                ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                : "text-white/30 bg-white/5 border-white/10"
            )}>
              {source === "database"
                ? <><Database size={9} className="inline mr-1" />DB</>
                : <><Globe    size={9} className="inline mr-1" />.env</>}
            </span>
          </div>
          {tokenValid === false && tokenError && (
            <p className="text-xs text-red-400/80 mt-1 leading-relaxed">{tokenError}</p>
          )}
          {tokenValid === true && (
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-white/40 font-mono">{tokenMasked}</span>
              {daysUntilExpiry !== null && (
                <span className={cn("text-[11px] flex items-center gap-1 font-medium", expiryColor)}>
                  <Clock size={10} />
                  {daysUntilExpiry <= 0 ? "Expired"
                   : daysUntilExpiry === 1 ? "Expires tomorrow"
                   : `Expires in ${daysUntilExpiry} days`}
                </span>
              )}
              {accountId && <span className="text-[10px] text-white/25 font-mono">ID: {accountId}</span>}
            </div>
          )}
        </div>
        <motion.button whileHover={{ rotate: 180 }} transition={{ duration: 0.3 }} onClick={load}
          className="p-1.5 text-white/25 hover:text-white/60 transition-colors"
        >
          <RefreshCw size={13} />
        </motion.button>
      </div>

      {daysUntilExpiry !== null && daysUntilExpiry <= 7 && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 p-3 rounded-xl border border-orange-500/25 bg-orange-500/8"
        >
          <AlertCircle size={14} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-orange-300/80 leading-relaxed">
            <span className="font-semibold text-orange-400">
              {daysUntilExpiry <= 0 ? "Token expired! " : `Token expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}! `}
            </span>
            Generate a new long-lived token from{" "}
            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer"
               className="underline underline-offset-2 text-orange-400 hover:text-orange-300">
              Meta Graph API Explorer
            </a>{" "}and paste it below.
          </p>
        </motion.div>
      )}

      <div className="rounded-xl p-4 space-y-4" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Update Token</p>
        <GlassInput label="New Access Token" masked value={newToken} onChange={setNewToken} placeholder="Paste your new long-lived access token here..." />
        <GlassInput label="Business Account ID (optional  -  auto-detected if blank)" value={newIgId} onChange={setNewIgId} placeholder={accountId || "17841400000000000"} />
        <div className="text-[11px] text-white/30 leading-relaxed rounded-lg p-3 space-y-0.5" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="font-semibold text-white/40 mb-1">How to get a fresh token:</p>

          <p>2. Click <strong className="text-white/50">Generate Access Token</strong>  -  check all Instagram permissions</p>

          <p>4. <strong className="text-white/50">Long-lived tokens last 60 days</strong>  -  refresh before they expire</p>
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={handleTest} disabled={testing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white/60 border border-white/[0.08] hover:text-white hover:border-white/[0.15] transition-all disabled:opacity-50"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {testing ? "Testing..." : "Test Token"}
        </motion.button>
        <SaveButton onClick={handleSave} loading={saving} label="Save & Connect" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI CONFIG TAB
// ─────────────────────────────────────────────────────────────────────────────
function AiTab() {
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [defaultTone,  setDefaultTone]  = useState("Professional");
  const [defaultType,  setDefaultType]  = useState("Educational");
  const [language,     setLanguage]     = useState("English");
  const [aiProvider,   setAiProvider]   = useState<"grok" | "gemini">("grok");
  const [geminiApiKey, setGeminiApiKey] = useState("");

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setDefaultTone(d.data.defaultTone  ?? "Professional");
          setDefaultType(d.data.defaultType  ?? "Educational");
          setLanguage(d.data.language        ?? "English");
          setAiProvider(d.data.aiProvider    ?? "grok");
          setGeminiApiKey(d.data.geminiApiKey ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving AI preferences...");
    try {
      const res  = await fetch("/api/settings/ai", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ defaultTone, defaultType, language, aiProvider, geminiApiKey }),
      });
      const data = await res.json();
      if (data.success) toast.success("AI Config saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={3} />;

  const tones = ["Professional", "Engaging", "Educational", "Casual", "Urgent"];
  const types  = ["Educational", "Knowledge Quiz", "Pro Tip", "Story / Example", "Myth-Fact", "Carousel", "How-To / Tips", "CTA", "Reel"];
  const langs  = ["English", "Arabic", "Hindi", "Spanish", "French", "German"];

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>AI Configuration</h3>

      {/* ── AI Provider Selection ── */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.2)" }}>
        <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider">AI Provider</p>
        <p className="text-xs text-white/40">Select which AI engine powers content generation, comment replies, DMs, and story creation.</p>
        <div className="flex gap-3">
          {(["grok", "gemini"] as const).map((p) => (
            <motion.button key={p} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => setAiProvider(p)}
              className={cn(
                "flex-1 py-3 rounded-xl text-sm font-semibold border transition-all",
                aiProvider === p
                  ? p === "gemini"
                    ? "bg-gradient-to-r from-blue-500/20 to-cyan-500/10 text-cyan-300 border-cyan-500/40"
                    : "bg-gradient-to-r from-red-500/20 to-pink-500/10 text-red-300 border-red-500/30"
                  : "border-white/[0.08] text-white/40 hover:text-white/70"
              )}
            >
              {p === "grok" ? "🤖 Groq (Llama)" : "✨ Gemini (Google)"}
            </motion.button>
          ))}
        </div>
        {aiProvider === "gemini" && (
          <div className="space-y-2 pt-1">
            <GlassInput
              label="Gemini API Key"
              value={geminiApiKey}
              onChange={setGeminiApiKey}
              placeholder="AIzaSy..."
              masked
            />
            <div className="flex items-start gap-2 rounded-lg p-2.5" style={{ background: "rgba(6,182,212,0.06)", border: "1px solid rgba(6,182,212,0.15)" }}>
              <span className="text-cyan-400 text-xs mt-0.5">ℹ️</span>
              <div className="text-[10px] text-white/40 leading-relaxed space-y-1">
                <p>When Gemini is active: image & video uploads are analysed by Gemini Vision to auto-generate content-aware captions.</p>
                <p>Also set <code className="text-cyan-300/70 bg-cyan-900/20 px-1 rounded">GEMINI_API_KEY</code> as a Railway env var for production use.</p>
              </div>
            </div>
          </div>
        )}
        {aiProvider === "grok" && (
          <p className="text-[10px] text-white/30">Using Groq (Llama) API. Set <code className="text-red-300/70 bg-red-900/20 px-1 rounded">GROK_API_KEY</code> in Railway env vars.</p>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <label className="text-xs font-medium text-white/40 block mb-2.5 uppercase tracking-wider">Default Tone</label>
          <div className="flex flex-wrap gap-2">
            {tones.map((t) => (
              <motion.button key={t} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => setDefaultTone(t)}
                className={cn("px-3.5 py-2 rounded-full text-xs font-semibold border transition-all",
                  defaultTone === t
                    ? "bg-gradient-to-r from-red-500/20 to-pink-500/10 text-red-300 border-red-500/30"
                    : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20"
                )}
              >
                {t}
              </motion.button>
            ))}
          </div>
        </div>

        <GlassSelect label="Default Post Type" value={defaultType} onChange={setDefaultType} options={types} />
        <GlassSelect label="Content Language"  value={language}    onChange={setLanguage}    options={langs} />

        <div className="rounded-xl p-4 border border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Current Defaults</p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Provider", value: aiProvider === "gemini" ? "Gemini ✨" : "Groq (Llama) 🤖" },
              { label: "Tone",     value: defaultTone },
              { label: "Type",     value: defaultType },
              { label: "Language", value: language    },
            ].map((item) => (
              <span key={item.label} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/10 text-white/60" style={{ background: "rgba(255,255,255,0.03)" }}>
                <span className="text-white/30">{item.label}:</span>
                <span className="font-semibold text-white/80">{item.value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI PROMPTS TAB
// ─────────────────────────────────────────────────────────────────────────────
const POST_TYPES_META = [
  { id: "EDUCATIONAL",      label: "Educational",       emoji: "📚" },
  { id: "QUIZ",             label: "Quiz",              emoji: "❓" },
  { id: "CAROUSEL",         label: "Carousel",          emoji: "🖼️" },
  { id: "MYTH_FACT",        label: "Myth vs Fact",      emoji: "⚖️" },
  { id: "CLINICAL_PEARL",   label: "Pro Tip",           emoji: "💎" },
  { id: "CASE_STUDY",       label: "Story / Example",   emoji: "🔬" },
  { id: "ANGIOGRAPHY_QUIZ", label: "Image Quiz",        emoji: "🖼️" },
  { id: "ECG_QUIZ",         label: "Knowledge Quiz",    emoji: "📈" },
  { id: "PREVENTIVE",       label: "How-To / Tips",     emoji: "🛡️" },
  { id: "CTA",              label: "CTA",               emoji: "📣" },
  { id: "REEL",             label: "Reel Script",       emoji: "🎬" },
];

function PromptsTab() {
  const { brandId, isAll, selected: selectedBrand } = useSelectedBrand();
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [selected, setSelected] = useState("EDUCATIONAL");
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [saved,    setSaved]    = useState<Record<string, string>>({});
  const [draft,    setDraft]    = useState<Record<string, string>>({});

  // Per-account default content prompts (saved through this same route).
  const [igDefaultPrompt, setIgDefaultPrompt] = useState("");
  const [ytDefaultPrompt, setYtDefaultPrompt] = useState("");
  const [savedIgDefault,  setSavedIgDefault]  = useState("");
  const [savedYtDefault,  setSavedYtDefault]  = useState("");
  const [savingDefaults,  setSavingDefaults]  = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(withBrand("/api/settings/prompts", brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setDefaults(d.data.defaults ?? {});
          setSaved(d.data.saved ?? {});
          setDraft(d.data.saved ?? {});
          const ig = d.data.igDefaultPrompt ?? "";
          const yt = d.data.ytDefaultPrompt ?? "";
          setIgDefaultPrompt(ig); setSavedIgDefault(ig);
          setYtDefaultPrompt(yt); setSavedYtDefault(yt);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const currentText  = draft[selected] ?? "";
  const defaultHint  = defaults[selected] ?? "";
  const isCustomized = !!saved[selected];
  const isDirty      = (draft[selected] ?? "") !== (saved[selected] ?? "");
  const defaultsDirty = igDefaultPrompt !== savedIgDefault || ytDefaultPrompt !== savedYtDefault;

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving prompt...");
    try {
      const res  = await fetch(withBrand("/api/settings/prompts", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ prompts: { [selected]: draft[selected] ?? "" } }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(data.data?.saved ?? data.data);
        setDraft(data.data?.saved ?? data.data);
        toast.success("Prompt saved ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDefaults = async () => {
    setSavingDefaults(true);
    const tid = toast.loading("Saving default prompts...");
    try {
      const res  = await fetch(withBrand("/api/settings/prompts", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ igDefaultPrompt, ytDefaultPrompt }),
      });
      const data = await res.json();
      if (data.success) {
        setSavedIgDefault(igDefaultPrompt);
        setSavedYtDefault(ytDefaultPrompt);
        toast.success("Default prompts saved ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSavingDefaults(false);
    }
  };

  const handleReset = async () => {
    // Clear override for this type (send empty string)
    setSaving(true);
    const tid = toast.loading("Resetting to default...");
    try {
      const res  = await fetch(withBrand("/api/settings/prompts", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ prompts: { [selected]: "" } }),
      });
      const data = await res.json();
      if (data.success) {
        setSaved(data.data?.saved ?? data.data);
        setDraft((prev) => { const n = { ...prev }; delete n[selected]; return n; });
        toast.success("Reset to default ✅", { id: tid });
      } else {
        toast.error(data.error ?? "Reset failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={5} />;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>AI Prompt Editor</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Customize the system instructions for each post type. Your prompt is appended after the base brand voice context. Leave blank to use the built-in default.
        </p>
        <p className="text-[11px] text-white/30 mt-1">
          Editing for:{" "}
          <span className="text-white/60 font-medium">
            {isAll ? "Primary (aggregate view cannot edit per-account)" : selectedBrand?.label ?? "Primary"}
          </span>
        </p>
      </div>

      {/* Per-account default content prompts */}
      <div className="rounded-2xl border border-white/[0.07] p-5 space-y-4" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div>
          <h4 className="text-sm font-semibold text-white flex items-center gap-2">
            <Sparkles size={14} className="text-yellow-400" /> Default Content Prompts (this account)
          </h4>
          <p className="text-[11px] text-white/35 mt-1">
            Used as the default instruction when generating content for this account.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
            <Instagram size={11} /> Instagram default prompt
          </label>
          <textarea
            value={igDefaultPrompt}
            onChange={(e) => setIgDefaultPrompt(e.target.value)}
            placeholder="e.g. Write authoritative, evidence-based posts for your audience…"
            rows={3}
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
            <Youtube size={11} /> YouTube default prompt
          </label>
          <textarea
            value={ytDefaultPrompt}
            onChange={(e) => setYtDefaultPrompt(e.target.value)}
            placeholder="e.g. Script punchy vertical Shorts with a strong hook in the first 2 seconds…"
            rows={3}
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <div className="flex justify-end">
          <SaveButton onClick={handleSaveDefaults} loading={savingDefaults} label="Save Default Prompts" />
        </div>
      </div>

      {/* Type selector */}
      <div className="flex flex-wrap gap-2">
        {POST_TYPES_META.map((pt) => {
          const hasCustom = !!saved[pt.id];
          return (
            <motion.button
              key={pt.id}
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={() => setSelected(pt.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                selected === pt.id
                  ? "bg-gradient-to-r from-red-500/20 to-pink-500/10 text-white border-red-500/30"
                  : "border-white/[0.08] text-white/40 hover:text-white/70 hover:border-white/20",
              )}
            >
              <span>{pt.emoji}</span>
              {pt.label}
              {hasCustom && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" title="Custom prompt active" />
              )}
            </motion.button>
          );
        })}
      </div>

      {/* Editor panel */}
      <div className="rounded-xl border border-white/[0.07] overflow-hidden" style={{ background: "rgba(255,255,255,0.02)" }}>
        {/* Editor header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">
              {POST_TYPES_META.find((p) => p.id === selected)?.emoji}{" "}
              {POST_TYPES_META.find((p) => p.id === selected)?.label}
            </span>
            {isCustomized ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 font-medium">
                Custom active
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/35 font-medium">
                Using default
              </span>
            )}
          </div>
          {isCustomized && (
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={handleReset}
              disabled={saving}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-red-400 transition-colors px-2 py-1 rounded-lg border border-white/[0.06] hover:border-red-500/30"
            >
              <RotateCw size={11} />
              Reset to default
            </motion.button>
          )}
        </div>

        {/* Textarea */}
        <div className="p-4">
          <textarea
            value={currentText}
            onChange={(e) => setDraft((prev) => ({ ...prev, [selected]: e.target.value }))}
            rows={10}
            placeholder={`System default for ${POST_TYPES_META.find((p) => p.id === selected)?.label}:\n\n${defaultHint}\n\nType your custom instructions here to override...`}
            className="w-full text-sm text-white/80 leading-relaxed resize-y outline-none rounded-lg px-4 py-3 placeholder-white/20"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", minHeight: 200, fontFamily: "monospace" }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.4)"; }}
            onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.06)"; }}
          />
          <p className="text-[11px] text-white/25 mt-2 leading-relaxed">
            Your instructions are appended after the base brand voice context. Use plain English  -  describe exactly what format, length, and style you want for this post type.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={() => setDraft((prev) => ({ ...prev, [selected]: saved[selected] ?? "" }))}
          disabled={!isDirty}
          className="text-xs text-white/30 hover:text-white/60 transition-colors disabled:opacity-30"
        >
          Discard changes
        </button>
        <SaveButton onClick={handleSave} loading={saving} label={isDirty ? "Save Prompt" : "Saved"} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-POST TAB
// ─────────────────────────────────────────────────────────────────────────────
const ALL_POST_TYPES = [
  { id: "EDUCATIONAL",      label: "Educational",    emoji: "📚" },
  { id: "QUIZ",             label: "Quiz",           emoji: "❓" },
  { id: "CAROUSEL",         label: "Carousel",       emoji: "🖼️" },
  { id: "MYTH_FACT",        label: "Myth vs Fact",   emoji: "⚖️" },
  { id: "CLINICAL_PEARL",   label: "Pro Tip",        emoji: "💎" },
  { id: "CASE_STUDY",       label: "Story / Example",emoji: "🔬" },
  { id: "ANGIOGRAPHY_QUIZ", label: "Image Quiz",     emoji: "🖼️" },
  { id: "ECG_QUIZ",         label: "Knowledge Quiz", emoji: "📈" },
  { id: "PREVENTIVE",       label: "How-To / Tips",  emoji: "🛡️" },
  { id: "CTA",              label: "CTA",            emoji: "📣" },
  { id: "REEL",             label: "Reel",           emoji: "🎬" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Per-weekday schedule entry shape (mirrors lib/preferences DayScheduleEntry).
// reelTimes is YouTube-only (per-day Instagram Reel publish slots); optional/empty
// for the Auto-Post schedule, which never renders or persists it.
type DayScheduleEntry = { day: number; enabled: boolean; postsPerDay: number; times: string[]; reelTimes?: string[] };

/**
 * Per-weekday timing + post-count editor (Feature 1). 7 rows: weekday name, an
 * enabled toggle, a posts/day stepper, and an editable time list. A day with no
 * entry uses the global controls ("used when a day has no custom schedule").
 * Value is the dailySchedule array; onChange writes the full updated array.
 *
 * `showReelTimes` (YouTube tab only — gated by "Also publish to Instagram") renders
 * an inline per-day Instagram Reel-times editor in each Custom row. The Auto-Post
 * tab leaves it false, so IG-reel timing never appears there.
 */
function DayScheduleEditor({
  value, onChange, showReelTimes = false,
}: { value: DayScheduleEntry[]; onChange: (v: DayScheduleEntry[]) => void; showReelTimes?: boolean }) {
  const entryFor = (day: number) => value.find((e) => e.day === day) ?? null;

  const upsert = (day: number, patch: Partial<DayScheduleEntry>) => {
    const existing = entryFor(day);
    const base: DayScheduleEntry = existing ?? { day, enabled: true, postsPerDay: 1, times: [] };
    const next = { ...base, ...patch };
    const without = value.filter((e) => e.day !== day);
    onChange([...without, next].sort((a, b) => a.day - b.day));
  };

  const removeDay = (day: number) => onChange(value.filter((e) => e.day !== day));

  const addTime = (day: number, t: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return;
    const e = entryFor(day);
    const times = e ? e.times : [];
    if (times.includes(t)) return;
    upsert(day, { times: [...times, t].sort() });
  };

  const removeTime = (day: number, t: string) => {
    const e = entryFor(day);
    if (!e) return;
    upsert(day, { times: e.times.filter((x) => x !== t) });
  };

  // Per-day Reel slots: order is significant (catchup maps Short N → reelTimes[N]),
  // so append new slots rather than sorting.
  const addReelTime = (day: number, t: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return;
    const e = entryFor(day);
    const reelTimes = e?.reelTimes ?? [];
    if (reelTimes.includes(t)) return;
    upsert(day, { reelTimes: [...reelTimes, t] });
  };

  const removeReelTime = (day: number, t: string) => {
    const e = entryFor(day);
    if (!e) return;
    upsert(day, { reelTimes: (e.reelTimes ?? []).filter((x) => x !== t) });
  };

  return (
    <div className="space-y-2">
      {DAY_FULL.map((name, day) => {
        const e = entryFor(day);
        const active = !!e;
        return (
          <DayScheduleRow
            key={day}
            name={name}
            entry={e}
            active={active}
            showReelTimes={showReelTimes}
            onToggleActive={() => (active ? removeDay(day) : upsert(day, {}))}
            onToggleEnabled={(v) => upsert(day, { enabled: v })}
            onSetPosts={(n) => upsert(day, { postsPerDay: n })}
            onAddTime={(t) => addTime(day, t)}
            onRemoveTime={(t) => removeTime(day, t)}
            onAddReelTime={(t) => addReelTime(day, t)}
            onRemoveReelTime={(t) => removeReelTime(day, t)}
          />
        );
      })}
    </div>
  );
}

function DayScheduleRow({
  name, entry, active, showReelTimes,
  onToggleActive, onToggleEnabled, onSetPosts, onAddTime, onRemoveTime,
  onAddReelTime, onRemoveReelTime,
}: {
  name: string;
  entry: DayScheduleEntry | null;
  active: boolean;
  showReelTimes: boolean;
  onToggleActive: () => void;
  onToggleEnabled: (v: boolean) => void;
  onSetPosts: (n: number) => void;
  onAddTime: (t: string) => void;
  onRemoveTime: (t: string) => void;
  onAddReelTime: (t: string) => void;
  onRemoveReelTime: (t: string) => void;
}) {
  const [newTime, setNewTime] = useState("12:00");
  const [newReelTime, setNewReelTime] = useState("12:00");
  const dayOn = entry?.enabled ?? true;
  return (
    <div className={cn(
      "rounded-xl p-3 border transition-all",
      active ? "border-red-500/25 bg-red-500/[0.03]" : "border-white/[0.06] bg-white/[0.01]"
    )}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onToggleActive}
            className={cn(
              "px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all",
              active ? "border-red-500/40 text-red-300 bg-red-500/10"
                     : "border-white/[0.1] text-white/40 hover:text-white/70"
            )}
          >
            {active ? "Custom" : "Use global"}
          </button>
          <span className="text-sm font-medium text-white/80">{name}</span>
        </div>
        {active && (
          // Prominent per-day ON/OFF switch. OFF → this weekday generates nothing
          // (resolveDaySchedule returns null for a disabled custom day).
          <button
            onClick={() => onToggleEnabled(!dayOn)}
            className={cn(
              "px-3 py-1 rounded-lg text-[11px] font-bold border transition-all tracking-wide",
              dayOn ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                    : "border-white/[0.12] text-white/40 hover:text-white/70"
            )}
            aria-pressed={dayOn}
            title={dayOn ? "Publishing ON this day — click to turn off" : "Publishing OFF this day — click to turn on"}
          >
            {dayOn ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {active && (entry?.enabled ?? true) && (
        <div className="mt-3 space-y-3 pl-1">
          <div>
            <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">Posts</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => onSetPosts(n)}
                  className={cn(
                    "w-9 h-9 rounded-lg text-xs font-bold border transition-all",
                    (entry?.postsPerDay ?? 1) === n
                      ? "bg-gradient-to-br from-red-500/30 to-pink-500/20 text-white border-red-500/40"
                      : "border-white/[0.08] text-white/40 hover:text-white hover:border-white/20"
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">
              Times ({entry?.times.length ?? 0})
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {(entry?.times ?? []).map((t) => (
                <span key={t} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border border-white/10 text-white/80" style={{ background: "rgba(255,255,255,0.04)" }}>
                  <Clock size={11} className="text-red-400" />
                  {t}
                  <button onClick={() => onRemoveTime(t)} className="text-white/30 hover:text-red-400 transition-colors">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="time"
                value={newTime}
                onChange={(ev) => setNewTime(ev.target.value)}
                className="px-3 py-1.5 rounded-lg text-xs text-white outline-none font-mono"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
              />
              <button
                onClick={() => onAddTime(newTime)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-white border border-white/[0.12] hover:border-red-500/40 hover:text-red-300 transition-all flex items-center gap-1"
              >
                <Plus size={12} /> Add
              </button>
            </div>
          </div>

          {/* Per-day Instagram Reel times (Feature 1) — YouTube tab only, and only when
              "Also publish to Instagram (as Reels)" is ON. One Reel slot per Short. */}
          {showReelTimes && (
            <div className="pt-1">
              <label className="text-[11px] font-medium text-pink-300/60 block mb-1 uppercase tracking-wider">
                Instagram Reel times ({entry?.reelTimes?.length ?? 0})
              </label>
              <p className="text-[10px] text-white/30 mb-2 leading-relaxed">
                Add <strong className="text-white/45">one Reel time per Short</strong> for this day
                (match the {entry?.postsPerDay ?? 1} post{(entry?.postsPerDay ?? 1) !== 1 ? "s" : ""}/day above).
                Each Short&apos;s Reel is deferred to its slot in order. Empty → use the global Reel times.
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {(entry?.reelTimes ?? []).map((t, i) => (
                  <span key={`${t}-${i}`} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border border-pink-500/20 text-white/80" style={{ background: "rgba(236,72,153,0.06)" }}>
                    <Clock size={11} className="text-pink-400" />
                    {t}
                    <button onClick={() => onRemoveReelTime(t)} className="text-white/30 hover:text-pink-400 transition-colors">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="time"
                  value={newReelTime}
                  onChange={(ev) => setNewReelTime(ev.target.value)}
                  className="px-3 py-1.5 rounded-lg text-xs text-white outline-none font-mono"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
                />
                <button
                  onClick={() => onAddReelTime(newReelTime)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-white border border-white/[0.12] hover:border-pink-500/40 hover:text-pink-300 transition-all flex items-center gap-1"
                >
                  <Plus size={12} /> Add Reel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const TIMEZONES  = ["Asia/Kolkata", "UTC", "America/New_York", "America/Chicago", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];

function AutoPostTab() {
  const { brandId } = useSelectedBrand();
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [triggering,setTriggering]= useState(false);

  const [enabled,       setEnabled]       = useState(false);
  const [postsPerDay,   setPostsPerDay]   = useState(2);
  const [postTypes,     setPostTypes]     = useState<string[]>(["EDUCATIONAL", "CLINICAL_PEARL", "QUIZ", "CAROUSEL"]);
  const [topics,        setTopics]        = useState<string[]>([]);
  const [scheduleDays,  setScheduleDays]  = useState<number[]>([1, 2, 3, 4, 5]);
  const [scheduleTimes, setScheduleTimes] = useState<string[]>(["08:00", "19:00"]);
  const [timezone,      setTimezone]      = useState("Asia/Kolkata");
  const [autoPublish,   setAutoPublish]   = useState(false);
  const [publishToYouTube, setPublishToYouTube] = useState(false);
  const [dailySchedule, setDailySchedule] = useState<DayScheduleEntry[]>([]);
  const [customScheduleOnly, setCustomScheduleOnly] = useState(false);
  const [newTopic,      setNewTopic]      = useState("");
  const [newTime,       setNewTime]       = useState("12:00");

  useEffect(() => {
    setLoading(true);
    fetch(withBrand("/api/settings/auto-post", brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const cfg = d.data;
          setEnabled(cfg.enabled ?? false);
          setPostsPerDay(cfg.postsPerDay ?? 2);
          setPostTypes(cfg.postTypes ?? []);
          setTopics(cfg.topics ?? []);
          setScheduleDays(cfg.scheduleDays ?? [1,2,3,4,5]);
          setScheduleTimes(cfg.scheduleTimes ?? ["08:00","19:00"]);
          setTimezone(cfg.timezone ?? "Asia/Kolkata");
          setAutoPublish(cfg.autoPublish ?? false);
          setPublishToYouTube(cfg.publishToYouTube ?? false);
          setDailySchedule(Array.isArray(cfg.dailySchedule) ? cfg.dailySchedule : []);
          setCustomScheduleOnly(cfg.customScheduleOnly ?? false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving auto-post settings...");
    try {
      const res  = await fetch(withBrand("/api/settings/auto-post", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ enabled, postsPerDay, postTypes, topics, scheduleDays, scheduleTimes, timezone, autoPublish, publishToYouTube, dailySchedule, customScheduleOnly }),
      });
      const data = await res.json();
      if (data.success) toast.success("Auto-post settings saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    const tid = toast.loading(`Generating ${postsPerDay} post${postsPerDay > 1 ? "s" : ""}...`);
    try {
      const res  = await fetch("/api/auto-generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ count: postsPerDay, ...(brandId && { brand: brandId }) }),
      });
      const data = await res.json();
      if (data.success) {
        const n = data.data?.generated?.length ?? 0;
        toast.success(`${n} post${n !== 1 ? "s" : ""} generated and scheduled! 🎉`, { id: tid });
      } else {
        toast.error(data.error ?? "Auto-generation failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setTriggering(false);
    }
  };

  const toggleType = (id: string) =>
    setPostTypes((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);

  const toggleDay = (d: number) =>
    setScheduleDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

  const addTopic = () => {
    const t = newTopic.trim();
    if (!t || topics.includes(t)) return;
    setTopics((prev) => [...prev, t]);
    setNewTopic("");
  };

  const addTime = () => {
    if (!newTime || scheduleTimes.includes(newTime)) return;
    setScheduleTimes((prev) => [...prev, newTime].sort());
  };

  if (loading) return <SkeletonBlock rows={6} />;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Auto-Post Settings</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Automatically generate and schedule posts on a recurring basis. Posts are saved as drafts (or published) at your chosen times.
        </p>
      </div>

      {/* Master enable */}
      <div className={cn(
        "rounded-xl p-4 border transition-all",
        enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-white/[0.07] bg-white/[0.01]"
      )}>
        <Toggle
          label="Enable Auto-Generation"
          description={enabled ? "AI will automatically generate and schedule posts based on your settings below." : "Auto-generation is currently disabled."}
          value={enabled}
          onChange={setEnabled}
        />
      </div>

      <div className={cn("space-y-6 transition-opacity", !enabled && "opacity-40 pointer-events-none")}>

        {/* Posts per day */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">Posts Per Day</label>
          <div className="flex gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <motion.button
                key={n}
                whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                onClick={() => setPostsPerDay(n)}
                className={cn(
                  "w-12 h-12 rounded-xl text-sm font-bold border transition-all",
                  postsPerDay === n
                    ? "bg-gradient-to-br from-red-500/30 to-pink-500/20 text-white border-red-500/40"
                    : "border-white/[0.08] text-white/40 hover:text-white hover:border-white/20"
                )}
              >
                {n}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Post types */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Post Types to Include
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_POST_TYPES.map((pt) => (
              <motion.button
                key={pt.id}
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => toggleType(pt.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  postTypes.includes(pt.id)
                    ? "bg-gradient-to-r from-red-500/20 to-pink-500/10 text-white border-red-500/30"
                    : "border-white/[0.08] text-white/35 hover:text-white/70 hover:border-white/20"
                )}
              >
                {pt.emoji} {pt.label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Topics */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Rotating Topics ({topics.length})
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {topics.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 text-white/70"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                {t}
                <button
                  onClick={() => setTopics((prev) => prev.filter((x) => x !== t))}
                  className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTopic()}
              placeholder="e.g. Productivity tips, Industry trends..."
              className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              onFocus={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.5)"; }}
              onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={addTopic}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-red-500/40 hover:text-red-300 transition-all flex items-center gap-1.5"
            >
              <Plus size={13} /> Add
            </motion.button>
          </div>
        </div>

        {/* Schedule: Days */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Posting Days
          </label>
          <div className="flex gap-2 flex-wrap">
            {DAY_LABELS.map((label, idx) => (
              <motion.button
                key={idx}
                whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                onClick={() => toggleDay(idx)}
                className={cn(
                  "w-12 h-12 rounded-xl text-xs font-bold border transition-all",
                  scheduleDays.includes(idx)
                    ? "bg-gradient-to-br from-red-500/30 to-pink-500/20 text-white border-red-500/40"
                    : "border-white/[0.08] text-white/35 hover:text-white hover:border-white/20"
                )}
              >
                {label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Schedule: Times */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Posting Times ({scheduleTimes.length} slot{scheduleTimes.length !== 1 ? "s" : ""})
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {scheduleTimes.map((t) => (
              <span
                key={t}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-mono font-medium border border-white/10 text-white/80"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <Clock size={12} className="text-red-400" />
                {t}
                <button
                  onClick={() => setScheduleTimes((prev) => prev.filter((x) => x !== t))}
                  className="text-white/30 hover:text-red-400 transition-colors"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="px-4 py-2.5 rounded-xl text-sm text-white outline-none font-mono"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
            />
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={addTime}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-red-500/40 hover:text-red-300 transition-all flex items-center gap-1.5"
            >
              <Plus size={13} /> Add Time
            </motion.button>
          </div>
        </div>

        {/* Per-weekday schedule (Feature 1) */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-2 uppercase tracking-wider">
            Per-Day Schedule (optional)
          </label>
          <p className="text-xs text-white/30 mb-3 leading-relaxed">
            Override the posts-per-day and times for specific weekdays. Days left on
            <strong className="text-white/45"> “Use global”</strong> fall back to the global
            Posts Per Day, Posting Days and Posting Times above.
          </p>
          <DayScheduleEditor value={dailySchedule} onChange={setDailySchedule} />
          <div className="mt-3 rounded-xl px-4 border border-white/[0.07] bg-white/[0.01]">
            <Toggle
              label="Only post on custom days"
              description="Ignore the global Publishing Days/Times when a day has no custom schedule — post only on days you've configured above."
              value={customScheduleOnly}
              onChange={setCustomScheduleOnly}
            />
          </div>
        </div>

        {/* Timezone + auto-publish */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassSelect label="Timezone" value={timezone} onChange={setTimezone} options={TIMEZONES} />
          <div>
            <label className="text-xs font-medium text-white/40 block mb-2.5 uppercase tracking-wider">
              After Generation
            </label>
            <div className="flex gap-2">
              {[
                { value: false, label: "Save as Draft" },
                { value: true,  label: "Auto-Publish" },
              ].map((opt) => (
                <button
                  key={String(opt.value)}
                  onClick={() => setAutoPublish(opt.value)}
                  className={cn(
                    "flex-1 py-3 rounded-xl text-xs font-semibold border transition-all",
                    autoPublish === opt.value
                      ? opt.value
                        ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                        : "bg-red-500/15 border-red-500/30 text-red-300"
                      : "border-white/[0.08] text-white/35 hover:text-white/70 hover:border-white/20"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Cross-post to YouTube — DISABLED.
            YouTube has no API to create community/image posts, so Instagram feed
            posts can't be cross-posted there. The toggle stays visible (so users
            understand why) but is non-interactive. Use the YouTube tab to auto-
            publish Shorts independently. */}
        <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
          <Toggle
            label="Also publish to YouTube"
            description="Auto-generated Instagram posts are also uploaded to YouTube as Shorts."
            value={publishToYouTube}
            onChange={setPublishToYouTube}
            disabled
          />
          <p className="text-xs text-amber-300/70 mt-2 leading-relaxed">
            YouTube doesn&apos;t support image/community posts via its API, so Instagram posts stay on Instagram.
            Use the YouTube tab to auto-publish Shorts.
          </p>
        </div>

      </div>

      {/* Action row */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={handleTrigger}
          disabled={triggering || !postTypes.length || !topics.length}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white border border-white/[0.12] hover:border-red-500/40 transition-all disabled:opacity-40"
          style={{ background: "rgba(239,68,68,0.1)" }}
        >
          {triggering ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {triggering ? "Generating..." : `Generate ${postsPerDay} Post${postsPerDay > 1 ? "s" : ""} Now`}
        </motion.button>
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STORIES TAB
// ─────────────────────────────────────────────────────────────────────────────
function StoriesTab() {
  const { brandId } = useSelectedBrand();
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [triggering,setTriggering]= useState(false);

  const [enabled,      setEnabled]      = useState(true);
  const [postTime,     setPostTime]     = useState("09:00");
  const [scheduleDays, setScheduleDays] = useState<number[]>([0,1,2,3,4,5,6]);
  const [topics,       setTopics]       = useState<string[]>([]);
  const [customPromptExtra, setCustomPromptExtra] = useState("");
  const [publishToYouTube, setPublishToYouTube] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  // AI provider for dynamic label
  const [aiProvider, setAiProvider] = useState<"grok" | "gemini">("grok");
  useEffect(() => {
    fetch("/api/settings/ai").then(r => r.json()).then(d => {
      if (d.success) setAiProvider(d.data.aiProvider ?? "grok");
    }).catch(() => {});
  }, []);
  const aiLabel = aiProvider === "gemini" ? "Gemini ✨" : "Groq (Llama) 🤖";

  useEffect(() => {
    setLoading(true);
    fetch(withBrand("/api/settings/stories", brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const cfg = d.data;
          setEnabled(cfg.enabled ?? true);
          setPostTime(cfg.postTime ?? "09:00");
          setScheduleDays(cfg.scheduleDays ?? [0,1,2,3,4,5,6]);
          setTopics(cfg.topics ?? []);
          setCustomPromptExtra(cfg.customPromptExtra ?? "");
          setPublishToYouTube(cfg.publishToYouTube ?? false);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving story settings...");
    try {
      const res  = await fetch(withBrand("/api/settings/stories", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ enabled, postTime, scheduleDays, topics, customPromptExtra, publishToYouTube }),
      });
      const data = await res.json();
      if (data.success) toast.success("Story settings saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerNow = async () => {
    setTriggering(true);
    const tid = toast.loading("Generating & publishing a story now...");
    try {
      const res  = await fetch(withBrand("/api/stories/generate-now", brandId), { method: "POST" });
      const data = await res.json();
      if (data.success) toast.success(data.data?.message ?? "Story published to Instagram! 🎉", { id: tid });
      else toast.error(data.error ?? "Story publish failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setTriggering(false);
    }
  };

  const toggleDay = (d: number) =>
    setScheduleDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort());

  const addTopic = () => {
    const t = newTopic.trim();
    if (!t || topics.includes(t)) return;
    setTopics((prev) => [...prev, t]);
    setNewTopic("");
  };

  if (loading) return <SkeletonBlock rows={5} />;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Stories Settings</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Auto-generate and post one Instagram Story per day. Stories focus on quick, helpful tips for your audience.
        </p>
      </div>

      {/* Master enable */}
      <div className={cn(
        "rounded-xl p-4 border transition-all",
        enabled ? "border-fuchsia-500/30 bg-fuchsia-500/5" : "border-white/[0.07] bg-white/[0.01]"
      )}>
        <Toggle
          label="Enable Daily Auto-Story"
          description={enabled ? "One story will auto-generate and post each day at your chosen time." : "Auto-story posting is currently disabled."}
          value={enabled}
          onChange={setEnabled}
        />
      </div>

      <div className={cn("space-y-6 transition-opacity", !enabled && "opacity-40 pointer-events-none")}>

        {/* Post time */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Daily Post Time (IST)
          </label>
          <div className="flex items-center gap-3">
            <input
              type="time"
              value={postTime}
              onChange={(e) => setPostTime(e.target.value)}
              className="px-4 py-3 rounded-xl text-sm text-white outline-none font-mono"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
            />
            <span className="text-xs text-white/30">IST  -  stories post at this time every selected day</span>
          </div>
        </div>

        {/* Active days */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Active Days
          </label>
          <div className="flex gap-2 flex-wrap">
            {DAY_LABELS.map((label, idx) => (
              <motion.button
                key={idx}
                whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                onClick={() => toggleDay(idx)}
                className={cn(
                  "w-12 h-12 rounded-xl text-xs font-bold border transition-all",
                  scheduleDays.includes(idx)
                    ? "text-white border-fuchsia-500/40"
                    : "border-white/[0.08] text-white/35 hover:text-white hover:border-white/20"
                )}
                style={scheduleDays.includes(idx) ? { background: "linear-gradient(135deg, rgba(192,38,211,0.3), rgba(139,92,246,0.2))" } : {}}
              >
                {label}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Topics */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Topic Rotation ({topics.length} topics)
          </label>
          <p className="text-[11px] text-white/25 mb-3 leading-relaxed">
            {aiLabel} picks one topic per day to generate the story. Add topics you want to cover.
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {topics.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-fuchsia-500/20 text-white/70"
                style={{ background: "rgba(192,38,211,0.08)" }}
              >
                {t}
                <button
                  onClick={() => setTopics((prev) => prev.filter((x) => x !== t))}
                  className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTopic()}
              placeholder="e.g. Quick how-to tips, Behind-the-scenes ideas..."
              className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              onFocus={(e) => { e.target.style.borderColor = "rgba(192,38,211,0.5)"; }}
              onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={addTopic}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-fuchsia-500/40 hover:text-fuchsia-300 transition-all flex items-center gap-1.5"
            >
              <Plus size={13} /> Add
            </motion.button>
          </div>
        </div>

        {/* Custom prompt extra */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-2 uppercase tracking-wider">
            Extra Prompt Instructions (optional)
          </label>
          <textarea
            value={customPromptExtra}
            onChange={(e) => setCustomPromptExtra(e.target.value)}
            rows={4}
            placeholder="e.g. Always mention a specific statistic. Use an encouraging tone. Keep it under 150 chars..."
            className="w-full text-sm text-white/80 leading-relaxed resize-y outline-none rounded-xl px-4 py-3 placeholder-white/20"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "monospace" }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(192,38,211,0.4)"; }}
            onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.06)"; }}
          />
          <p className="text-[11px] text-white/25 mt-1.5">
            Appended to the story generation prompt. Leave blank for the default style.
          </p>
        </div>

        {/* Cross-post to YouTube */}
        <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
          <Toggle
            label="Also publish to YouTube"
            description="The daily story is also published to YouTube as a Short."
            value={publishToYouTube}
            onChange={setPublishToYouTube}
          />
        </div>

        {/* Info box */}
        <div className="rounded-xl p-4 border border-fuchsia-500/15" style={{ background: "rgba(192,38,211,0.04)" }}>
          <p className="text-xs font-semibold text-fuchsia-400 mb-2">📖 How auto-stories work</p>
          <ul className="text-[11px] text-white/45 space-y-1.5 leading-relaxed">
            <li>• Every 10 minutes the system checks if today's story is scheduled</li>
            <li>• If not, {aiLabel} generates a headline + tip based on your topics above</li>
            <li>• A branded 1080×1920 card is generated and published to Instagram</li>
            <li>• Stories expire after 24 hours on Instagram automatically</li>
            <li>• Requires Cloudinary credentials in .env.local for image hosting</li>
          </ul>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
        <motion.button
          whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
          onClick={handleTriggerNow}
          disabled={triggering || !enabled}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white border border-white/[0.12] hover:border-fuchsia-500/40 transition-all disabled:opacity-40"
          style={{ background: "rgba(192,38,211,0.1)" }}
        >
          {triggering ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {triggering ? "Triggering..." : "Post a Story Now"}
        </motion.button>
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS TAB
// ─────────────────────────────────────────────────────────────────────────────
function NotificationsTab() {
  const [loading,           setLoading]           = useState(true);
  const [saving,            setSaving]            = useState(false);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notifs,            setNotifs]            = useState({
    emailPublish: true, emailAnalytics: true, emailFails: true,
    pushPublish: false, pushComments: false, pushWeeklyReport: true,
  });

  useEffect(() => {
    fetch("/api/settings/notifications")
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const { notificationEmail: ne, ...rest } = d.data;
          setNotifs(rest);
          setNotificationEmail(ne ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (key: keyof typeof notifs) => (v: boolean) =>
    setNotifs((prev) => ({ ...prev, [key]: v }));

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving notification preferences...");
    try {
      const res  = await fetch("/api/settings/notifications", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...notifs, notificationEmail }),
      });
      const data = await res.json();
      if (data.success) toast.success("Notification preferences saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={4} />;

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Notification Preferences</h3>

      {/* Alert email address */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }}>
        <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">🚨 Failure Alert Email</p>
        <GlassInput
          label="Recipient Email Address"
          type="email"
          value={notificationEmail}
          onChange={setNotificationEmail}
          placeholder="you@example.com"
        />
        <div className="text-[10px] text-white/35 leading-relaxed space-y-1">
          <p>Emails are sent via SMTP when: posts fail to publish, API rate limits hit, webhook goes down, or story fails.</p>
          <p>Configure SMTP in Railway env vars: <code className="text-red-300/70 bg-red-900/20 px-1 rounded">SMTP_HOST</code> <code className="text-red-300/70 bg-red-900/20 px-1 rounded">SMTP_USER</code> <code className="text-red-300/70 bg-red-900/20 px-1 rounded">SMTP_PASS</code></p>
          <p>For Gmail: use smtp.gmail.com + port 587 + an App Password (not your account password).</p>
        </div>
      </div>

      {/* Info banner */}
      <div className="rounded-xl p-3.5 border border-white/[0.06] flex items-start gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
        <AlertCircle size={14} className="text-white/30 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs text-white/50 leading-relaxed">
            Failure alerts are <strong className="text-white/70">active</strong> once SMTP is configured. Real-time in-app alerts appear in the notification bell (top-right) regardless.
          </p>
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-white/50 mb-3">📧 Email Notifications</p>
        <div className="rounded-xl border border-white/[0.06] px-4" style={{ background: "rgba(255,255,255,0.02)" }}>
          <Toggle label="Post Published"    description="Get notified when a post goes live"   value={notifs.emailPublish}   onChange={set("emailPublish")} />
          <Toggle label="Analytics Reports" description="Weekly performance summaries"         value={notifs.emailAnalytics} onChange={set("emailAnalytics")} />
          <Toggle label="Publish Failures"  description="Alert when a post fails to publish"  value={notifs.emailFails}     onChange={set("emailFails")} />
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-white/50 mb-3">🔔 Push Notifications <span className="text-[10px] font-medium text-amber-300/70 uppercase tracking-wider">(coming soon)</span></p>
        <p className="text-xs text-white/35 mb-3 leading-relaxed">Browser push notifications aren&apos;t active yet. These toggles are saved but have no effect until web-push support ships.</p>
        <div className="rounded-xl border border-white/[0.06] px-4" style={{ background: "rgba(255,255,255,0.02)" }}>
          <Toggle label="Post Published (coming soon)"  description="Browser push when post goes live"        value={notifs.pushPublish}      onChange={set("pushPublish")}      disabled />
          <Toggle label="New Comments (coming soon)"    description="When you receive Instagram comments"     value={notifs.pushComments}     onChange={set("pushComments")}     disabled />
          <Toggle label="Weekly Report (coming soon)"   description="Summary every Monday morning"           value={notifs.pushWeeklyReport} onChange={set("pushWeeklyReport")} disabled />
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DANGER ZONE TAB
// ─────────────────────────────────────────────────────────────────────────────
function DangerTab() {
  const [busy, setBusy] = useState<string | null>(null);

  const confirm = (message: string) => window.confirm(message);

  const runAction = async (action: string, confirmMsg: string, successMsg: string) => {
    if (!confirm(confirmMsg)) return;
    setBusy(action);
    const tid = toast.loading("Processing...");
    try {
      const res  = await fetch("/api/settings/danger", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        const count = data.data?.deleted ?? data.data?.cancelled ?? null;
        toast.success(`${successMsg}${count !== null ? ` (${count} items)` : ""}`, { id: tid });
      } else {
        toast.error(data.error ?? "Action failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setBusy(null);
    }
  };

  const actions = [
    {
      id:          "delete-drafts",
      title:       "Delete All Drafts",
      description: "Permanently delete all draft posts. Published posts are not affected.",
      label:       "Delete Drafts",
      icon:        Trash2,
      confirm:     "Delete ALL draft posts? This cannot be undone.",
      success:     "All drafts deleted",
    },
    {
      id:          "delete-scheduled",
      title:       "Cancel All Scheduled Posts",
      description: "Cancel all pending scheduled posts and return them to Draft status.",
      label:       "Cancel Scheduled",
      icon:        Calendar,
      confirm:     "Cancel ALL pending scheduled posts?",
      success:     "Scheduled posts cancelled",
    },
    {
      id:          "clear-library",
      title:       "Clear Entire Content Library",
      description: "Permanently delete ALL posts (drafts, scheduled, and published records).",
      label:       "Clear Library",
      icon:        Trash2,
      confirm:     "⚠️ Delete ALL posts including published records? This cannot be undone.",
      success:     "Content library cleared",
    },
    {
      id:          "reset-ai",
      title:       "Reset AI Settings",
      description: "Reset all AI configuration preferences back to factory defaults.",
      label:       "Reset AI Config",
      icon:        RotateCcw,
      confirm:     "Reset all AI settings to defaults?",
      success:     "AI settings reset to defaults",
    },
    {
      id:          "clear-activity",
      title:       "Clear Activity Log",
      description: "Wipe all activity log entries. Useful for a fresh start.",
      label:       "Clear Log",
      icon:        Activity,
      confirm:     "Delete the entire activity log?",
      success:     "Activity log cleared",
    },
  ];

  return (
    <div className="space-y-5">
      <h3 className="text-base font-bold text-red-400" style={{ fontFamily: "Sora, sans-serif" }}>Danger Zone</h3>
      <p className="text-sm text-white/40 -mt-2">These actions are permanent and cannot be undone. A confirmation dialog will appear before each action.</p>

      <div className="space-y-3">
        {actions.map((item) => (
          <motion.div key={item.id}
            className="flex items-start justify-between gap-4 p-4 rounded-xl border border-red-500/15"
            style={{ background: "rgba(239,68,68,0.04)" }}
            whileHover={{ borderColor: "rgba(239,68,68,0.25)" }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white/80">{item.title}</p>
              <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{item.description}</p>
            </div>
            <motion.button
              whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              disabled={busy === item.id}
              onClick={() => runAction(item.id, item.confirm, item.success)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold text-red-400 border border-red-500/20 hover:bg-red-500/15 transition-all flex-shrink-0 disabled:opacity-50"
            >
              {busy === item.id ? <Loader2 size={12} className="animate-spin" /> : <item.icon size={12} />}
              {busy === item.id ? "Working..." : item.label}
            </motion.button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WEBHOOK TAB
// ─────────────────────────────────────────────────────────────────────────────
interface DebugData {
  summary: { webhookWorking: boolean; issueCount: number; issues: string[]; overallStatus: string };
  webhookUrl: string;
  urlChecks: { isHttps: boolean; isLocalhost: boolean; ok: boolean | null };
  appSecret: { set: boolean; hmacWorks: boolean | string; maskedValue: string };
  verifyToken: { set: boolean; effectiveValue: string; note: string };
  subscriptions: { raw: string[]; comments: boolean; messages: boolean; mentions: boolean; error: string | null };
  recentActivity: { windowHours: number; comments: number; dms: number; total: number; note: string };
  fixSteps: Array<{ step: number; title: string; done: boolean; instruction: string }>;
  ngrokStatus: {
    needed: boolean;
    configured: boolean;
    reachable: boolean | null;
    url: string | null;
    state: "needed" | "active" | "unreachable" | "custom-domain" | "unknown";
    hint: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// YOUTUBE TAB
// ─────────────────────────────────────────────────────────────────────────────
function YouTubeTab() {
  const { brandId } = useSelectedBrand();
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);

  const [enabled,           setEnabled]           = useState(false);
  const [privacy,           setPrivacy]           = useState("public");
  const [secondsPerImage,   setSecondsPerImage]   = useState(5);
  const [postsPerDay,       setPostsPerDay]       = useState(1);
  const [descriptionSuffix, setDescriptionSuffix] = useState("");
  const [replyToComments,   setReplyToComments]   = useState(true);
  const [topics,            setTopics]            = useState<string[]>([]);
  const [postTypes,         setPostTypes]         = useState<string[]>(["EDUCATIONAL", "CLINICAL_PEARL", "PREVENTIVE"]);
  const [customPromptExtra, setCustomPromptExtra] = useState("");
  const [postTimes,         setPostTimes]         = useState<string[]>(["19:00"]);
  const [scheduleDays,      setScheduleDays]      = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [publishToInstagram, setPublishToInstagram] = useState(false);
  const [voiceover,         setVoiceover]         = useState(false);
  const [voiceoverVoice,    setVoiceoverVoice]    = useState("daniel");
  const [burnCaptions,      setBurnCaptions]      = useState(false);
  const [dailySchedule,     setDailySchedule]     = useState<DayScheduleEntry[]>([]);
  const [customScheduleOnly, setCustomScheduleOnly] = useState(false);
  const [reelPublishTimes,  setReelPublishTimes]  = useState<string[]>([]);
  const [newReelTime,       setNewReelTime]       = useState("12:00");
  const [newTopic,          setNewTopic]          = useState("");
  const [newTime,           setNewTime]           = useState("19:00");
  const [status, setStatus] = useState<{ configured: boolean; ok: boolean; channel?: string; error?: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(withBrand("/api/settings/youtube", brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          const cfg = d.data;
          setEnabled(cfg.enabled ?? false);
          setPrivacy(cfg.privacy ?? "public");
          setSecondsPerImage(cfg.secondsPerImage ?? 5);
          setPostsPerDay(cfg.postsPerDay ?? 1);
          setDescriptionSuffix(cfg.descriptionSuffix ?? "");
          setReplyToComments(cfg.replyToComments ?? true);
          setTopics(cfg.topics ?? []);
          setPostTypes(cfg.postTypes ?? ["EDUCATIONAL", "CLINICAL_PEARL", "PREVENTIVE"]);
          setCustomPromptExtra(cfg.customPromptExtra ?? "");
          setPostTimes(cfg.postTimes ?? ["19:00"]);
          setScheduleDays(cfg.scheduleDays ?? [0, 1, 2, 3, 4, 5, 6]);
          setPublishToInstagram(cfg.publishToInstagram ?? false);
          setVoiceover(cfg.voiceover ?? false);
          setVoiceoverVoice(cfg.voiceoverVoice ?? "daniel");
          setBurnCaptions(cfg.burnCaptions ?? false);
          setDailySchedule(Array.isArray(cfg.dailySchedule) ? cfg.dailySchedule : []);
          setCustomScheduleOnly(cfg.customScheduleOnly ?? false);
          setReelPublishTimes(Array.isArray(cfg.reelPublishTimes) ? cfg.reelPublishTimes : []);
          setStatus(d.status ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const toggleDay = (d: number) =>
    setScheduleDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b));

  const toggleType = (id: string) =>
    setPostTypes((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]);

  const addTopic = () => {
    const t = newTopic.trim();
    if (!t || topics.includes(t)) return;
    setTopics((prev) => [...prev, t]);
    setNewTopic("");
  };

  const addTime = () => {
    if (!newTime || postTimes.includes(newTime)) return;
    setPostTimes((prev) => [...prev, newTime].sort());
  };

  const addReelTime = () => {
    if (!newReelTime || reelPublishTimes.includes(newReelTime)) return;
    setReelPublishTimes((prev) => [...prev, newReelTime].sort());
  };

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving YouTube settings...");
    try {
      const res  = await fetch(withBrand("/api/settings/youtube", brandId), {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ enabled, privacy, secondsPerImage, postsPerDay, descriptionSuffix, replyToComments, topics, postTypes, customPromptExtra, postTimes, scheduleDays, publishToInstagram, voiceover, voiceoverVoice, burnCaptions, dailySchedule, customScheduleOnly, reelPublishTimes }),
      });
      const data = await res.json();
      if (data.success) toast.success("YouTube settings saved ✅", { id: tid });
      else              toast.error(data.error ?? "Save failed", { id: tid });
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={5} />;

  const connected = status?.configured && status?.ok;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>YouTube Settings</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Mirror every published post to YouTube as a vertical <strong className="text-white/50">Short</strong>.
          The same card images are stitched into a 1080×1920 video and uploaded automatically — on the same schedule as Instagram.
        </p>
      </div>

      {/* Connection status */}
      <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <Youtube size={16} className={connected ? "text-emerald-400" : status?.configured ? "text-red-400" : "text-white/30"} />
          <div>
            <p className="text-sm text-white/80 font-medium">
              {connected ? `Connected  -  ${status?.channel ?? "YouTube"}`
                : status?.configured ? "Credentials set but not working"
                : "Not configured"}
            </p>
            <p className="text-xs text-white/35 mt-0.5">
              {connected ? "Refresh token is valid — uploads will work."
                : status?.error
                ? status.error
                : "Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET and YOUTUBE_REFRESH_TOKEN in your environment."}
            </p>
            <p className="text-[11px] text-white/30 mt-1.5 leading-relaxed">
              The refresh token is never entered here — it lives in the{" "}
              <code className="text-white/40">YOUTUBE_REFRESH_TOKEN</code> env var. Generate one with{" "}
              <code className="text-white/40">npm run youtube:auth</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Master enable */}
      <div className={cn(
        "rounded-xl p-4 border transition-all",
        enabled ? "border-red-500/30 bg-red-500/5" : "border-white/[0.07] bg-white/[0.01]"
      )}>
        <Toggle
          label="Enable YouTube auto-poster & comment replies"
          description={enabled
            ? "YouTube generates its own Shorts from the topics below and the AI auto-replies to comments. (Cross-posting from Instagram is controlled by the 'Also publish to YouTube' toggles in the Auto-Post and Stories tabs.)"
            : "The YouTube auto-poster and comment replies are off. Cross-posting from Instagram is still controlled by the Auto-Post / Stories toggles."}
          value={enabled}
          onChange={setEnabled}
        />
      </div>

      <div className={cn("space-y-6 transition-opacity", !enabled && "opacity-40 pointer-events-none")}>
        {/* Privacy */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">Video Privacy</label>
          <div className="flex gap-2">
            {["public", "unlisted", "private"].map((p) => (
              <button
                key={p}
                onClick={() => setPrivacy(p)}
                className={cn(
                  "px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all",
                  privacy === p ? "text-white" : "text-white/40 bg-white/[0.03] hover:bg-white/[0.06]"
                )}
                style={privacy === p ? { background: "linear-gradient(135deg, #ef4444, #ec4899)" } : {}}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        {/* Seconds per image */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Seconds per card ({secondsPerImage}s)
          </label>
          <input
            type="range" min={2} max={15} step={1}
            value={secondsPerImage}
            onChange={(e) => setSecondsPerImage(Number(e.target.value))}
            className="w-full max-w-md accent-red-500"
          />
          <p className="text-xs text-white/30 mt-2">
            How long each card stays on screen. Carousels show one card after another (capped at ~58s total).
          </p>
        </div>

        {/* Posts per day */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">Posts Per Day</label>
          <div className="flex gap-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <motion.button
                key={n}
                whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                onClick={() => setPostsPerDay(n)}
                className={cn(
                  "w-12 h-12 rounded-xl text-sm font-bold border transition-all",
                  postsPerDay === n
                    ? "bg-gradient-to-br from-red-500/30 to-pink-500/20 text-white border-red-500/40"
                    : "border-white/[0.08] text-white/40 hover:text-white hover:border-white/20"
                )}
              >
                {n}
              </motion.button>
            ))}
          </div>
          <p className="text-xs text-white/30 mt-2">
            How many YouTube Shorts the auto-poster generates and schedules each day, distributed across the post times below.
          </p>
        </div>


        {/* Description suffix */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Description footer (optional)
          </label>
          <textarea
            value={descriptionSuffix}
            onChange={(e) => setDescriptionSuffix(e.target.value)}
            rows={3}
            placeholder="e.g. Follow @yourhandle for daily tips."
            className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none resize-none"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <p className="text-xs text-white/30 mt-2">Appended to every YouTube description. <code className="text-white/40">#Shorts</code> is added automatically.</p>
        </div>

        {/* Auto-reply to comments */}
        <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
          <Toggle
            label="Auto-reply to YouTube comments"
            description="Let the AI generate and post replies to comments on your YouTube videos."
            value={replyToComments}
            onChange={setReplyToComments}
          />
        </div>

        {/* Posts / Shorts timing */}
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold text-white/70">Posts / Shorts Timing</p>
            <p className="text-xs text-white/30 mt-1 leading-relaxed">
              YouTube Shorts currently publish alongside the Instagram schedule (mirroring). These timing
              preferences apply to YouTube-targeted generation.
            </p>
          </div>

          {/* Cross-post to Instagram */}
          <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
            <Toggle
              label="Also publish to Instagram (as Reels)"
              description="YouTube-native auto-posts are also published to Instagram as Reels."
              value={publishToInstagram}
              onChange={setPublishToInstagram}
            />

            {/* Separate Reel publish timing (Feature 2) */}
            {publishToInstagram && (
              <div className="mt-4 pt-3 border-t border-white/[0.05]">
                <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                  Instagram Reel publish times ({reelPublishTimes.length})
                  <span className="ml-1.5 normal-case tracking-normal text-[10px] text-white/25 font-normal">(global — used when a day has no per-day Reel times)</span>
                </label>
                <p className="text-xs text-white/30 mb-3 leading-relaxed">
                  When set, the Short publishes on its own schedule but its Instagram Reel is
                  <strong className="text-white/45"> deferred</strong> to the next time below.
                  Leave empty to cross-post the Reel immediately when the Short goes live.
                  Per-day Reel times in the schedule below override these for that weekday.
                </p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {reelPublishTimes.map((t) => (
                    <span
                      key={t}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-mono font-medium border border-white/10 text-white/80"
                      style={{ background: "rgba(255,255,255,0.04)" }}
                    >
                      <Clock size={12} className="text-red-400" />
                      {t}
                      <button
                        onClick={() => setReelPublishTimes((prev) => prev.filter((x) => x !== t))}
                        className="text-white/30 hover:text-red-400 transition-colors"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="time"
                    value={newReelTime}
                    onChange={(e) => setNewReelTime(e.target.value)}
                    className="px-4 py-2.5 rounded-xl text-sm text-white outline-none font-mono"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
                  />
                  <motion.button
                    whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                    onClick={addReelTime}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-red-500/40 hover:text-red-300 transition-all flex items-center gap-1.5"
                  >
                    <Plus size={13} /> Add Reel Time
                  </motion.button>
                </div>
              </div>
            )}
          </div>

          {/* AI voiceover + word-by-word captions (beta) */}
          <div className="rounded-xl p-4 border border-white/[0.07] bg-white/[0.01]">
            <Toggle
              label="AI voiceover + word-by-word captions (beta)"
              description="Narrates each Short with an AI voice and burns in synced captions. Adds render time — uses Groq-hosted Orpheus (or your self-hosted Canopy/Orpheus endpoint)."
              value={voiceover}
              onChange={setVoiceover}
            />
            {voiceover && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">
                  Narration voice
                </label>
                <select
                  value={voiceoverVoice}
                  onChange={(e) => setVoiceoverVoice(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none transition-all"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                >
                  <optgroup label="Male" style={{ background: "#111118" }}>
                    <option value="daniel" style={{ background: "#111118" }}>Daniel — warm, natural (recommended)</option>
                    <option value="austin" style={{ background: "#111118" }}>Austin — bright, energetic</option>
                    <option value="troy"   style={{ background: "#111118" }}>Troy — deep, authoritative</option>
                  </optgroup>
                  <optgroup label="Female" style={{ background: "#111118" }}>
                    <option value="autumn" style={{ background: "#111118" }}>Autumn — warm, friendly</option>
                    <option value="diana"  style={{ background: "#111118" }}>Diana — calm, clear</option>
                    <option value="hannah" style={{ background: "#111118" }}>Hannah — soft, youthful</option>
                  </optgroup>
                </select>
                <p className="text-[11px] text-white/35 mt-2 leading-relaxed">
                  The voice that narrates every Short. Changes apply to the next generated Short.
                </p>

                <div className="mt-4 pt-4 border-t border-white/[0.06]">
                  <Toggle
                    label="Burn captions into the video"
                    description="OFF (recommended): no hardcoded captions, so YouTube auto-generates captions and auto-translates them per viewer's location/language. ON: hardcoded word-by-word captions (same text for everyone, can't be translated)."
                    value={burnCaptions}
                    onChange={setBurnCaptions}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl p-3.5 border border-white/[0.06] flex items-start gap-3" style={{ background: "rgba(255,255,255,0.02)" }}>
            <AlertCircle size={14} className="text-white/30 flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-white/40 leading-relaxed">
              When <strong className="text-white/55">Auto-Post → Also publish to YouTube</strong> is OFF, the YouTube
              auto-poster generates its own Shorts from the YouTube topics list below (auto-expanding with no repeats).
            </p>
          </div>

          {/* Days */}
          <div>
            <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
              Publishing Days
              <span className="ml-1.5 normal-case tracking-normal text-[10px] text-white/25 font-normal">(global — used when a day is set to “Use global”)</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {DAY_LABELS.map((label, idx) => (
                <motion.button
                  key={idx}
                  whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.96 }}
                  onClick={() => toggleDay(idx)}
                  className={cn(
                    "w-12 h-12 rounded-xl text-xs font-bold border transition-all",
                    scheduleDays.includes(idx)
                      ? "bg-gradient-to-br from-red-500/30 to-pink-500/20 text-white border-red-500/40"
                      : "border-white/[0.08] text-white/35 hover:text-white hover:border-white/20"
                  )}
                >
                  {label}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Times */}
          <div>
            <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
              Publish Times ({postTimes.length} slot{postTimes.length !== 1 ? "s" : ""})
              <span className="ml-1.5 normal-case tracking-normal text-[10px] text-white/25 font-normal">(global — used when a day is set to “Use global”)</span>
            </label>
            <div className="flex flex-wrap gap-2 mb-3">
              {postTimes.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-mono font-medium border border-white/10 text-white/80"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <Clock size={12} className="text-red-400" />
                  {t}
                  <button
                    onClick={() => setPostTimes((prev) => prev.filter((x) => x !== t))}
                    className="text-white/30 hover:text-red-400 transition-colors"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="px-4 py-2.5 rounded-xl text-sm text-white outline-none font-mono"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", colorScheme: "dark" }}
              />
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={addTime}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-red-500/40 hover:text-red-300 transition-all flex items-center gap-1.5"
              >
                <Plus size={13} /> Add Time
              </motion.button>
            </div>
          </div>

          {/* Per-weekday schedule (Feature 1) */}
          <div>
            <label className="text-xs font-medium text-white/40 block mb-2 uppercase tracking-wider">
              Per-Day Schedule (optional)
            </label>
            <p className="text-xs text-white/30 mb-3 leading-relaxed">
              Override posts-per-day and publish times for specific weekdays. Days left on
              <strong className="text-white/45"> “Use global”</strong> fall back to the global
              Posts Per Day, Publishing Days and Publish Times above. Use the
              <strong className="text-emerald-300/70"> ON/OFF</strong> switch to skip a custom day entirely.
              {publishToInstagram && " Custom days can also set their own Instagram Reel times (one per Short)."}
            </p>
            <DayScheduleEditor value={dailySchedule} onChange={setDailySchedule} showReelTimes={publishToInstagram} />
            <div className="mt-3 rounded-xl px-4 border border-white/[0.07] bg-white/[0.01]">
              <Toggle
                label="Only post on custom days"
                description="Ignore the global Publishing Days/Times when a day has no custom schedule — publish only on days you've configured above."
                value={customScheduleOnly}
                onChange={setCustomScheduleOnly}
              />
            </div>
          </div>
        </div>

        {/* Post types to publish as Shorts */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Which content types to publish as Shorts
          </label>
          <div className="flex flex-wrap gap-2">
            {ALL_POST_TYPES.map((pt) => (
              <motion.button
                key={pt.id}
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                onClick={() => toggleType(pt.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
                  postTypes.includes(pt.id)
                    ? "bg-gradient-to-r from-red-500/20 to-pink-500/10 text-white border-red-500/30"
                    : "border-white/[0.08] text-white/35 hover:text-white/70 hover:border-white/20"
                )}
              >
                {pt.emoji} {pt.label}
              </motion.button>
            ))}
          </div>
          <p className="text-xs text-white/30 mt-2">Only these post types will be auto-published as YouTube Shorts.</p>
        </div>

        {/* Topics */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            YouTube Topics ({topics.length})
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {topics.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 text-white/70"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                {t}
                <button
                  onClick={() => setTopics((prev) => prev.filter((x) => x !== t))}
                  className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTopic()}
              placeholder="e.g. Tutorials, Industry insights..."
              className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
              onFocus={(e) => { e.target.style.borderColor = "rgba(239,68,68,0.5)"; }}
              onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
            />
            <motion.button
              whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
              onClick={addTopic}
              className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-red-500/40 hover:text-red-300 transition-all flex items-center gap-1.5"
            >
              <Plus size={13} /> Add
            </motion.button>
          </div>
        </div>

        {/* Prompts */}
        <div>
          <label className="text-xs font-medium text-white/40 block mb-3 uppercase tracking-wider">
            Extra Prompt Instructions
          </label>
          <textarea
            value={customPromptExtra}
            onChange={(e) => setCustomPromptExtra(e.target.value)}
            rows={4}
            placeholder="e.g. Keep hooks punchy for Shorts. Add a strong call-to-subscribe in the first line."
            className="w-full px-4 py-3 rounded-xl text-sm text-white outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
          <p className="text-xs text-white/30 mt-2">Appended to the base prompt when generating YouTube-targeted content.</p>
        </div>

        <div className="rounded-xl p-4 border border-red-500/15 bg-red-500/[0.03]">
          <p className="text-xs font-semibold text-red-400 mb-2">▶ How YouTube mirroring works</p>
          <ul className="text-xs text-white/40 space-y-1 leading-relaxed">
            <li>• Runs right after a post publishes to Instagram — same schedule, no extra setup</li>
            <li>• The card image(s) are encoded into a vertical 1080×1920 MP4 with #Shorts</li>
            <li>• Carousels become multi-slide Shorts; single posts become one clip</li>
            <li>• A failed YouTube upload never blocks the Instagram post</li>
          </ul>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} label="Save YouTube Settings" />
      </div>
    </div>
  );
}

function WebhookTab() {
  const [loading,     setLoading]     = useState(true);
  const [data,        setData]        = useState<DebugData | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [expanded,    setExpanded]    = useState<number | null>(null);

  const loadDebug = useCallback(() => {
    setLoading(true);
    fetch("/api/webhook/debug")
      .then((r) => r.json())
      .then((d) => { if (d.success) setData(d.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadDebug(); }, [loadDebug]);

  const handleAutoSubscribe = async () => {
    setSubscribing(true);
    const tid = toast.loading("Subscribing webhook fields via Meta API...");
    try {
      const res    = await fetch("/api/webhook/setup", { method: "POST" });
      const result = await res.json();
      if (result.success) {
        toast.success("Fields subscribed! ✅ Refreshing status...", { id: tid });
        loadDebug();
      } else {
        toast.error(result.error ?? "Subscription failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSubscribing(false);
    }
  };

  if (loading) return <SkeletonBlock rows={6} />;
  if (!data)   return <p className="text-sm text-white/40">Failed to load webhook status.</p>;

  const { summary, subscriptions, recentActivity, fixSteps, webhookUrl, appSecret, verifyToken, ngrokStatus } = data;
  const allFieldsOk = subscriptions.comments && subscriptions.messages && subscriptions.mentions;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Webhook Status</h3>
          <p className="text-xs text-white/35 mt-1 leading-relaxed">
            Real-time diagnostic  -  checks if Meta can deliver comment &amp; DM events to your server.
          </p>
        </div>
        <motion.button
          whileHover={{ rotate: 180 }} transition={{ duration: 0.35 }}
          onClick={loadDebug}
          className="p-2 text-white/25 hover:text-white/60 transition-colors rounded-lg border border-white/[0.06] hover:border-white/[0.15]"
        >
          <RefreshCw size={14} />
        </motion.button>
      </div>

      {/* Overall status banner */}
      <div className={cn(
        "rounded-xl p-4 border flex items-start gap-3",
        summary.webhookWorking
          ? "bg-emerald-500/5 border-emerald-500/20"
          : summary.issueCount === 0
          ? "bg-blue-500/5 border-blue-500/20"
          : "bg-red-500/5 border-red-500/20"
      )}>
        <div className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-base",
          summary.webhookWorking ? "bg-emerald-500/15" : summary.issueCount === 0 ? "bg-blue-500/15" : "bg-red-500/15"
        )}>
          {summary.webhookWorking ? "✅" : summary.issueCount === 0 ? "⚠️" : "❌"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{summary.overallStatus}</p>
          <p className="text-[11px] text-white/35 mt-0.5 font-mono break-all">{webhookUrl}</p>
        </div>
      </div>

      {/* Webhook URL row */}
      <div className="rounded-xl p-4 border bg-blue-500/10 border-blue-500/20">
        <div className="flex items-center gap-2 mb-2">
          <Globe size={13} className="text-blue-400" />
          <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider">Webhook URL</p>
          <span className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-full border bg-blue-500/10 border-blue-500/20 text-blue-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full inline-block bg-blue-400" />
            Railway · Live
          </span>
        </div>
        <p className="text-[11px] font-mono text-white/70 break-all">{webhookUrl ?? "Not set"}</p>
        <p className="text-[11px] text-white/40 mt-1.5">Deployed on Railway — no tunnel required</p>
      </div>

      {/* Issues list */}
      {summary.issues.length > 0 && (
        <div className="rounded-xl border border-orange-500/20 p-4 space-y-2" style={{ background: "rgba(249,115,22,0.04)" }}>
          <p className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider mb-3">
            Issues Found ({summary.issueCount})
          </p>
          {summary.issues.map((issue, i) => (
            <p key={i} className="text-xs text-white/60 leading-relaxed">{issue}</p>
          ))}
        </div>
      )}

      {/* Field subscriptions */}
      <div>
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Webhook Field Subscriptions</p>
        <div className="grid grid-cols-3 gap-3">
          {([
            { label: "Comments", active: subscriptions.comments, icon: "🗨️" },
            { label: "Messages", active: subscriptions.messages, icon: "💬" },
            { label: "Mentions", active: subscriptions.mentions, icon: "📣" },
          ] as const).map((f) => (
            <div
              key={f.label}
              className={cn(
                "rounded-xl p-3 border text-center",
                f.active ? "bg-emerald-500/5 border-emerald-500/20" : "bg-white/[0.02] border-white/[0.06]"
              )}
            >
              <p className="text-lg mb-1">{f.icon}</p>
              <p className="text-xs font-semibold text-white/70">{f.label}</p>
              <p className={cn("text-[10px] mt-0.5 font-medium", f.active ? "text-emerald-400" : "text-red-400/70")}>
                {f.active ? "✅ Subscribed" : "❌ Not subscribed"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <div className={cn(
        "rounded-xl p-4 border",
        recentActivity.total > 0 ? "bg-emerald-500/5 border-emerald-500/15" : "bg-white/[0.02] border-white/[0.06]"
      )}>
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">
          Recent Webhook Activity (last 1 h)
        </p>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{recentActivity.comments}</p>
            <p className="text-[10px] text-white/35 mt-0.5">Comments</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{recentActivity.dms}</p>
            <p className="text-[10px] text-white/35 mt-0.5">DMs</p>
          </div>
          <p className="text-xs text-white/50 leading-relaxed flex-1">{recentActivity.note}</p>
        </div>
      </div>

      {/* Env key status */}
      <div className="rounded-xl p-4 border border-white/[0.06]" style={{ background: "rgba(255,255,255,0.02)" }}>
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Key Environment Variables</p>
        <div className="space-y-2.5">
          {[
            {
              label: "App Secret",
              value: appSecret.maskedValue,
              ok:    appSecret.set,
              hint:  appSecret.hmacWorks === true ? "HMAC ok" : typeof appSecret.hmacWorks === "string" ? appSecret.hmacWorks : "Not tested",
            },
            {
              label: "Verify Token",
              value: verifyToken.effectiveValue,
              ok:    verifyToken.set,
              hint:  verifyToken.set ? "Using .env" : "Using default fallback",
            },
          ].map((e) => (
            <div key={e.label} className="flex items-center gap-3">
              <span className={cn("w-2 h-2 rounded-full flex-shrink-0", e.ok ? "bg-emerald-400" : "bg-orange-400")} />
              <span className="text-xs text-white/45 w-28 flex-shrink-0">{e.label}</span>
              <span className="text-xs font-mono text-white/70 flex-1 truncate">{e.value}</span>
              <span className="text-[10px] text-white/30 flex-shrink-0">{e.hint}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Setup checklist */}
      <div>
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider mb-3">Setup Checklist</p>
        <div className="space-y-2">
          {fixSteps.map((step) => (
            <div key={step.step}>
              <button
                onClick={() => setExpanded(expanded === step.step ? null : step.step)}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                  step.done
                    ? "bg-emerald-500/5 border-emerald-500/15"
                    : "bg-white/[0.02] border-white/[0.06] hover:border-white/[0.12]"
                )}
              >
                <span className={cn(
                  "w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold flex-shrink-0",
                  step.done ? "bg-emerald-500/20 text-emerald-400" : "bg-white/10 text-white/40"
                )}>
                  {step.done ? "✓" : step.step}
                </span>
                <span className={cn("text-xs font-semibold flex-1", step.done ? "text-emerald-400/80" : "text-white/70")}>
                  {step.title}
                </span>
                {!step.done && (
                  expanded === step.step
                    ? <ChevronUp   size={12} className="text-white/30 flex-shrink-0" />
                    : <ChevronDown size={12} className="text-white/30 flex-shrink-0" />
                )}
              </button>
              <AnimatePresence>
                {expanded === step.step && !step.done && (
                  <motion.div
                    key="inst"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mx-3 overflow-hidden"
                  >
                    <div
                      className="px-4 py-3 rounded-b-xl text-[11px] text-white/50 leading-relaxed whitespace-pre-wrap border border-t-0 border-white/[0.06]"
                      style={{ background: "rgba(255,255,255,0.02)" }}
                    >
                      {step.instruction}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* Auto-subscribe CTA */}
      <div className="pt-2 border-t border-white/[0.05] flex items-center gap-4 flex-wrap">
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
          onClick={handleAutoSubscribe}
          disabled={subscribing || allFieldsOk}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #ef4444, #ec4899)" }}
        >
          {subscribing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
          {subscribing ? "Subscribing..." : allFieldsOk ? "All Fields Active ✅" : "Auto-Subscribe Fields"}
        </motion.button>
        <p className="text-[11px] text-white/30 leading-relaxed flex-1 min-w-0">
          {allFieldsOk
            ? "comments, messages & mentions are all subscribed via Meta API."
            : "One click to subscribe comments, messages & mentions via Graph API. Requires a valid Instagram access token."}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BRAND TAB  (white-label identity, persona, colours, topics, hashtag seeds)
// ─────────────────────────────────────────────────────────────────────────────

/** Build the account-scoped brand URL. "all"/empty → omit query (→ primary). */
function brandUrl(brandId: string): string {
  return brandId && brandId !== ALL_BRANDS
    ? `/api/settings/brand?brand=${encodeURIComponent(brandId)}`
    : "/api/settings/brand";
}

/** Chip editor: add via Enter or button, remove via ×. */
function ChipEditor({
  label, items, onChange, placeholder, accent = "red",
}: {
  label: string; items: string[]; onChange: (next: string[]) => void;
  placeholder?: string; accent?: "red" | "fuchsia";
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || items.includes(v)) { setDraft(""); return; }
    onChange([...items, v]);
    setDraft("");
  };
  const focusColor = accent === "fuchsia" ? "rgba(192,38,211,0.5)" : "rgba(239,68,68,0.5)";
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-2 uppercase tracking-wider">
        {label} ({items.length})
      </label>
      <div className="flex flex-wrap gap-2 mb-3">
        {items.map((t) => (
          <span
            key={t}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-white/10 text-white/70"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            {t}
            <button
              onClick={() => onChange(items.filter((x) => x !== t))}
              className="text-white/30 hover:text-red-400 transition-colors ml-0.5"
            >
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder={placeholder}
          className="flex-1 px-4 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          onFocus={(e) => { e.target.style.borderColor = focusColor; }}
          onBlur={(e)  => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; }}
        />
        <motion.button
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
          onClick={add}
          className="px-4 py-2.5 rounded-xl text-sm font-medium text-white border border-white/[0.12] hover:border-red-500/40 hover:text-red-300 transition-all flex items-center gap-1.5"
        >
          <Plus size={13} /> Add
        </motion.button>
      </div>
    </div>
  );
}

/** color swatch + hex text input pair. */
function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
  return (
    <div>
      <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-lg cursor-pointer bg-transparent border border-white/10 flex-shrink-0"
          style={{ colorScheme: "dark" }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/25 outline-none font-mono"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
        />
      </div>
    </div>
  );
}

interface BrandState {
  appName: string;
  tagline: string;
  niche: string;
  purpose: string;
  audience: string;
  language: string;
  defaultTone: string;
  persona: { handle: string; displayName: string; role: string; voice: string };
  dmAutoReply: string;
  commentCtaLine: string;
  colors: { bg: string; bg2: string; accent: string; accent2: string; accent3: string };
  lockCardTheme: boolean;
  youtube: { handle: string; channelName: string };
  topics: string[];
  hashtagSeeds: string[];
}

const EMPTY_BRAND: BrandState = {
  appName: "", tagline: "", niche: "", purpose: "", audience: "", language: "",
  defaultTone: "",
  persona: { handle: "", displayName: "", role: "", voice: "" },
  dmAutoReply: "", commentCtaLine: "",
  colors: { bg: "#0b0b12", bg2: "#111118", accent: "#ef4444", accent2: "#ec4899", accent3: "#8b5cf6" },
  lockCardTheme: false,
  youtube: { handle: "", channelName: "" },
  topics: [], hashtagSeeds: [],
};

function BrandTab() {
  const { brandId } = useSelectedBrand();
  const { reload } = useBrandContext();
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [b,       setB]       = useState<BrandState>(EMPTY_BRAND);

  useEffect(() => {
    setLoading(true);
    fetch(brandUrl(brandId))
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          const x = d.data;
          setB({
            appName:     x.appName     ?? "",
            tagline:     x.tagline     ?? "",
            niche:       x.niche       ?? "",
            purpose:     x.purpose     ?? "",
            audience:    x.audience    ?? "",
            language:    x.language    ?? "",
            defaultTone: x.defaultTone ?? "",
            persona: {
              handle:      x.persona?.handle      ?? "",
              displayName: x.persona?.displayName ?? "",
              role:        x.persona?.role        ?? "",
              voice:       x.persona?.voice       ?? "",
            },
            dmAutoReply:    x.dmAutoReply    ?? "",
            commentCtaLine: x.commentCtaLine ?? "",
            colors: {
              bg:      x.colors?.bg      ?? EMPTY_BRAND.colors.bg,
              bg2:     x.colors?.bg2     ?? EMPTY_BRAND.colors.bg2,
              accent:  x.colors?.accent  ?? EMPTY_BRAND.colors.accent,
              accent2: x.colors?.accent2 ?? EMPTY_BRAND.colors.accent2,
              accent3: x.colors?.accent3 ?? EMPTY_BRAND.colors.accent3,
            },
            lockCardTheme: Boolean(x.lockCardTheme),
            youtube: {
              handle:      x.youtube?.handle      ?? "",
              channelName: x.youtube?.channelName ?? "",
            },
            topics:       Array.isArray(x.topics)       ? x.topics       : [],
            hashtagSeeds: Array.isArray(x.hashtagSeeds) ? x.hashtagSeeds : [],
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const setField = <K extends keyof BrandState>(k: K, v: BrandState[K]) =>
    setB((prev) => ({ ...prev, [k]: v }));
  const setPersona = (k: keyof BrandState["persona"], v: string) =>
    setB((prev) => ({ ...prev, persona: { ...prev.persona, [k]: v } }));
  const setColor = (k: keyof BrandState["colors"], v: string) =>
    setB((prev) => ({ ...prev, colors: { ...prev.colors, [k]: v } }));
  const setYoutube = (k: keyof BrandState["youtube"], v: string) =>
    setB((prev) => ({ ...prev, youtube: { ...prev.youtube, [k]: v } }));

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving brand settings...");
    try {
      const res = await fetch(brandUrl(brandId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Brand settings saved ✅", { id: tid });
        reload();
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={6} />;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Brand</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          White-label the entire app — name, voice, persona, colours and content topics. These settings re-skin the dashboard and steer how the AI writes for this account.
        </p>
      </div>

      {/* Identity */}
      <div className="space-y-4">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Identity</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="App Name" value={b.appName} onChange={(v) => setField("appName", v)} placeholder="e.g. InstaPilot AI" />
          <GlassInput label="Niche"    value={b.niche}   onChange={(v) => setField("niche", v)}   placeholder="e.g. fitness coaching" />
        </div>
        <GlassInput label="Tagline" value={b.tagline} onChange={(v) => setField("tagline", v)} placeholder="e.g. AI-powered content on autopilot" />
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">Purpose</label>
          <textarea
            value={b.purpose}
            onChange={(e) => setField("purpose", e.target.value)}
            rows={3}
            placeholder="What is this account about and what should every post try to achieve?"
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="Audience"     value={b.audience}    onChange={(v) => setField("audience", v)}    placeholder="e.g. busy professionals 25-45" />
          <GlassInput label="Language"     value={b.language}    onChange={(v) => setField("language", v)}    placeholder="e.g. English" />
        </div>
        <GlassInput label="Default Tone" value={b.defaultTone} onChange={(v) => setField("defaultTone", v)} placeholder="e.g. Professional, Engaging" />
      </div>

      {/* Persona */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Persona</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="Handle"       value={b.persona.handle}      onChange={(v) => setPersona("handle", v)}      placeholder="@yourhandle" />
          <GlassInput label="Display Name" value={b.persona.displayName} onChange={(v) => setPersona("displayName", v)} placeholder="Your Brand" />
        </div>
        <GlassInput label="Role" value={b.persona.role} onChange={(v) => setPersona("role", v)} placeholder="e.g. Certified fitness coach" />
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">Voice</label>
          <textarea
            value={b.persona.voice}
            onChange={(e) => setPersona("voice", e.target.value)}
            rows={2}
            placeholder="How should the brand sound? e.g. warm, authoritative, no jargon"
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
      </div>

      {/* Engagement copy */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Engagement</p>
        <div>
          <label className="text-xs font-medium text-white/40 block mb-1.5 uppercase tracking-wider">DM Auto-Reply</label>
          <textarea
            value={b.dmAutoReply}
            onChange={(e) => setField("dmAutoReply", e.target.value)}
            rows={3}
            placeholder="Default reply sent to new direct messages."
            className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-white/25 outline-none resize-y"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
        <GlassInput label="Comment CTA Line" value={b.commentCtaLine} onChange={(v) => setField("commentCtaLine", v)} placeholder="e.g. Follow for daily tips!" />
      </div>

      {/* YouTube */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider flex items-center gap-1.5">
          <Youtube size={12} /> YouTube
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <GlassInput label="YouTube Handle"  value={b.youtube.handle}      onChange={(v) => setYoutube("handle", v)}      placeholder="@yourchannel" />
          <GlassInput label="Channel Name"    value={b.youtube.channelName} onChange={(v) => setYoutube("channelName", v)} placeholder="Your Channel" />
        </div>
      </div>

      {/* Colours */}
      <div className="space-y-4 pt-2 border-t border-white/[0.06]">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Colours</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ColorField label="Background"  value={b.colors.bg}      onChange={(v) => setColor("bg", v)} />
          <ColorField label="Background 2" value={b.colors.bg2}     onChange={(v) => setColor("bg2", v)} />
          <ColorField label="Accent"      value={b.colors.accent}  onChange={(v) => setColor("accent", v)} />
          <ColorField label="Accent 2"    value={b.colors.accent2} onChange={(v) => setColor("accent2", v)} />
          <ColorField label="Accent 3"    value={b.colors.accent3} onChange={(v) => setColor("accent3", v)} />
        </div>
        <div className="rounded-xl px-4 border border-white/[0.07] bg-white/[0.01]">
          <Toggle
            label="Lock card theme"
            description="Keep card backgrounds fixed to the brand colours instead of varying per post."
            value={b.lockCardTheme}
            onChange={(v) => setField("lockCardTheme", v)}
          />
        </div>
      </div>

      {/* Topics + hashtag seeds */}
      <div className="space-y-5 pt-2 border-t border-white/[0.06]">
        <ChipEditor
          label="Topics"
          items={b.topics}
          onChange={(next) => setField("topics", next)}
          placeholder="Add a topic and press Enter…"
        />
        <ChipEditor
          label="Hashtag Seeds"
          items={b.hashtagSeeds}
          onChange={(next) => setField("hashtagSeeds", next)}
          placeholder="e.g. fitness, wellness (press Enter)…"
        />
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} label="Save Brand" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT TYPES TAB  (12 slots: label / description / enabled / custom prompt)
// ─────────────────────────────────────────────────────────────────────────────
const CONTENT_TYPE_SLOTS: { id: string; defaultLabel: string }[] = [
  { id: "EDUCATIONAL",      defaultLabel: "Educational" },
  { id: "QUIZ",             defaultLabel: "Quiz" },
  { id: "CAROUSEL",         defaultLabel: "Carousel" },
  { id: "MYTH_FACT",        defaultLabel: "Myth vs Fact" },
  { id: "CLINICAL_PEARL",   defaultLabel: "Pro Tip" },
  { id: "CASE_STUDY",       defaultLabel: "Story / Example" },
  { id: "ANGIOGRAPHY_QUIZ", defaultLabel: "Image Quiz" },
  { id: "ECG_QUIZ",         defaultLabel: "Knowledge Quiz" },
  { id: "PREVENTIVE",       defaultLabel: "How-To / Tips" },
  { id: "CTA",              defaultLabel: "Call to Action" },
  { id: "REEL",             defaultLabel: "Reel" },
  { id: "STORY",            defaultLabel: "Story" },
];

interface ContentTypeState {
  label: string; description: string; prompt: string; enabled: boolean;
}

function ContentTypesTab() {
  const { brandId } = useSelectedBrand();
  const { reload } = useBrandContext();
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [types,   setTypes]   = useState<Record<string, ContentTypeState>>({});
  const [open,    setOpen]    = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(brandUrl(brandId))
      .then((r) => r.json())
      .then((d) => {
        const saved: Record<string, any> = (d.success && d.data?.contentTypes) || {};
        const next: Record<string, ContentTypeState> = {};
        for (const slot of CONTENT_TYPE_SLOTS) {
          const c = saved[slot.id] ?? {};
          next[slot.id] = {
            label:       typeof c.label === "string" && c.label ? c.label : slot.defaultLabel,
            description: typeof c.description === "string" ? c.description : "",
            prompt:      typeof c.prompt === "string" ? c.prompt : "",
            enabled:     typeof c.enabled === "boolean" ? c.enabled : true,
          };
        }
        setTypes(next);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [brandId]);

  const patch = (id: string, p: Partial<ContentTypeState>) =>
    setTypes((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const handleSave = async () => {
    setSaving(true);
    const tid = toast.loading("Saving content types...");
    try {
      const res = await fetch(brandUrl(brandId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentTypes: types }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Content types saved ✅", { id: tid });
        reload();
      } else {
        toast.error(data.error ?? "Save failed", { id: tid });
      }
    } catch {
      toast.error("Network error", { id: tid });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SkeletonBlock rows={6} />;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-white" style={{ fontFamily: "Sora, sans-serif" }}>Content Types</h3>
        <p className="text-xs text-white/35 mt-1 leading-relaxed">
          Rename, describe, enable/disable, and give a custom AI prompt to each content slot. These labels appear throughout the app and steer generation for this account.
        </p>
      </div>

      <div className="space-y-3">
        {CONTENT_TYPE_SLOTS.map((slot) => {
          const t = types[slot.id];
          if (!t) return null;
          const isOpen = open === slot.id;
          return (
            <div
              key={slot.id}
              className={cn(
                "rounded-2xl border p-4 transition-all",
                t.enabled ? "border-white/[0.08]" : "border-white/[0.05] opacity-70",
              )}
              style={{ background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <input
                    value={t.label}
                    onChange={(e) => patch(slot.id, { label: e.target.value })}
                    placeholder={slot.defaultLabel}
                    className="w-full px-3 py-2 rounded-lg text-sm font-semibold text-white placeholder-white/25 outline-none"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  />
                  <p className="text-[10px] text-white/25 mt-1 font-mono uppercase tracking-wider">{slot.id}</p>
                </div>
                <button
                  onClick={() => setOpen(isOpen ? null : slot.id)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 border border-white/[0.08] hover:text-white hover:border-white/20 transition-all flex-shrink-0"
                  title="Edit details"
                >
                  {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                <motion.button
                  onClick={() => patch(slot.id, { enabled: !t.enabled })}
                  className={cn(
                    "relative w-11 h-6 rounded-full transition-all flex-shrink-0",
                    t.enabled ? "bg-gradient-to-r from-red-500 to-pink-500" : "bg-white/10",
                  )}
                  style={t.enabled ? { boxShadow: "0 0 12px rgba(239,68,68,0.4)" } : {}}
                  title={t.enabled ? "Enabled" : "Disabled"}
                >
                  <motion.div
                    animate={{ x: t.enabled ? 20 : 2 }}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
                    className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-sm"
                  />
                </motion.button>
              </div>

              {isOpen && (
                <div className="mt-4 space-y-3 pt-3 border-t border-white/[0.06]">
                  <div>
                    <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">Description</label>
                    <input
                      value={t.description}
                      onChange={(e) => patch(slot.id, { description: e.target.value })}
                      placeholder="Short description of this content type"
                      className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-white/25 outline-none"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-white/35 block mb-1.5 uppercase tracking-wider">Custom AI prompt (optional)</label>
                    <textarea
                      value={t.prompt}
                      onChange={(e) => patch(slot.id, { prompt: e.target.value })}
                      rows={4}
                      placeholder="Override the AI instructions for this content type. Leave blank to use the built-in default."
                      className="w-full px-3 py-2.5 rounded-lg text-sm text-white/80 placeholder-white/20 outline-none resize-y"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "monospace" }}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <SaveButton onClick={handleSave} loading={saving} label="Save Content Types" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
// Tabs whose data is scoped to the currently-selected account (brand).
const BRAND_SCOPED_TABS = new Set([
  "brand", "content-types", "instagram", "prompts", "auto-post", "stories", "youtube",
]);

export default function SettingsPage() {
  const { isAll, selected: selectedBrand, brands } = useSelectedBrand();
  const [activeTab, setActiveTab] = useState("brand");
  const [signingOut, setSigningOut] = useState(false);

  // Deep-link: read ?tab= from the URL on mount and select it if valid.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param && tabs.some((t) => t.id === param)) setActiveTab(param);
  }, []);

  // Reflect the active tab in the URL so it's linkable / back-button friendly.
  const selectTab = useCallback((id: string) => {
    setActiveTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url.toString());
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } finally {
      window.location.replace("/login");
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <div className="rounded-2xl p-3 h-fit" style={panelStyle}>
          {tabs.map((tab) => (
            <motion.button
              key={tab.id}
              whileHover={{ x: 2 }}
              onClick={() => selectTab(tab.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all mb-1 last:mb-0",
                activeTab === tab.id
                  ? tab.id === "danger"
                    ? "bg-red-500/20 text-red-300 border border-red-500/20"
                    : "bg-gradient-to-r from-red-500/20 to-pink-500/10 text-white border border-red-500/20"
                  : tab.id === "danger"
                  ? "text-red-400/60 hover:text-red-400 hover:bg-red-500/5"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.04]"
              )}
            >
              <tab.icon size={15} />
              {tab.label}
              {tab.id === "prompts" && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">NEW</span>
              )}
              {tab.id === "auto-post" && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">NEW</span>
              )}
              {tab.id === "stories" && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "rgba(192,38,211,0.2)", color: "#e879f9" }}>NEW</span>
              )}
              {tab.id === "webhook" && (
                <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-bold">FIX</span>
              )}
            </motion.button>
          ))}

          {/* Sign Out */}
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <motion.button
              whileHover={{ x: 2 }}
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-red-400/60 hover:text-red-400 hover:bg-red-500/5 disabled:opacity-40"
            >
              {signingOut ? <Loader2 size={15} className="animate-spin" /> : <LogOut size={15} />}
              {signingOut ? "Signing out…" : "Sign Out"}
            </motion.button>
          </div>
        </div>

        {/* Content panel */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl p-6 space-y-5"
            style={panelStyle}
          >
            {/* Brand-scope banner — shows which account these settings apply to */}
            {brands.length > 1 && BRAND_SCOPED_TABS.has(activeTab) && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02] text-xs text-white/50">
                <Layers size={13} className="text-red-400" />
                These settings apply to:{" "}
                <span className="text-white/80 font-medium">
                  {isAll ? "Primary (switch off ‘All accounts’ to edit a specific one)" : selectedBrand?.label ?? "Primary"}
                </span>
              </div>
            )}

            {activeTab === "brand"         && <BrandTab />}
            {activeTab === "content-types" && <ContentTypesTab />}
            {activeTab === "account"       && <AccountTab />}
            {activeTab === "accounts"      && <AccountsTab />}
            {activeTab === "instagram"     && <InstagramTab />}
            {activeTab === "ai"            && <AiTab />}
            {activeTab === "prompts"       && <PromptsTab />}
            {activeTab === "auto-post"     && <AutoPostTab />}
            {activeTab === "stories"       && <StoriesTab />}
            {activeTab === "youtube"       && <YouTubeTab />}
            {activeTab === "webhook"       && <WebhookTab />}
            {activeTab === "notifications" && <NotificationsTab />}
            {activeTab === "danger"        && <DangerTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

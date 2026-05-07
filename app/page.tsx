"use client";
import { useState, useEffect } from "react";

type User = { id: string; name: string; email: string };
type SmtpAccount = { id: string; label: string; username: string; host: string; port: number; dailyLimit: number; throttleSeconds: number; sentToday: number; isActive: boolean; lastTestOk: boolean | null; lastError: string | null };
type Campaign = { id: string; name: string; status: string; totalRecipients: number; totalSent: number; totalOpened: number; totalClicked: number; subject: string; createdAt: string };
type ContactRow = { email: string; status: string; reason?: string; warning?: string | null };
type PoolStats = { active: number; totalCapacity: number; totalSentToday: number; remaining: number };

type Page = "dashboard" | "contacts" | "campaign" | "smtp" | "history";
type Step = "paste" | "validate" | "compose" | "sending" | "done";

const D = {
  bg: "#0d1117",
  sidebar: "#161b22",
  card: "#1c2128",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  accent: "#1f6feb",
  accentHover: "#388bfd",
  success: "#3fb950",
  danger: "#f85149",
  warning: "#d29922",
  gold: "#d4a017",
};

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("dashboard");


  // Auth
  const [email, setEmail] = useState(""); const [pass, setPass] = useState("");
  const [authErr, setAuthErr] = useState(""); const [authLoading, setAuthLoading] = useState(false);

  // Dashboard
  const [pool, setPool] = useState<PoolStats | null>(null);
  const [dashCampaigns, setDashCampaigns] = useState<Campaign[]>([]);

  // SMTP
  const [smtpAccounts, setSmtpAccounts] = useState<SmtpAccount[]>([]);
  const [smtpForm, setSmtpForm] = useState({ username: "", password: "", host: "smtp.gmail.com", port: 465, dailyLimit: 500, throttleSeconds: 5, replyTo: "" });
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpMsg, setSmtpMsg] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);

  // Contacts / Send flow
  const [step, setStep] = useState<Step>("paste");
  const [rawEmails, setRawEmails] = useState("");
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [fromName, setFromName] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [campName, setCampName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    const t = localStorage.getItem("iwg_token");
    const u = localStorage.getItem("iwg_user");
    if (t && u) { setToken(t); setUser(JSON.parse(u)); fetchDashboard(t); }
  }, []);

  const H = (t: string) => ({ Authorization: `Bearer ${t}` });

  async function fetchDashboard(t: string) {
    const r = await fetch("/api/dashboard", { headers: H(t) });
    if (r.ok) { const d = await r.json(); setPool(d.pool); setDashCampaigns(d.campaigns ?? []); }
  }
  async function fetchSmtp(t: string) {
    const r = await fetch("/api/smtp", { headers: H(t) });
    if (r.ok) { const d = await r.json(); setSmtpAccounts(d.accounts ?? []); }
  }
  async function fetchCampaigns(t: string) {
    const r = await fetch("/api/campaigns", { headers: H(t) });
    if (r.ok) { const d = await r.json(); setCampaigns(d.campaigns ?? []); }
  }

  async function login() {
    setAuthLoading(true); setAuthErr("");
    const r = await fetch("/api/auth?action=login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pass }) });
    const d = await r.json(); setAuthLoading(false);
    if (!r.ok) { setAuthErr(d.error); return; }
    saveAuth(d);
  }

  function saveAuth(d: any) {
    localStorage.setItem("iwg_token", d.token); localStorage.setItem("iwg_user", JSON.stringify(d.user));
    setToken(d.token); setUser(d.user); fetchDashboard(d.token);
  }
  function logout() { localStorage.removeItem('iwg_token'); localStorage.removeItem('iwg_user'); setToken(null); setUser(null); }

  async function addSmtp() {
    setSmtpLoading(true); setSmtpMsg("");
    try {
      const r = await fetch("/api/smtp", { method: "POST", headers: { "Content-Type": "application/json", ...H(token!) }, body: JSON.stringify(smtpForm) });
      const d = await r.json();
      if (!r.ok) { setSmtpMsg("Error: " + (d.error ?? "Failed to add account")); return; }
      setSmtpMsg("Account added successfully!");
      setSmtpForm({ username: "", password: "", host: "smtp.gmail.com", port: 465, dailyLimit: 500, throttleSeconds: 5, replyTo: "" });
      fetchSmtp(token!);
      setTimeout(() => setSmtpMsg(""), 3000);
    } catch {
      setSmtpMsg("Error: Connection failed — please try again");
    } finally {
      setSmtpLoading(false);
    }
  }
  async function deleteSmtp(id: string) {
    if (!confirm("Remove this SMTP account?")) return;
    await fetch(`/api/smtp/${id}`, { method: "DELETE", headers: H(token!) });
    fetchSmtp(token!);
  }
  async function testSmtp(id: string) {
    setTestingId(id);
    try {
      const r = await fetch(`/api/smtp/${id}/test`, { method: "POST", headers: H(token!) });
      const d = await r.json();
      alert(d.ok ? "✓ Connection successful!" : "✗ Failed: " + (d.error ?? "Unknown error"));
      fetchSmtp(token!);
    } catch {
      alert("✗ Connection error — please try again");
    } finally {
      setTestingId(null);
    }
  }
  async function toggleSmtp(id: string, isActive: boolean) {
    await fetch(`/api/smtp/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...H(token!) }, body: JSON.stringify({ isActive }) });
    fetchSmtp(token!);
  }

  async function validateEmails() {
    setValidating(true); setSendErr("");
    try {
      const r = await fetch("/api/contacts/validate", { method: "POST", headers: { "Content-Type": "application/json", ...H(token!) }, body: JSON.stringify({ rawEmails }) });
      const d = await r.json();
      if (!r.ok) { setSendErr(d.error ?? "Validation failed"); return; }
      setContacts(d.results ?? []);
      setBreakdown(d.breakdown ?? null);
      setStep("validate");
    } catch (err) {
      setSendErr("Connection error — the app may be waking up. Please try again in 30 seconds.");
    } finally {
      setValidating(false);
    }
  }
  async function sendCampaign() {
    setSending(true); setSendErr(""); setStep("sending");
    const validEmails = contacts.filter(c => c.status === "valid").map(c => c.email);
    try {
      const cr = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json", ...H(token!) }, body: JSON.stringify({ name: campName || `Campaign ${new Date().toLocaleDateString()}`, fromName, replyTo: replyTo || undefined, subject, htmlBody: buildHtml(message) }) });
      const cd = await cr.json();
      if (!cr.ok) throw new Error(cd.error);
      const sr = await fetch(`/api/campaigns/${cd.campaign.id}/send`, { method: "POST", headers: { "Content-Type": "application/json", ...H(token!) }, body: JSON.stringify({ emails: validEmails }) });
      const sd = await sr.json();
      if (!sr.ok) throw new Error(sd.error);
      setStep("done"); fetchDashboard(token!);
    } catch (err: any) { setSendErr(err.message); setStep("compose"); } finally { setSending(false); }
  }

  function buildHtml(txt: string) {
    return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">${txt.replace(/\n/g, "<br/>")}</body></html>`;
  }
  function resetSend() { setStep("paste"); setRawEmails(""); setContacts([]); setBreakdown(null); setFromName(""); setSubject(""); setMessage(""); setCampName(""); setSendErr(""); setReplyTo(""); }

  const validCount = contacts.filter(c => c.status === "valid").length;
  const invalidCount = contacts.filter(c => c.status !== "valid").length;
  const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n || 0);
  const pct = (a: number, b: number) => b > 0 ? ((a / b) * 100).toFixed(1) + "%" : "—";

  // ── AUTH ──────────────────────────────────────────────────────────────────
  if (!token) return (
    <div style={{ minHeight: "100vh", background: D.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,sans-serif" }}>
      <div style={{ width: 400, background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, padding: "40px 36px" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: D.gold, letterSpacing: "-0.5px" }}>IW-GOLD</div>
          <div style={{ fontSize: 12, color: D.muted, marginTop: 4 }}>Bulk Email Platform</div>
        </div>
        {authErr && (
          <div style={{ background: "#2d1515", border: `1px solid ${D.danger}`, color: D.danger, padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {authErr}
          </div>
        )}
        <label style={LS.lbl}>Email Address</label>
        <input style={LS.inp} type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
        <label style={LS.lbl}>Password</label>
        <input style={LS.inp} type="password" placeholder="••••••••" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} />
        <button style={{ ...LS.btn, background: D.accent, marginTop: 4 }} onClick={login} disabled={authLoading}>
          {authLoading ? "Signing in..." : "Sign In"}
        </button>
        <p style={{ textAlign: "center", fontSize: 11, color: D.muted, marginTop: 20 }}>
          Contact your administrator for access
        </p>
      </div>
    </div>
  );

  // ── MAIN LAYOUT ───────────────────────────────────────────────────────────
  const navItems: { id: Page; icon: string; label: string }[] = [
    { id: "dashboard", icon: "⊞", label: "Dashboard" },
    { id: "contacts", icon: "👤", label: "Contacts" },
    { id: "campaign", icon: "✉", label: "Campaign" },
    { id: "smtp", icon: "⚙", label: "SMTP Config" },
    { id: "history", icon: "🕐", label: "Campaign History" },
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: D.bg, fontFamily: "system-ui,sans-serif", fontSize: 13, color: D.text }}>
      {/* Sidebar */}
      <aside style={{ width: 220, background: D.sidebar, borderRight: `1px solid ${D.border}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${D.border}` }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: D.gold, letterSpacing: "-0.5px" }}>IW-GOLD</div>
          <div style={{ fontSize: 10, color: D.muted, marginTop: 2 }}>v1.0.0 PRO</div>
        </div>
        <nav style={{ padding: "12px 10px", flex: 1 }}>
          {navItems.map(n => (
            <div key={n.id} onClick={() => { setPage(n.id); if (n.id === "smtp") fetchSmtp(token!); if (n.id === "history") fetchCampaigns(token!); if (n.id === "dashboard") fetchDashboard(token!); if (n.id === "contacts") resetSend(); if (n.id === "dashboard") fetchDashboard(token!); }}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 8, marginBottom: 2, cursor: "pointer", background: page === n.id ? D.accent : "transparent", color: page === n.id ? "#fff" : D.muted, fontWeight: page === n.id ? 600 : 400, transition: "all 0.15s" }}>
              <span style={{ fontSize: 15 }}>{n.icon}</span>{n.label}
            </div>
          ))}
        </nav>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${D.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{user?.name}</div>
          <div style={{ fontSize: 11, color: D.muted, marginBottom: 8, wordBreak: "break-all" }}>{user?.email}</div>
          <button onClick={logout} style={{ fontSize: 11, color: D.muted, background: "none", border: "none", cursor: "pointer", padding: 0 }}>Sign out</button>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: 24, overflowY: "auto" }}>

        {/* ── DASHBOARD ── */}
        {page === "dashboard" && <>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>DASHBOARD</div>

          {/* Pool stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Active Accounts", value: pool?.active ?? 0, color: D.success },
              { label: "Daily Capacity", value: fmt(pool?.totalCapacity ?? 0), color: D.accent },
              { label: "Sent Today", value: fmt(pool?.totalSentToday ?? 0), color: D.gold },
              { label: "Remaining Today", value: fmt(pool?.remaining ?? 0), color: D.text },
            ].map((s, i) => (
              <div key={i} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: "16px 18px" }}>
                <div style={{ fontSize: 11, color: D.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Weekly chart */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: "18px 20px" }}>
              <div style={{ fontWeight: 600, marginBottom: 16 }}>Weekly Sending Volume</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 100 }}>
                {dashCampaigns.slice(0, 7).reverse().map((c, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
                    <div style={{ width: "100%", height: `${Math.max(10, (c.totalSent / Math.max(...dashCampaigns.map(x => x.totalSent), 1)) * 90)}%`, background: D.accent, borderRadius: "3px 3px 0 0", opacity: 0.8 }} />
                    <div style={{ fontSize: 9, color: D.muted, textAlign: "center" }}>{new Date(c.createdAt).toLocaleDateString("en", { weekday: "short" })}</div>
                  </div>
                ))}
                {dashCampaigns.length === 0 && <div style={{ color: D.muted, fontSize: 12, width: "100%", textAlign: "center" }}>No data yet</div>}
              </div>
            </div>
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: "18px 20px" }}>
              <div style={{ fontWeight: 600, marginBottom: 16 }}>Delivery Performance</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  { label: "Total Sent", value: fmt(dashCampaigns.reduce((a, c) => a + c.totalSent, 0)), color: D.accent },
                  { label: "Total Opened", value: fmt(dashCampaigns.reduce((a, c) => a + c.totalOpened, 0)), color: D.success },
                  { label: "Total Clicked", value: fmt(dashCampaigns.reduce((a, c) => a + c.totalClicked, 0)), color: D.gold },
                  { label: "Campaigns Run", value: dashCampaigns.length, color: D.text },
                ].map((s, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: D.muted, fontSize: 12 }}>{s.label}</span>
                    <span style={{ color: s.color, fontWeight: 600, fontSize: 14 }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>}

        {/* ── CONTACTS / SEND FLOW ── */}
        {page === "contacts" && <>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>CONTACTS</div>
          <div style={{ color: D.muted, fontSize: 13, marginBottom: 20 }}>Contact Management</div>

          {step === "paste" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 20 }}>
                <div style={{ display: "flex", gap: 0, marginBottom: 16, border: `1px solid ${D.border}`, borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ flex: 1, padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 600, color: D.muted, cursor: "pointer" }}>File Upload</div>
                  <div style={{ flex: 1, padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 600, background: D.accent, color: "#fff", cursor: "pointer" }}>Copy & Paste</div>
                </div>
                <textarea style={{ ...LS.inp, height: 160, fontFamily: "monospace", fontSize: 12 }}
                  placeholder="Paste emails here (one per line, or comma separated)..." value={rawEmails} onChange={e => setRawEmails(e.target.value)} />
                {sendErr && <div style={{ color: D.danger, fontSize: 12, marginBottom: 8 }}>{sendErr}</div>}
                <button style={{ ...LS.btn, background: D.accent, width: "100%" }} onClick={validateEmails} disabled={validating || !rawEmails.trim()}>
                  {validating ? "Validating..." : "+ Import Emails"}
                </button>
              </div>
              <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span>Total: 0</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: D.success, fontSize: 12 }}>● 0 Valid</span>
                    <span style={{ color: D.danger, fontSize: 12 }}>● 0 Invalid</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 140, color: D.muted }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
                  <div style={{ fontSize: 12 }}>No contacts uploaded yet</div>
                </div>
              </div>
            </div>
          )}

          {step === "validate" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 20 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <button style={{ ...LS.btn, background: "transparent", border: `1px solid ${D.border}`, color: D.muted, fontSize: 11 }} onClick={resetSend}>↻ Reset</button>
                  <button style={{ ...LS.btn, background: D.accent, fontSize: 11 }} onClick={() => setStep("compose")} disabled={validCount === 0}>
                    Next: Compose →
                  </button>
                </div>
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, background: "#0d2818", border: `1px solid #1a4731`, borderRadius: 8, padding: "12px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: D.success }}>{validCount}</div>
                    <div style={{ fontSize: 11, color: D.success }}>Valid</div>
                  </div>
                  <div style={{ flex: 1, background: "#2d1515", border: `1px solid #4a2020`, borderRadius: 8, padding: "12px 14px", textAlign: "center" }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: D.danger }}>{invalidCount}</div>
                    <div style={{ fontSize: 11, color: D.danger }}>Invalid</div>
                  </div>
                </div>
                {breakdown && (
                  <div style={{ background: "#111820", border: `1px solid ${D.border}`, borderRadius: 8, padding: "12px 14px", marginBottom: 12, fontSize: 11 }}>
                    <div style={{ fontWeight: 600, color: D.text, marginBottom: 8 }}>Validation Breakdown</div>
                    {breakdown.dnsVerified > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: D.muted }}>✓ Valid (format + domain verified)</span><span style={{ color: D.success }}>{breakdown.dnsVerified}</span></div>}
                    {breakdown.invalidFormat > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: D.muted }}>✗ Invalid format</span><span style={{ color: D.danger }}>{breakdown.invalidFormat}</span></div>}
                    {breakdown.invalidDomain > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: D.muted }}>✗ Domain has no mail server</span><span style={{ color: D.danger }}>{breakdown.invalidDomain}</span></div>}
                    {breakdown.disposable > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: D.muted }}>✗ Disposable email domains</span><span style={{ color: D.danger }}>{breakdown.disposable}</span></div>}
                    {breakdown.duplicates > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: D.muted }}>✗ Duplicates removed</span><span style={{ color: D.muted }}>{breakdown.duplicates}</span></div>}
                  </div>
                )}
                <textarea style={{ ...LS.inp, height: 120, fontFamily: "monospace", fontSize: 12 }} value={rawEmails} onChange={e => setRawEmails(e.target.value)} />
                <button style={{ ...LS.btn, background: D.accent, width: "100%", marginTop: 4 }} onClick={validateEmails} disabled={validating}>
                  {validating ? "Validating..." : "↻ Re-validate"}
                </button>
              </div>
              <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <span>Total: {contacts.length}</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span style={{ color: D.success, fontSize: 12 }}>● {validCount} Valid</span>
                    <span style={{ color: D.danger, fontSize: 12 }}>● {invalidCount} Invalid</span>
                  </div>
                </div>
                <div style={{ maxHeight: 300, overflowY: "auto" }}>
                  {contacts.map((c, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: `1px solid ${D.border}` }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: c.status === "valid" ? D.success : D.danger }}>●</span>
                        <span style={{ fontFamily: "monospace", fontSize: 12 }}>{c.email}</span>
                      </div>
                      <span style={{ fontSize: 11, color: c.status === "valid" ? (c.warning ? D.warning : D.muted) : D.danger }}>
                        {c.status === "valid" ? (c.warning ? "⚠ " + c.warning : "Valid") : c.reason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === "compose" && (
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 24, maxWidth: 680 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <button onClick={() => setStep("validate")} style={{ ...LS.btn, background: "transparent", border: `1px solid ${D.border}`, color: D.muted, fontSize: 11, width: "auto", padding: "6px 12px" }}>← Back</button>
                <div style={{ fontWeight: 700, fontSize: 16 }}>Compose Campaign</div>
                <span style={{ fontSize: 12, color: D.muted }}>({validCount} recipients)</span>
              </div>
              {sendErr && <div style={{ background: "#2d1515", border: `1px solid ${D.danger}`, color: D.danger, padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{sendErr}</div>}
              <label style={LS.lbl}>Campaign Name (optional)</label>
              <input style={LS.inp} placeholder="e.g. November Promo" value={campName} onChange={e => setCampName(e.target.value)} />
              <label style={LS.lbl}>From Name *</label>
              <input style={LS.inp} placeholder="James from Acme" value={fromName} onChange={e => setFromName(e.target.value)} />
              <label style={LS.lbl}>Reply-To Address (where replies go)</label>
            <input style={LS.inp} type="email" placeholder="replies@yourdomain.com (leave blank to use Gmail address)" value={replyTo} onChange={e => setReplyTo(e.target.value)} />
            <label style={LS.lbl}>Subject Line *</label>
              <input style={LS.inp} placeholder="Exciting news for you!" value={subject} onChange={e => setSubject(e.target.value)} />
              <label style={LS.lbl}>Message *</label>
              <div style={{ fontSize: 11, color: D.muted, marginBottom: 6 }}>Use {"{{unsubscribeUrl}}"} for unsubscribe link. Tracking pixel added automatically.</div>
              <textarea style={{ ...LS.inp, height: 200, resize: "vertical" }} placeholder={"Hello,\n\nYour message here...\n\nBest regards"} value={message} onChange={e => setMessage(e.target.value)} />
              <div style={{ background: "#0d2818", border: `1px solid #1a4731`, borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: D.muted }}>
                🚀 Ready to send to <strong style={{ color: D.success }}>{validCount} recipients</strong> via your Gmail pool · {smtpAccounts.filter(a => a.isActive).length} accounts × 500/day = {fmt(smtpAccounts.filter(a => a.isActive).reduce((s, a) => s + a.dailyLimit, 0))} total daily capacity
              </div>
              <button style={{ ...LS.btn, background: D.accent, width: "100%" }} onClick={sendCampaign} disabled={sending || !fromName || !subject || !message}>
                {sending ? "Launching..." : `🚀 Send to ${validCount} Recipients`}
              </button>
            </div>
          )}

          {step === "sending" && (
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📤</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Campaign Sending...</div>
              <div style={{ color: D.muted, fontSize: 14 }}>Sending to {validCount} recipients via Gmail pool. You can navigate away — sending continues in background.</div>
            </div>
          )}

          {step === "done" && (
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 48, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: D.success }}>Campaign Launched!</div>
              <div style={{ color: D.muted, fontSize: 14, marginBottom: 24 }}>Sending to {validCount} recipients. Track progress in Campaign History.</div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button style={{ ...LS.btn, background: D.accent, width: "auto", padding: "10px 24px" }} onClick={() => { setPage("history"); fetchCampaigns(token!); }}>View History</button>
                <button style={{ ...LS.btn, background: "transparent", border: `1px solid ${D.border}`, color: D.text, width: "auto", padding: "10px 24px" }} onClick={resetSend}>Send Another</button>
              </div>
            </div>
          )}
        </>}

        {/* ── SMTP CONFIG ── */}
        {page === "smtp" && <>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>SMTP</div>
          <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
            {/* Add form */}
            <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 16 }}>+ Add Server</div>
              {smtpMsg && <div style={{ background: smtpMsg.startsWith("Error") ? "#2d1515" : "#0d2818", border: `1px solid ${smtpMsg.startsWith("Error") ? D.danger : D.success}`, color: smtpMsg.startsWith("Error") ? D.danger : D.success, padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{smtpMsg}</div>}
              <label style={LS.lbl}>Gmail / Username</label>
              <input style={LS.inp} placeholder="user@gmail.com" value={smtpForm.username} onChange={e => setSmtpForm(p => ({ ...p, username: e.target.value }))} />
              <div style={{ fontSize: 11, color: D.muted, marginBottom: 8, marginTop: -8 }}>Auto-fills host for Gmail, Outlook, Yahoo</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label style={LS.lbl}>Host</label>
                  <input style={LS.inp} value={smtpForm.host} onChange={e => setSmtpForm(p => ({ ...p, host: e.target.value }))} />
                </div>
                <div>
                  <label style={LS.lbl}>Port</label>
                  <input style={LS.inp} type="number" value={smtpForm.port} onChange={e => setSmtpForm(p => ({ ...p, port: +e.target.value }))} />
                </div>
              </div>
              <label style={LS.lbl}>Password / App Key</label>
              <input style={LS.inp} type="password" placeholder="••••••••••••••••" value={smtpForm.password} onChange={e => setSmtpForm(p => ({ ...p, password: e.target.value }))} />
              <label style={LS.lbl}>Reply-To Address (optional — where replies go)</label>
              <input style={LS.inp} type="email" placeholder="replies@yourdomain.com" value={smtpForm.replyTo} onChange={e => setSmtpForm(p => ({ ...p, replyTo: e.target.value }))} />
              <div style={{ background: "#0d1a2e", border: `1px solid #1a3a5c`, borderRadius: 8, padding: "12px 14px", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: D.accent, marginBottom: 6 }}>ⓘ Gmail Setup Guide</div>
                <div style={{ fontSize: 11, color: D.muted, lineHeight: 1.6 }}>
                  1. Enable <strong style={{ color: D.text }}>2-Factor Authentication</strong> on your Google Account<br />
                  2. Go to myaccount.google.com/apppasswords<br />
                  3. Generate an App Password for "Mail"<br />
                  4. Use that <strong style={{ color: D.text }}>16-character password</strong> in the field above
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div>
                  <label style={LS.lbl}>Daily Sending Limit</label>
                  <input style={LS.inp} type="number" value={smtpForm.dailyLimit} onChange={e => setSmtpForm(p => ({ ...p, dailyLimit: +e.target.value }))} />
                <div style={{ fontSize: 10, color: D.muted, marginTop: -6, marginBottom: 8 }}>Per account. Gmail max is 500/day.</div>
                </div>
                <div>
                  <label style={LS.lbl}>Throttle (sec)</label>
                  <input style={LS.inp} type="number" value={smtpForm.throttleSeconds} onChange={e => setSmtpForm(p => ({ ...p, throttleSeconds: +e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button style={{ ...LS.btn, background: "transparent", border: `1px solid ${D.border}`, color: D.text }} onClick={() => smtpAccounts.length > 0 && testSmtp(smtpAccounts[smtpAccounts.length - 1].id)} disabled={smtpLoading}>✦ Test</button>
                <button style={{ ...LS.btn, background: D.accent }} onClick={addSmtp} disabled={smtpLoading || !smtpForm.username || !smtpForm.password}>{smtpLoading ? "Adding..." : "+ Add to Pool"}</button>
              </div>
            </div>

            {/* Account cards */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {smtpAccounts.length === 0 && (
                <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 32, textAlign: "center", color: D.muted }}>
                  No SMTP accounts yet. Add your first Gmail account to start sending.
                </div>
              )}
              {smtpAccounts.map(a => (
                <div key={a.id} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: "16px 18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, background: "#1c3d6e", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>✉</div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{a.username}</div>
                        <div style={{ fontSize: 11, color: D.muted }}>{a.host}:{a.port} · {a.secure ? "TLS" : "STARTTLS"}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button onClick={() => testSmtp(a.id)} disabled={testingId === a.id} style={{ ...LS.btn, background: "transparent", border: `1px solid ${D.border}`, color: D.muted, fontSize: 11, width: "auto", padding: "4px 10px" }}>{testingId === a.id ? "..." : "TEST"}</button>
                      <button onClick={() => toggleSmtp(a.id, !a.isActive)} style={{ ...LS.btn, background: "transparent", border: "none", color: D.muted, fontSize: 16, width: "auto", padding: "4px 6px" }}>{a.isActive ? "⏸" : "▶"}</button>
                      <button onClick={() => deleteSmtp(a.id)} style={{ ...LS.btn, background: "transparent", border: "none", color: D.danger, fontSize: 16, width: "auto", padding: "4px 6px" }}>🗑</button>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${D.border}` }}>
                    <div style={{ fontSize: 12, color: D.muted }}>Limit: {a.dailyLimit} | Throttle: {a.throttleSeconds}s</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {a.lastTestOk === true && <span style={{ fontSize: 11, color: D.success }}>● Verified</span>}
                      {a.lastTestOk === false && <span style={{ fontSize: 11, color: D.danger }}>● Failed</span>}
                      <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: a.isActive ? "#0d2818" : "#2d1515", color: a.isActive ? D.success : D.danger }}>
                        {a.isActive ? "Active" : "Paused"}
                      </span>
                    </div>
                  </div>
                  {/* Health bar */}
                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: D.muted, marginBottom: 4 }}>
                      <span>{a.sentToday} / {a.dailyLimit} sent today</span>
                      <span>{Math.round((a.sentToday / a.dailyLimit) * 100)}% used</span>
                    </div>
                    <div style={{ height: 4, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 2, width: `${Math.min(100, Math.round((a.sentToday / a.dailyLimit) * 100))}%`, background: a.sentToday / a.dailyLimit > 0.9 ? D.danger : a.sentToday / a.dailyLimit > 0.7 ? D.warning : D.success, transition: "width 0.5s" }} />
                    </div>
                  </div>
                  {a.lastError && (
                    <div style={{ background: "#2d1515", border: `1px solid #4a2020`, borderRadius: 6, padding: "8px 12px", marginTop: 8, fontSize: 11, color: D.danger }}>
                      ⚠ {a.lastError}
                    </div>
                  )}
                  {/* Spam check link */}
                  <div style={{ marginTop: 8, fontSize: 11, color: D.muted }}>
                    Check spam score: {" "}
                    <a href="https://mail-tester.com" target="_blank" rel="noopener noreferrer" style={{ color: D.accent }}>
                      mail-tester.com ↗
                    </a>
                    {" · "}
                    <a href={"https://mxtoolbox.com/blacklists.aspx"} target="_blank" rel="noopener noreferrer" style={{ color: D.accent }}>
                      blacklist check ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>}

        {/* ── CAMPAIGN HISTORY ── */}
        {(page === "history" || page === "campaign") && <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>CAMPAIGN HISTORY</div>
            <button style={{ ...LS.btn, background: D.accent, width: "auto", padding: "8px 18px" }} onClick={() => { setPage("contacts"); resetSend(); }}>+ New Campaign</button>
          </div>
          <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 90px 80px 70px 70px 70px 80px", padding: "10px 18px", borderBottom: `1px solid ${D.border}`, background: "#111820" }}>
              {["Campaign", "Status", "Recipients", "Sent", "Opens", "Clicks", "Date"].map(h => (
                <div key={h} style={{ fontSize: 10, fontWeight: 600, color: D.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
              ))}
            </div>
            {campaigns.length === 0 ? (
              <div style={{ padding: "48px 20px", textAlign: "center", color: D.muted }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>✉</div>
                <div>No campaigns yet</div>
              </div>
            ) : campaigns.map((c, i) => {
              const sc = { draft: { bg: "#1c2128", color: D.muted }, sending: { bg: "#0d1a2e", color: D.accent }, completed: { bg: "#0d2818", color: D.success }, paused: { bg: "#2d2200", color: D.warning } };
              const s = sc[c.status as keyof typeof sc] ?? sc.draft;
              return (
                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "2fr 90px 80px 70px 70px 70px 80px", padding: "13px 18px", borderBottom: i < campaigns.length - 1 ? `1px solid ${D.border}` : "none", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: D.muted, marginTop: 2 }}>{c.subject}</div>
                  </div>
                  <div><span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: s.bg, color: s.color }}>{c.status}</span></div>
                  <div>{fmt(c.totalRecipients)}</div>
                  <div>{fmt(c.totalSent)}</div>
                  <div>{pct(c.totalOpened, c.totalSent)}</div>
                  <div>{pct(c.totalClicked, c.totalSent)}</div>
                  <div style={{ fontSize: 11, color: D.muted }}>{new Date(c.createdAt).toLocaleDateString()}</div>
                </div>
              );
            })}
          </div>
        </>}

      </main>
    </div>
  );
}

const LS: Record<string, React.CSSProperties> = {
  lbl: { display: "block", fontSize: 11, fontWeight: 500, color: "#8b949e", marginBottom: 4 },
  inp: { display: "block", width: "100%", padding: "8px 12px", border: "1px solid #30363d", borderRadius: 6, fontSize: 13, marginBottom: 10, outline: "none", boxSizing: "border-box", color: "#e6edf3", background: "#0d1117", fontFamily: "inherit" },
  btn: { display: "block", width: "100%", padding: "9px 14px", background: "#1f6feb", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" },
};

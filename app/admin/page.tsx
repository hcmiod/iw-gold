"use client";
import { useState, useEffect } from "react";

type User = { id: string; name: string; email: string; createdAt: string };

const D = {
  bg: "#0d1117", card: "#1c2128", border: "#30363d",
  text: "#e6edf3", muted: "#8b949e", accent: "#1f6feb",
  success: "#3fb950", danger: "#f85149", warning: "#d29922",
  gold: "#d4a017", sidebar: "#161b22",
};

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgType, setMsgType] = useState<"success" | "error">("success");

  // New user form
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);

  // Reset password
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPass, setResetPass] = useState("");
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("zn26_admin_token");
    if (t) { setToken(t); fetchUsers(t); }
  }, []);

  const H = (t: string) => ({ Authorization: `Bearer ${t}` });

  function showMsg(text: string, type: "success" | "error" = "success") {
    setMsg(text); setMsgType(type);
    setTimeout(() => setMsg(""), 4000);
  }

  async function handleLogin() {
    setLoginLoading(true); setLoginErr("");
    try {
      const r = await fetch("/api/auth?action=admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPass }),
      });
      const d = await r.json();
      if (!r.ok) { setLoginErr(d.error ?? "Invalid credentials"); return; }
      localStorage.setItem("zn26_admin_token", d.token);
      setToken(d.token);
      fetchUsers(d.token);
    } catch {
      setLoginErr("Connection error — please try again");
    } finally {
      setLoginLoading(false);
    }
  }

  async function fetchUsers(t: string) {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/users", { headers: H(t) });
      if (r.status === 401) { setToken(null); localStorage.removeItem("zn26_admin_token"); return; }
      const d = await r.json();
      setUsers(d.users ?? []);
    } catch {
      showMsg("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  }

  async function createUser() {
    if (!newName || !newEmail || !newPassword) {
      showMsg("All fields are required", "error"); return;
    }
    setCreating(true);
    try {
      const r = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...H(token!) },
        body: JSON.stringify({ name: newName, email: newEmail, password: newPassword }),
      });
      const d = await r.json();
      if (!r.ok) { showMsg(d.error ?? "Failed to create user", "error"); return; }
      showMsg(`Account created for ${newEmail}`);
      setNewName(""); setNewEmail(""); setNewPassword("");
      fetchUsers(token!);
    } catch {
      showMsg("Connection error", "error");
    } finally {
      setCreating(false);
    }
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`Delete account for ${email}? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/admin/users/${id}`, { method: "DELETE", headers: H(token!) });
      if (!r.ok) { showMsg("Failed to delete user", "error"); return; }
      showMsg(`${email} deleted`);
      fetchUsers(token!);
    } catch {
      showMsg("Connection error", "error");
    }
  }

  async function resetPassword() {
    if (!resetPass || resetPass.length < 8) {
      showMsg("Password must be at least 8 characters", "error"); return;
    }
    setResetting(true);
    try {
      const r = await fetch(`/api/admin/users/${resetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...H(token!) },
        body: JSON.stringify({ password: resetPass }),
      });
      const d = await r.json();
      if (!r.ok) { showMsg(d.error ?? "Failed to reset", "error"); return; }
      showMsg("Password reset successfully");
      setResetId(null); setResetPass("");
    } catch {
      showMsg("Connection error", "error");
    } finally {
      setResetting(false);
    }
  }

  function logout() {
    localStorage.removeItem("zn26_admin_token");
    setToken(null); setUsers([]);
  }

  // ── LOGIN PAGE ─────────────────────────────────────────────────────────────
  if (!token) return (
    <div style={{ minHeight: "100vh", background: D.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui,sans-serif" }}>
      <div style={{ width: 380, background: D.card, border: `1px solid ${D.border}`, borderRadius: 12, padding: "40px 36px" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: D.gold }}>ZION N26</div>
          <div style={{ fontSize: 12, color: D.muted, marginTop: 4 }}>Admin</div>
        </div>
        {loginErr && (
          <div style={{ background: "#2d1515", border: `1px solid ${D.danger}`, color: D.danger, padding: "10px 14px", borderRadius: 8, fontSize: 13, marginBottom: 16 }}>
            {loginErr}
          </div>
        )}
        <label style={S.lbl}>Admin Email</label>
        <input style={S.inp} type="email" placeholder="admin@iwgold.com" value={loginEmail} onChange={e => setLoginEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <label style={S.lbl}>Admin Password</label>
        <input style={S.inp} type="password" placeholder="••••••••" value={loginPass} onChange={e => setLoginPass(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} />
        <button style={{ ...S.btn, background: D.accent, marginTop: 4 }} onClick={handleLogin} disabled={loginLoading}>
          {loginLoading ? "Signing in..." : "Sign In"}
        </button>
        <p style={{ textAlign: "center", fontSize: 12, color: D.muted, marginTop: 16 }}>
          Admin credentials are set in your .env.local file
        </p>
      </div>
    </div>
  );

  // ── ADMIN PANEL ────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: D.bg, fontFamily: "system-ui,sans-serif", color: D.text }}>

      {/* Header */}
      <div style={{ background: D.sidebar, borderBottom: `1px solid ${D.border}`, padding: "0 28px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: D.gold }}>ZION N26</span>
          <span style={{ fontSize: 12, color: D.muted, background: D.card, padding: "2px 8px", borderRadius: 4, border: `1px solid ${D.border}` }}>Admin</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a href="/" style={{ fontSize: 12, color: D.accent, textDecoration: "none" }}>← Go to App</a>
          <button onClick={logout} style={{ fontSize: 12, color: D.muted, background: "none", border: "none", cursor: "pointer" }}>Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "32px auto", padding: "0 24px" }}>

        {/* Alert */}
        {msg && (
          <div style={{ background: msgType === "success" ? "#0d2818" : "#2d1515", border: `1px solid ${msgType === "success" ? D.success : D.danger}`, color: msgType === "success" ? D.success : D.danger, padding: "12px 16px", borderRadius: 8, fontSize: 13, marginBottom: 20 }}>
            {msg}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Total Users", value: users.length, color: D.accent },
            { label: "Active Accounts", value: users.length, color: D.success },
            { label: "Admin Status", value: "Active", color: D.gold },
          ].map((s, i) => (
            <div key={i} style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, color: D.muted, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>{s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>

          {/* Create user form */}
          <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>Create New Account</div>
            <label style={S.lbl}>Full Name</label>
            <input style={S.inp} placeholder="John Doe" value={newName} onChange={e => setNewName(e.target.value)} />
            <label style={S.lbl}>Email Address</label>
            <input style={S.inp} type="email" placeholder="john@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            <label style={S.lbl}>Password (min 8 characters)</label>
            <input style={S.inp} type="password" placeholder="••••••••••••" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
            <button style={{ ...S.btn, background: D.accent, marginTop: 4 }} onClick={createUser} disabled={creating}>
              {creating ? "Creating..." : "+ Create Account"}
            </button>
            <div style={{ marginTop: 16, padding: "12px 14px", background: "#0d1a2e", border: `1px solid #1a3a5c`, borderRadius: 8, fontSize: 11, color: D.muted, lineHeight: 1.6 }}>
              ℹ After creating an account, share the email and password with the user. They log in at the main URL.
            </div>
          </div>

          {/* Users list */}
          <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${D.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>All Users</span>
              <button onClick={() => fetchUsers(token!)} style={{ fontSize: 11, color: D.muted, background: "none", border: "none", cursor: "pointer" }}>↻ Refresh</button>
            </div>

            {loading ? (
              <div style={{ padding: "32px 18px", textAlign: "center", color: D.muted, fontSize: 13 }}>Loading...</div>
            ) : users.length === 0 ? (
              <div style={{ padding: "40px 18px", textAlign: "center", color: D.muted }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>👤</div>
                <div style={{ fontSize: 13 }}>No users yet — create the first account</div>
              </div>
            ) : users.map((u, i) => (
              <div key={u.id}>
                {/* Reset password modal inline */}
                {resetId === u.id && (
                  <div style={{ background: "#111820", padding: "12px 18px", borderBottom: `1px solid ${D.border}` }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Reset password for {u.email}</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input style={{ ...S.inp, marginBottom: 0, flex: 1 }} type="password" placeholder="New password (min 8 chars)" value={resetPass} onChange={e => setResetPass(e.target.value)} />
                      <button onClick={resetPassword} disabled={resetting} style={{ ...S.btn, width: "auto", padding: "8px 14px", background: D.warning, fontSize: 12 }}>
                        {resetting ? "..." : "Save"}
                      </button>
                      <button onClick={() => { setResetId(null); setResetPass(""); }} style={{ ...S.btn, width: "auto", padding: "8px 14px", background: "transparent", border: `1px solid ${D.border}`, color: D.muted, fontSize: 12 }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: i < users.length - 1 ? `1px solid ${D.border}` : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 34, height: 34, borderRadius: "50%", background: D.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                      {(u.name ?? u.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: D.muted }}>{u.email}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 11, color: D.muted, marginRight: 8 }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </div>
                    <button onClick={() => { setResetId(u.id); setResetPass(""); }} style={{ fontSize: 11, color: D.warning, background: "none", border: `1px solid ${D.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                      Reset Password
                    </button>
                    <button onClick={() => deleteUser(u.id, u.email)} style={{ fontSize: 11, color: D.danger, background: "none", border: `1px solid ${D.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div style={{ background: D.card, border: `1px solid ${D.border}`, borderRadius: 10, padding: 20, marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Admin Credentials</div>
          <div style={{ fontSize: 13, color: D.muted, lineHeight: 1.8 }}>
            Your admin email and password are set in <code style={{ background: "#111820", padding: "2px 6px", borderRadius: 4, color: D.text }}>.env.local</code> on your VPS.<br />
            To change them, update these two lines and restart the app:
          </div>
          <div style={{ background: "#111820", border: `1px solid ${D.border}`, borderRadius: 8, padding: "12px 16px", marginTop: 10, fontFamily: "monospace", fontSize: 12, color: D.success }}>
            ADMIN_EMAIL=your-admin-email@gmail.com<br />
            ADMIN_PASSWORD=your-secure-password
          </div>
          <div style={{ fontSize: 12, color: D.muted, marginTop: 10 }}>
            Admin session expires after 12 hours for security. You will need to log in again.
          </div>
        </div>

      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  lbl: { display: "block", fontSize: 11, fontWeight: 500, color: "#8b949e", marginBottom: 4 },
  inp: { display: "block", width: "100%", padding: "8px 12px", border: "1px solid #30363d", borderRadius: 6, fontSize: 13, marginBottom: 10, outline: "none", boxSizing: "border-box", color: "#e6edf3", background: "#0d1117", fontFamily: "inherit" },
  btn: { display: "block", width: "100%", padding: "9px 14px", background: "#1f6feb", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "inherit" },
};

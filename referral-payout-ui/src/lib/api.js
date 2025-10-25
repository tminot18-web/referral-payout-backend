// src/lib/api.js
const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/+$/, "") || "";

async function j(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let data;
    try { data = JSON.parse(text); } catch { data = { detail: text || res.statusText }; }
    const err = new Error(`${res.status} – ${JSON.stringify(data)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- Auth ----
export const login = (email, password) => j("/login", { method: "POST", body: { email, password } });
export const logout = () => j("/logout", { method: "POST" });
export const session = () => j("/session"); // optional

// ---- Users (approved) ----
export const listUsers = (q = "") =>
  q ? j(`/users?q=${encodeURIComponent(q)}`) : j("/users");

export const createUser = (u) => j("/users", { method: "POST", body: u });
export const deleteUser = (user_id) => j(`/users/${encodeURIComponent(user_id)}`, { method: "DELETE" });

// ---- Pending requests ----
export const listPending = () => j("/users/pending");
export const approvePending = (user_id) => j(`/users/pending/${encodeURIComponent(user_id)}/approve`, { method: "POST" });
export const denyPending = (user_id) => j(`/users/pending/${encodeURIComponent(user_id)}/deny`, { method: "POST" });

// ---- Payout / Tx ----
export const pay = (payload) => j("/pay", { method: "POST", body: payload });
export const listTxByUser = (user_id) => j(`/tx/user/${encodeURIComponent(user_id)}`);


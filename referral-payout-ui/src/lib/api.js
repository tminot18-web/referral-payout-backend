// src/lib/api.js

// Resolve API base:
// - Prefer Vite env: import.meta.env.VITE_API_BASE (set at build time)
// - Fallback: window.API_BASE (can be injected at runtime)
// - Else: empty string (relative to same origin)
const API_BASE =
  (import.meta.env?.VITE_API_BASE) ||
  (typeof window !== "undefined" && window.API_BASE) ||
  "";

// Generic JSON helper with good error messages and tolerance for empty bodies
async function j(req) {
  const res = await req;
  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { /* ignore parse errors */ }
    const msg =
      body?.detail ||
      body?.message ||
      res.statusText ||
      "Request failed";
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  const text = await res.text(); // some endpoints return 204/201 with no body
  return text ? JSON.parse(text) : null;
}

/* -----------------------------  AUTH  ---------------------------------- */

export const session = () =>
  j(fetch(`${API_BASE}/session`, { credentials: "include" }));

export const login = (email, password) =>
  j(fetch(`${API_BASE}/login`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  }));

export const logout = () =>
  j(fetch(`${API_BASE}/logout`, {
    method: "POST",
    credentials: "include"
  }));

/* -----------------------------  USERS  --------------------------------- */

// List approved users (the backend returns all users; optionally supports q/status_filter)
export const listUsers = (statusFilter, q) => {
  const url = new URL(`${API_BASE}/users`, window.location.origin);
  if (statusFilter) url.searchParams.set("status_filter", statusFilter);
  if (q) url.searchParams.set("q", q);
  return j(fetch(url.toString(), { credentials: "include" }));
};

export const getUser = (userId) =>
  j(fetch(`${API_BASE}/users/${encodeURIComponent(userId)}`, {
    credentials: "include"
  }));

export const createUser = (payload) =>
  j(fetch(`${API_BASE}/users`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }));

export const deleteUser = (userId) =>
  j(fetch(`${API_BASE}/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    credentials: "include"
  }));

/* ----------------------  PENDING & MODERATION  ------------------------- */

// Admin: fetch pending entries
export const listPending = () =>
  j(fetch(`${API_BASE}/users/pending`, { credentials: "include" }));

// Admin: approve/deny a specific pending user_id
export const approvePending = (userId) =>
  j(fetch(`${API_BASE}/users/pending/${encodeURIComponent(userId)}/approve`, {
    method: "POST",
    credentials: "include"
  }));

export const denyPending = (userId) =>
  j(fetch(`${API_BASE}/users/pending/${encodeURIComponent(userId)}/deny`, {
    method: "POST",
    credentials: "include"
  }));

/* -----------------------------  PUBLIC FORM  --------------------------- */

// Public form submit (no cookies required)
export const publicSelfAdd = (payload) =>
  j(fetch(`${API_BASE}/users/public`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(payload)
  }));

/* ------------------------------  TX / PAY  ----------------------------- */

export const createTx = (payload) =>
  j(fetch(`${API_BASE}/tx`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }));

export const txByUser = (userId) =>
  j(fetch(`${API_BASE}/tx/user/${encodeURIComponent(userId)}`, {
    credentials: "include"
  }));

export const pay = (payload) =>
  j(fetch(`${API_BASE}/pay`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }));

/* --------------------  COMPATIBILITY SHIMS  ---------------------------- */
/* Keep existing App.jsx imports working without edits. */

// Old UI expects listApproved(); backend returns all approved users via /users.
// Just delegate to listUsers() and let the UI render the table.
export const listApproved = () => listUsers();

// Old UI expects updateUserStatus(userId, "approved" | "denied").
// Map that to the new moderation endpoints.
export const updateUserStatus = (userId, status) => {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return approvePending(userId);
  if (s === "denied")   return denyPending(userId);
  return Promise.reject(new Error(`Unsupported status: ${status}`));
};


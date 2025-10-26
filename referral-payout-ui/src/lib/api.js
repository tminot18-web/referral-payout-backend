// src/lib/api.js

// ---- Base URL --------------------------------------------------------------
const API_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE) ||
  (typeof window !== "undefined" && window.API_BASE) ||
  "";

// Normalize base + path
function joinUrl(path) {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

// Common JSON/error handler
async function asJson(req) {
  const res = await req;
  const text = await res.text();
  const data = text ? tryJson(text) : null;

  if (!res.ok) {
    const msg =
      (data && (data.detail || data.message)) ||
      res.statusText ||
      "Request failed";
    const err = new Error(msg);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function tryJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

// ---- Auth ------------------------------------------------------------------
export const session = () =>
  asJson(fetch(joinUrl("/session"), { credentials: "include" }));

export const login = (email, password) =>
  asJson(fetch(joinUrl("/login"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));

export const logout = () =>
  asJson(fetch(joinUrl("/logout"), { method: "POST", credentials: "include" }));

// ---- Approved/denied users (main users table) ------------------------------
export const listUsers = (statusFilter) => {
  const url = new URL(joinUrl("/users"), window.location.origin);
  if (statusFilter) url.searchParams.set("status_filter", statusFilter);
  return asJson(fetch(url.toString(), { credentials: "include" }));
};

export const getUser = (userId) =>
  asJson(fetch(joinUrl(`/users/${encodeURIComponent(userId)}`), {
    credentials: "include",
  }));

export const createUser = (payload) =>
  asJson(fetch(joinUrl("/users"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));

export const deleteUser = (userId) =>
  asJson(fetch(joinUrl(`/users/${encodeURIComponent(userId)}`), {
    method: "DELETE",
    credentials: "include",
  }));

export const updateUserStatus = (userId, status) =>
  asJson(fetch(joinUrl(`/users/${encodeURIComponent(userId)}/status`), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }), // "pending" | "approved" | "denied"
  }));

export const listApproved = () => listUsers("approved");

// ---- Pending users (pending_users table) -----------------------------------
export const listPending = () =>
  asJson(fetch(joinUrl("/users/pending"), { credentials: "include" }));

export const approvePending = (userId) =>
  asJson(fetch(joinUrl(`/users/pending/${encodeURIComponent(userId)}/approve`), {
    method: "POST",
    credentials: "include",
  }));

export const denyPending = (userId) =>
  asJson(fetch(joinUrl(`/users/pending/${encodeURIComponent(userId)}/deny`), {
    method: "POST",
    credentials: "include",
  }));

// ---- Public form (no cookies) ----------------------------------------------
export const publicSelfAdd = (payload) =>
  asJson(fetch(joinUrl("/users/public"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    body: JSON.stringify(payload),
  }));

// ---- Tx / Pay --------------------------------------------------------------
export const createTx = (payload) =>
  asJson(fetch(joinUrl("/tx"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));

export const txByUser = (userId) =>
  asJson(fetch(joinUrl(`/tx/user/${encodeURIComponent(userId)}`), {
    credentials: "include",
  }));

export const pay = (payload) =>
  asJson(fetch(joinUrl("/pay"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));


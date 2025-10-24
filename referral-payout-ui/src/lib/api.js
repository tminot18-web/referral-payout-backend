// src/lib/api.js

const API_BASE =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE) ||
  process.env.VITE_API_BASE || // for some CI tools
  "http://localhost:8000";

async function req(path, { method = "GET", headers = {}, body, credentials = "include" } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
    credentials,
  });
  // Allow 204
  if (res.status === 204) return null;
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Invalid JSON from ${path}: ${text?.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const API = {
  // Auth
  login: (payload) => req("/login", { method: "POST", body: payload }),
  logout: () => req("/logout", { method: "POST" }),
  session: () => req("/session"),

  // Users
  listUsers: (q) => req(`/users${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  getUser: (user_id) => req(`/users/${encodeURIComponent(user_id)}`),
  createUser: (payload) => req("/users", { method: "POST", body: payload }),
  deleteUser: (user_id) => req(`/users/${encodeURIComponent(user_id)}`, { method: "DELETE" }),

  // Pending/approve/deny
  listPending: () => req("/users/pending"),
  approveUser: (user_id) => req(`/users/${encodeURIComponent(user_id)}/approve`, { method: "POST" }),
  denyUser: (user_id) => req(`/users/${encodeURIComponent(user_id)}/deny`, { method: "POST" }),

  // Tx & Pay
  listTxByUser: (user_id) => req(`/tx/user/${encodeURIComponent(user_id)}`),
  createTx: (payload) => req("/tx", { method: "POST", body: payload }),
  pay: (payload) => req("/pay", { method: "POST", body: payload }),
};

// Optional convenience exports
export default API;
export { API_BASE };


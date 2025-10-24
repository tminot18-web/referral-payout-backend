export const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/+$/, '') ||
  'https://referral-payout-backend.onrender.com';

async function request(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'include',
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = (body && body.detail) ? body.detail : (typeof body === 'string' ? body : 'Request failed');
    const err = new Error(detail);
    err.status = res.status; err.response = body;
    throw err;
  }
  return body;
}

export const api = {
  login: (email, password) => request('/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/logout', { method: 'POST' }),

  users: (q, statusFilter) =>
    request(`/users${q || statusFilter ? `?${new URLSearchParams({ ...(q?{q}:{}) , ...(statusFilter?{status_filter:statusFilter}:{}) }).toString()}` : ''}`),

  createUser: (u) => request('/users', { method: 'POST', body: JSON.stringify(u) }),
  delUser: (user_id) => request(`/users/${encodeURIComponent(user_id)}`, { method: 'DELETE' }),
  updateUserStatus: (user_id, status) =>
    request(`/users/${encodeURIComponent(user_id)}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  pay: (payload) => request('/pay', { method: 'POST', body: JSON.stringify(payload) }),
  txByUser: (user_id) => request(`/tx/user/${encodeURIComponent(user_id)}`),
};


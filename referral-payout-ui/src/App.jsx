import { useEffect, useMemo, useState } from "react";

// --- API base (set this in Netlify: VITE_API_BASE=https://referral-payout-backend.onrender.com)
const API = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");

// Small helpers
const jfetch = async (url, opts = {}) => {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} — ${text || "Request failed"}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
};

const sectionCard = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
};

const h2Style = { fontSize: 18, fontWeight: 700, margin: 0 };
const labelStyle = { fontSize: 14, fontWeight: 600 };
const inputStyle = {
  width: "100%",
  border: "1px solid #d1d5db",
  borderRadius: 10,
  padding: "10px 12px",
  fontSize: 14,
  outline: "none",
};
const buttonPrimary = {
  background: "#6236FF",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  fontWeight: 600,
  cursor: "pointer",
};
const buttonSoft = {
  background: "#f3f4f6",
  color: "#111827",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 600,
  cursor: "pointer",
};
const badge = {
  background: "#f3f4f6",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#111827",
};

// Wallet (client) helpers — gate UI only; your payouts still log server-side
const hasMetaMask = () => typeof window !== "undefined" && !!window.ethereum;
const hasTronLink = () => typeof window !== "undefined" && !!window.tronWeb;

export default function App() {
  // auth probe (if you want to hide UI when logged out, add a /session probe)
  const [authed, setAuthed] = useState(true);

  // data
  const [pending, setPending] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");

  // add user form
  const [newUser, setNewUser] = useState({
    user_id: "",
    nick: "",
    email: "",
    wallet: "",
    network: "ERC20",
  });

  // payout form
  const [payUser, setPayUser] = useState("");
  const [amount, setAmount] = useState(25);
  const [network, setNetwork] = useState("ERC20");
  const [txHash, setTxHash] = useState("");

  // wallet state (client only)
  const [mmConnected, setMMConnected] = useState(false);
  const [tlConnected, setTLConnected] = useState(false);
  const [toast, setToast] = useState("");

  // Load lists
  const load = async () => {
    try {
      const [p, u] = await Promise.all([
        jfetch(`${API}/users/pending`),
        jfetch(`${API}/users`),
      ]);
      setPending(Array.isArray(p) ? p : []);
      setUsers(Array.isArray(u) ? u : []);
      if (!payUser && u?.length) setPayUser(u[0].user_id);
    } catch (e) {
      // If your backend exposes /session, you could flip authed here
      console.error(e);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // simple toast
  const flash = (msg, ms = 2200) => {
    setToast(msg);
    setTimeout(() => setToast(""), ms);
  };

  // ---- Actions: Pending
  const approve = async (user_id) => {
    try {
      await jfetch(`${API}/users/pending/${encodeURIComponent(user_id)}/approve`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      flash(`Approved ${user_id}`);
      await load();
    } catch (e) {
      flash(e.message);
    }
  };
  const deny = async (user_id) => {
    try {
      await jfetch(`${API}/users/pending/${encodeURIComponent(user_id)}/deny`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      flash(`Denied ${user_id}`);
      await load();
    } catch (e) {
      flash(e.message);
    }
  };

  // ---- Actions: Users
  const createUser = async () => {
    if (!newUser.user_id || !newUser.email) {
      flash("User ID and Email required");
      return;
    }
    try {
      await jfetch(`${API}/users`, { method: "POST", body: JSON.stringify(newUser) });
      setNewUser({ user_id: "", nick: "", email: "", wallet: "", network: "ERC20" });
      flash("User created");
      await load();
    } catch (e) {
      flash(e.message);
    }
  };
  const delUser = async (user_id) => {
    if (!confirm(`Delete ${user_id}?`)) return;
    try {
      await jfetch(`${API}/users/${encodeURIComponent(user_id)}`, { method: "DELETE" });
      flash("Deleted");
      await load();
    } catch (e) {
      flash(e.message);
    }
  };

  // ---- Actions: Payout
  const sendPayout = async () => {
    if (!payUser || !amount || amount <= 0) {
      flash("Choose user and amount > 0");
      return;
    }
    try {
      const payload = {
        user_id: payUser,
        amount: Number(amount),
        network,
        tx_hash: txHash.trim(),
      };
      await jfetch(`${API}/pay`, { method: "POST", body: JSON.stringify(payload) });
      flash(`Paid ${amount} to ${payUser}`);
      setTxHash("");
      await load();
    } catch (e) {
      flash(e.message);
    }
  };

  // ---- Wallet connect (optional visual only)
  const connectMetaMask = async () => {
    if (!hasMetaMask()) {
      flash("MetaMask not found. Please install the wallet extension.");
      return;
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      setMMConnected(true);
      flash("MetaMask connected");
    } catch (e) {
      flash(e.message || "MetaMask connect failed");
    }
  };
  const connectTronLink = async () => {
    if (!hasTronLink()) {
      flash("TronLink not found. Please install the wallet extension.");
      return;
    }
    try {
      // TronLink auto-injects; a ping is enough to reflect availability
      setTLConnected(true);
      flash("TronLink detected");
    } catch (e) {
      flash(e.message || "TronLink connect failed");
    }
  };

  const filteredUsers = useMemo(() => {
    const q = (search || "").toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.user_id.toLowerCase().includes(q) ||
        (u.nick || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.wallet || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  if (!authed) {
    // if you decide to hide when unauthenticated
    return (
      <div style={{ maxWidth: 1100, margin: "28px auto", padding: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Referral Payout — Admin</h1>
        <div style={{ marginTop: 16, ...sectionCard }}>
          <p>Unauthenticated. Please sign in.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "28px auto", padding: "0 16px 40px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, flex: 1 }}>
          Referral Payout — Admin
        </h1>
        <button
          type="button"
          style={buttonSoft}
          onClick={(e) => {
            e.preventDefault();
            connectMetaMask();
          }}
        >
          {mmConnected ? "MetaMask Connected" : "Connect MetaMask"}
        </button>
        <button
          type="button"
          style={buttonSoft}
          onClick={(e) => {
            e.preventDefault();
            connectTronLink();
          }}
        >
          {tlConnected ? "TronLink Detected" : "Connect TronLink"}
        </button>
      </div>

      {/* Pending Requests */}
      <div style={{ ...sectionCard, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <h2 style={h2Style}>Pending Requests</h2>
          <span style={badge}>Pending: {pending?.length || 0}</span>
        </div>

        {(!pending || pending.length === 0) ? (
          <div style={{ color: "#6b7280" }}>No pending requests.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 13 }}>
                <th>User ID</th>
                <th>Nick</th>
                <th>Email</th>
                <th>Wallet</th>
                <th>Network</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u) => (
                <tr key={`p_${u.user_id}`} style={{ borderTop: "1px solid #f3f4f6" }}>
                  <td>{u.user_id}</td>
                  <td>{u.nick}</td>
                  <td>{u.email}</td>
                  <td>{u.wallet}</td>
                  <td>{u.network}</td>
                  <td style={{ display: "flex", gap: 8, padding: "8px 0" }}>
                    <button
                      type="button"
                      style={buttonSoft}
                      onClick={(e) => {
                        e.preventDefault();
                        approve(u.user_id);
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      style={{ ...buttonSoft, color: "#b91c1c", borderColor: "#fecaca", background: "#fff5f5" }}
                      onClick={(e) => {
                        e.preventDefault();
                        deny(u.user_id);
                      }}
                    >
                      Deny
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Users */}
      <div style={{ ...sectionCard, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h2 style={h2Style}>Users</h2>
          <div style={{ marginLeft: "auto", width: 360, maxWidth: "100%" }}>
            <input
              style={inputStyle}
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7280", fontSize: 13 }}>
              <th>User ID</th>
              <th>Nick</th>
              <th>Email</th>
              <th>Wallet</th>
              <th>Network</th>
              <th>Total Paid</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => (
              <tr key={u.user_id} style={{ borderTop: "1px solid #f3f4f6" }}>
                <td>{u.user_id}</td>
                <td>{u.nick}</td>
                <td>{u.email}</td>
                <td>{u.wallet}</td>
                <td>{u.network}</td>
                <td>{u.total_paid ?? 0}</td>
                <td>
                  <button
                    type="button"
                    style={{ ...buttonSoft, color: "#b91c1c", borderColor: "#fecaca", background: "#fff5f5" }}
                    onClick={(e) => {
                      e.preventDefault();
                      delUser(u.user_id);
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: "#6b7280", padding: "8px 0" }}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add User */}
      <div style={{ ...sectionCard, marginBottom: 16 }}>
        <h2 style={{ ...h2Style, marginBottom: 12 }}>Add User</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
          <div>
            <div style={labelStyle}>User ID</div>
            <input
              style={inputStyle}
              value={newUser.user_id}
              onChange={(e) => setNewUser({ ...newUser, user_id: e.target.value })}
              placeholder="u_123"
            />
          </div>
          <div>
            <div style={labelStyle}>Nick</div>
            <input
              style={inputStyle}
              value={newUser.nick}
              onChange={(e) => setNewUser({ ...newUser, nick: e.target.value })}
              placeholder="alex"
            />
          </div>
          <div>
            <div style={labelStyle}>Email</div>
            <input
              style={inputStyle}
              value={newUser.email}
              onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              placeholder="alex@example.com"
            />
          </div>
          <div>
            <div style={labelStyle}>Wallet</div>
            <input
              style={inputStyle}
              value={newUser.wallet}
              onChange={(e) => setNewUser({ ...newUser, wallet: e.target.value })}
              placeholder="0xabc..."
            />
          </div>
          <div>
            <div style={labelStyle}>Network</div>
            <select
              style={{ ...inputStyle, padding: "10px 10px" }}
              value={newUser.network}
              onChange={(e) => setNewUser({ ...newUser, network: e.target.value })}
            >
              <option value="ERC20">ERC20</option>
              <option value="TRC20">TRC20</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            style={{ ...buttonPrimary, width: "100%", padding: "14px 18px", fontSize: 16 }}
            onClick={(e) => {
              e.preventDefault();
              createUser();
            }}
          >
            Create User
          </button>
        </div>
      </div>

      {/* Payout */}
      <div style={{ ...sectionCard }}>
        <h2 style={{ ...h2Style, marginBottom: 12 }}>Payout</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 12 }}>
          <div>
            <div style={labelStyle}>User</div>
            <select
              style={{ ...inputStyle, padding: "10px 10px" }}
              value={payUser}
              onChange={(e) => setPayUser(e.target.value)}
            >
              {users.map((u) => (
                <option key={`uopt_${u.user_id}`} value={u.user_id}>
                  {u.user_id} — {u.nick}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div style={labelStyle}>Amount (USDT)</div>
            <input
              style={inputStyle}
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <div style={labelStyle}>Tx Hash (optional)</div>
            <input
              style={inputStyle}
              placeholder="0x..."
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
            />
          </div>
          <div>
            <div style={labelStyle}>Network</div>
            <select
              style={{ ...inputStyle, padding: "10px 10px" }}
              value={network}
              onChange={(e) => setNetwork(e.target.value)}
            >
              <option value="ERC20">ERC20</option>
              <option value="TRC20">TRC20</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            style={{ ...buttonPrimary, padding: "12px 18px" }}
            onClick={(e) => {
              e.preventDefault();
              sendPayout();
            }}
          >
            Send Payout
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#111827",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            zIndex: 50,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}


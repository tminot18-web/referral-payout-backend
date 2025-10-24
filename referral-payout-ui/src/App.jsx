import { useEffect, useMemo, useState } from "react";
import { API } from "./lib/api";
import { connectMetaMask, connectTronLink } from "./lib/wallet";

function Pill({ children, color = "gray" }) {
  const cls = {
    gray: "bg-gray-100 text-gray-800",
    green: "bg-green-100 text-green-800",
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-800",
  }[color];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

export default function App() {
  const [users, setUsers] = useState([]);
  const [pending, setPending] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [ethAddr, setEthAddr] = useState("");
  const [tronAddr, setTronAddr] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [u, p] = await Promise.all([API.listUsers(""), API.listPending()]);
      setUsers(u || []);
      setPending(p || []);
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredUsers = useMemo(() => {
    if (!q.trim()) return users;
    const s = q.toLowerCase();
    return users.filter(
      (u) =>
        u.user_id.toLowerCase().includes(s) ||
        (u.nick || "").toLowerCase().includes(s) ||
        (u.email || "").toLowerCase().includes(s) ||
        (u.wallet || "").toLowerCase().includes(s)
    );
  }, [users, q]);

  async function handleApprove(user_id) {
    setError(""); setNotice("");
    try {
      await API.approveUser(user_id);
      setNotice(`Approved ${user_id}`);
      await load();
    } catch (e) {
      setError(e.message || "Approve failed");
    }
  }
  async function handleDeny(user_id) {
    setError(""); setNotice("");
    try {
      await API.denyUser(user_id);
      setNotice(`Denied ${user_id}`);
      await load();
    } catch (e) {
      setError(e.message || "Deny failed");
    }
  }

  async function onConnectMetaMask() {
    setError(""); setNotice("");
    try {
      const { address } = await connectMetaMask();
      setEthAddr(address);
      setNotice(`MetaMask connected: ${address.slice(0,6)}...${address.slice(-4)}`);
    } catch (e) {
      setError(e.message);
    }
  }
  async function onConnectTronLink() {
    setError(""); setNotice("");
    try {
      const { address } = await connectTronLink();
      setTronAddr(address);
      setNotice(`TronLink connected: ${address.slice(0,6)}...${address.slice(-4)}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Referral Payout — Admin</h1>
        <div className="flex gap-3">
          <button onClick={onConnectMetaMask} className="rounded-md bg-indigo-600 px-3 py-2 text-white hover:bg-indigo-700">
            {ethAddr ? `Connected: ${ethAddr.slice(0,6)}…${ethAddr.slice(-4)}` : "Connect MetaMask"}
          </button>
          <button onClick={onConnectTronLink} className="rounded-md bg-blue-600 px-3 py-2 text-white hover:bg-blue-700">
            {tronAddr ? `Connected: ${tronAddr.slice(0,6)}…${tronAddr.slice(-4)}` : "Connect TronLink"}
          </button>
        </div>
      </header>

      {notice && <div className="rounded-md bg-green-50 p-3 text-green-800">{notice}</div>}
      {error && <div className="rounded-md bg-red-50 p-3 text-red-800">{error}</div>}

      {/* Pending Requests */}
      <section className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Pending Requests</h2>
          <Pill color="yellow">Pending: {pending.length}</Pill>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-500">No pending requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">User ID</th>
                  <th className="py-2 text-left">Nick</th>
                  <th className="py-2 text-left">Email</th>
                  <th className="py-2 text-left">Wallet</th>
                  <th className="py-2 text-left">Network</th>
                  <th className="py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.user_id} className="border-b">
                    <td className="py-2">{r.user_id}</td>
                    <td className="py-2">{r.nick}</td>
                    <td className="py-2">{r.email}</td>
                    <td className="py-2">{r.wallet}</td>
                    <td className="py-2">{r.network}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(r.user_id)}
                          className="rounded bg-green-600 px-2 py-1 text-white hover:bg-green-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleDeny(r.user_id)}
                          className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700"
                        >
                          Deny
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Users */}
      <section className="rounded-lg border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Users</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-72 rounded border px-3 py-2"
          />
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-2 text-left">User ID</th>
                  <th className="py-2 text-left">Nick</th>
                  <th className="py-2 text-left">Email</th>
                  <th className="py-2 text-left">Wallet</th>
                  <th className="py-2 text-left">Network</th>
                  <th className="py-2 text-left">Total Paid</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.user_id} className="border-b">
                    <td className="py-2">{u.user_id}</td>
                    <td className="py-2">{u.nick}</td>
                    <td className="py-2">{u.email}</td>
                    <td className="py-2">{u.wallet}</td>
                    <td className="py-2">{u.network}</td>
                    <td className="py-2">{u.total_paid ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}


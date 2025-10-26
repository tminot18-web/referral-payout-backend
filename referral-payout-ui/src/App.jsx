// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import {
  session, login, logout,
  listPending, listApproved,
  approvePending, denyPending,   // <-- changed
  createUser, deleteUser, pay
} from "./lib/api";
import {
  isMetaMaskAvailable, connectMetaMask, onEthereumEvents,
  isTronLinkAvailable, connectTronLink, waitForTronWeb
} from "./lib/wallets";

const cx = (...a) => a.filter(Boolean).join(" ");

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Data
  const [pending, setPending] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");

  // Create user form
  const [form, setForm] = useState({ user_id: "", nick: "", email: "", wallet: "", network: "ERC20" });

  // Payout form
  const [payUserId, setPayUserId] = useState("");
  const [amount, setAmount] = useState("25");
  const [network, setNetwork] = useState("ERC20");
  const [txHash, setTxHash] = useState("");

  // Wallet state
  const [mmAvailable, setMmAvailable] = useState(false);
  const [tlAvailable, setTlAvailable] = useState(false);
  const [ethAccount, setEthAccount] = useState("");
  const [ethChainId, setEthChainId] = useState("");
  const [tronAccount, setTronAccount] = useState("");
  const [walletError, setWalletError] = useState("");

  // Bootstrap
  async function bootstrap() {
    setLoading(true);
    setError("");
    try {
      await session(); // throws if unauthenticated
      setAuthed(true);
      const [p, a] = await Promise.all([listPending(), listApproved()]);
      setPending(p || []);
      setUsers(a || []);
      if (!payUserId && a?.length) setPayUserId(a[0].user_id);
    } catch {
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { bootstrap(); }, []);

  // Wallet availability + listeners
  useEffect(() => {
    setMmAvailable(isMetaMaskAvailable());
    setTlAvailable(isTronLinkAvailable());

    const off = onEthereumEvents({
      onAccountsChanged: (acc) => setEthAccount(acc || ""),
      onChainChanged: (cid) => setEthChainId(cid || ""),
    });

    let mounted = true;
    (async () => {
      if (!tlAvailable) {
        const ready = await waitForTronWeb(3000);
        if (mounted && ready) setTlAvailable(true);
      }
      const addr = window.tronWeb?.defaultAddress?.base58;
      if (mounted && addr) setTronAccount(addr);
    })();

    return () => {
      mounted = false;
      off();
    };
  }, []);

  // Auth
  async function doLogin(e) {
    e.preventDefault();
    setError("");
    const fd = new FormData(e.currentTarget);
    const email = fd.get("email");
    const password = fd.get("password");
    try {
      await login(email, password);
      await bootstrap();
    } catch (err) {
      setError(err.message || "Login failed");
    }
  }

  async function doLogout() {
    await logout();
    setAuthed(false);
  }

  // Pending actions (use dedicated endpoints)
  async function onApprove(id) {
    try {
      await approvePending(id);
      const [p, a] = await Promise.all([listPending(), listApproved()]);
      setPending(p || []);
      setUsers(a || []);
    } catch (err) {
      alert(err.message || "Approve failed");
    }
  }

  async function onDeny(id) {
    try {
      await denyPending(id);
      const p = await listPending();
      setPending(p || []);
    } catch (err) {
      alert(err.message || "Deny failed");
    }
  }

  // Create/Delete user
  async function onCreateUser(e) {
    e.preventDefault();
    try {
      await createUser(form);
      setForm({ user_id: "", nick: "", email: "", wallet: "", network: "ERC20" });
      const [p, a] = await Promise.all([listPending(), listApproved()]);
      setPending(p || []);
      setUsers(a || []);
    } catch (err) {
      alert(err.message || "Create failed");
    }
  }

  async function onDeleteUser(id) {
    if (!confirm(`Delete ${id}?`)) return;
    try {
      await deleteUser(id);
      const a = await listApproved();
      setUsers(a || []);
    } catch (err) {
      alert(err.message || "Delete failed");
    }
  }

  // Payout
  async function onSendPayout(e) {
    e.preventDefault();
    const amt = Number(amount);
    if (!payUserId || !amt || amt <= 0) return;
    try {
      const res = await pay({
        user_id: payUserId,
        amount: amt,
        network,
        tx_hash: txHash,
        status: "success"
      });
      alert(`Paid ${amt} to ${payUserId} (tx #${res?.tx_id ?? "?"})`);
      const a = await listApproved();
      setUsers(a || []);
      setTxHash("");
    } catch (err) {
      alert(err.message || "Payout failed");
    }
  }

  // Wallet handlers
  async function handleConnectMetaMask() {
    setWalletError("");
    try {
      const { account, chainId } = await connectMetaMask();
      setEthAccount(account || "");
      setEthChainId(chainId || "");
    } catch (e) {
      setWalletError(e.message || "MetaMask connect failed");
    }
  }

  async function handleConnectTronLink() {
    setWalletError("");
    try {
      await waitForTronWeb(3000);
      const { account } = await connectTronLink();
      setTronAccount(account || "");
    } catch (e) {
      setWalletError(e.message || "TronLink connect failed");
    }
  }

  // Filters
  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      `${u.user_id} ${u.nick} ${u.email} ${u.wallet}`.toLowerCase().includes(q)
    );
  }, [users, search]);

  // UI
  if (loading) return <div className="p-10">Loading…</div>;

  if (!authed) {
    return (
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Referral Payout — Admin</h1>
        <form onSubmit={doLogin} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Admin Email</label>
            <input name="email" type="email" defaultValue="admin@example.com" className="w-full border rounded p-2" />
          </div>
          <div>
            <label className="block text-sm mb-1">Password</label>
            <input name="password" type="password" className="w-full border rounded p-2" />
          </div>
          {error && <div className="text-red-600 text-sm">{error}</div>}
          <button className="px-4 py-2 rounded bg-purple-600 text-white cursor-pointer hover:bg-purple-700">
            Sign In
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header with wallet buttons */}
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Referral Payout — Admin</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleConnectMetaMask}
            disabled={!mmAvailable}
            title={mmAvailable ? "Connect MetaMask" : "MetaMask not found"}
            className={cx(
              "px-3 py-2 rounded border transition cursor-pointer",
              "hover:bg-purple-50 active:bg-purple-100",
              !mmAvailable && "opacity-50 cursor-not-allowed"
            )}
          >
            {ethAccount
              ? `MetaMask: ${ethAccount.slice(0, 6)}…${ethAccount.slice(-4)}`
              : "Connect MetaMask"}
          </button>

          <button
            onClick={handleConnectTronLink}
            disabled={!tlAvailable}
            title={tlAvailable ? "Connect TronLink" : "TronLink not found"}
            className={cx(
              "px-3 py-2 rounded border transition cursor-pointer",
              "hover:bg-purple-50 active:bg-purple-100",
              !tlAvailable && "opacity-50 cursor-not-allowed"
            )}
          >
            {tronAccount
              ? `TronLink: ${tronAccount.slice(0, 6)}…${tronAccount.slice(-4)}`
              : "Connect TronLink"}
          </button>

          <button
            onClick={doLogout}
            className="px-3 py-2 border rounded cursor-pointer hover:bg-gray-50"
          >
            Logout
          </button>
        </div>
      </header>

      {walletError && (
        <div className="mt-1 p-3 rounded bg-red-50 text-red-700 text-sm border border-red-200">
          {walletError}
        </div>
      )}

      {/* Pending */}
      <section className="border rounded p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Pending Requests</h2>
          <span className="text-sm text-gray-600">Pending: {pending.length}</span>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">User ID</th>
                <th className="py-2 pr-2">Nick</th>
                <th className="py-2 pr-2">Email</th>
                <th className="py-2 pr-2">Wallet</th>
                <th className="py-2 pr-2">Network</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.length === 0 && (
                <tr><td className="py-4 text-gray-500" colSpan={6}>No pending requests.</td></tr>
              )}
              {pending.map(u => (
                <tr key={u.user_id} className="border-b">
                  <td className="py-2 pr-2">{u.user_id}</td>
                  <td className="py-2 pr-2">{u.nick}</td>
                  <td className="py-2 pr-2">{u.email}</td>
                  <td className="py-2 pr-2">{u.wallet}</td>
                  <td className="py-2 pr-2">{u.network}</td>
                  <td className="py-2 space-x-2">
                    <button
                      onClick={() => onApprove(u.user_id)}
                      className="px-3 py-1 rounded bg-green-600 text-white cursor-pointer hover:bg-green-700"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onDeny(u.user_id)}
                      className="px-3 py-1 rounded bg-red-600 text-white cursor-pointer hover:bg-red-700"
                    >
                      Deny
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Users */}
      <section className="border rounded p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg">Users</h2>
        </div>

        <div className="flex items-center justify-between mt-3">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className="border rounded p-2 w-64"
          />
        </div>

        <div className="overflow-x-auto mt-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">User ID</th>
                <th className="py-2 pr-2">Nick</th>
                <th className="py-2 pr-2">Email</th>
                <th className="py-2 pr-2">Wallet</th>
                <th className="py-2 pr-2">Network</th>
                <th className="py-2 pr-2">Total Paid</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(u => (
                <tr key={u.user_id} className="border-b">
                  <td className="py-2 pr-2">{u.user_id}</td>
                  <td className="py-2 pr-2">{u.nick}</td>
                  <td className="py-2 pr-2">{u.email}</td>
                  <td className="py-2 pr-2">{u.wallet}</td>
                  <td className="py-2 pr-2">{u.network}</td>
                  <td className="py-2 pr-2">{u.total_paid ?? 0}</td>
                  <td className="py-2">
                    <button
                      onClick={() => onDeleteUser(u.user_id)}
                      className="px-3 py-1 rounded border cursor-pointer hover:bg-gray-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr><td className="py-4 text-gray-500" colSpan={7}>No users found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Create */}
      <section className="border rounded p-4">
        <h2 className="font-semibold text-lg mb-2">Add User</h2>
        <form onSubmit={onCreateUser} className="space-y-3">
          <input className="w-full border rounded p-2" placeholder="User ID" value={form.user_id} onChange={e => setForm({ ...form, user_id: e.target.value })} />
          <input className="w-full border rounded p-2" placeholder="Nick" value={form.nick} onChange={e => setForm({ ...form, nick: e.target.value })} />
          <input className="w-full border rounded p-2" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input className="w-full border rounded p-2" placeholder="Wallet" value={form.wallet} onChange={e => setForm({ ...form, wallet: e.target.value })} />
          <select className="w-full border rounded p-2" value={form.network} onChange={e => setForm({ ...form, network: e.target.value })}>
            <option>ERC20</option>
            <option>TRC20</option>
          </select>
          <button className="w-full py-3 rounded bg-purple-600 text-white cursor-pointer hover:bg-purple-700">
            Create User
          </button>
        </form>
      </section>

      {/* Payout */}
      <section className="border rounded p-4">
        <h2 className="font-semibold text-lg mb-2">Payout</h2>
        <form onSubmit={onSendPayout} className="grid md:grid-cols-4 gap-3 items-center">
          <select className="border rounded p-2" value={payUserId} onChange={e => setPayUserId(e.target.value)}>
            {users.map(u => <option key={u.user_id} value={u.user_id}>{u.user_id} — {u.nick}</option>)}
          </select>
          <input className="border rounded p-2" value={amount} onChange={e => setAmount(e.target.value)} />
          <select className="border rounded p-2" value={network} onChange={e => setNetwork(e.target.value)}>
            <option>ERC20</option>
            <option>TRC20</option>
          </select>
          <input className="border rounded p-2" placeholder="Tx Hash (optional)" value={txHash} onChange={e => setTxHash(e.target.value)} />
          <div className="md:col-span-4">
            <button className="w-full py-3 rounded bg-purple-600 text-white cursor-pointer hover:bg-purple-700">
              Send Payout
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}


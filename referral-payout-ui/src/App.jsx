// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import { API } from "./lib/api"; // your existing api helper
import {
  walletState,
  connectMetaMask,
  connectTronLink,
  payOnChain,
} from "./lib/wallet";

const fmt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toString();

export default function App() {
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  // create user form
  const [nu, setNu] = useState({
    user_id: "",
    nick: "",
    email: "",
    wallet: "",
    network: "ERC20",
  });

  // payout form
  const [payUserId, setPayUserId] = useState("");
  const [payAmount, setPayAmount] = useState("25");
  const [payNetwork, setPayNetwork] = useState("ERC20");
  const [payHash, setPayHash] = useState("");
  const [onChain, setOnChain] = useState(false);
  const [msg, setMsg] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.user_id.toLowerCase().includes(needle) ||
        (u.nick || "").toLowerCase().includes(needle) ||
        (u.email || "").toLowerCase().includes(needle) ||
        (u.wallet || "").toLowerCase().includes(needle)
    );
  }, [users, q]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await API.listUsers();
      setUsers(data);
      if (!payUserId && data.length) {
        setPayUserId(data[0].user_id);
        setPayNetwork(data[0].network || "ERC20");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createUser(e) {
    e.preventDefault();
    setMsg("");
    try {
      const created = await API.createUser(nu);
      setUsers((prev) => [created, ...prev]);
      setNu({ user_id: "", nick: "", email: "", wallet: "", network: "ERC20" });
      setMsg("User created.");
    } catch (e) {
      setMsg(e?.detail || "Failed to create user");
    }
  }

  async function doPay(e) {
    e.preventDefault();
    setMsg("");
    const user = users.find((u) => u.user_id === payUserId);
    if (!user) {
      setMsg("User not found");
      return;
    }
    const amount = Number(payAmount || "0");
    if (!amount || amount <= 0) {
      setMsg("Amount must be > 0");
      return;
    }

    let tx_hash = (payHash || "").trim();
    let status = "success";

    try {
      if (onChain) {
        // Execute real blockchain transfer; will throw if fails
        const out = await payOnChain({
          network: payNetwork,
          wallet: user.wallet,
          amount,
        });
        tx_hash = out.txHash || tx_hash;
        status = out.status || "success";
      }
    } catch (chainErr) {
      console.error(chainErr);
      status = "failed";
      setMsg(chainErr.message || "On-chain transfer failed. Logged as failed.");
    }

    // Always log to backend so your ledger is consistent:
    try {
      const res = await API.pay({
        user_id: user.user_id,
        amount,
        network: payNetwork,
        tx_hash,
        status,
      });
      setMsg(
        status === "success"
          ? `Paid ${fmt(amount)} USDT to ${user.user_id} ${tx_hash ? `(tx ${tx_hash})` : ""}.`
          : `Payment failed on-chain. Logged failure for ${user.user_id}.`
      );
      // refresh totals/txs on the page if you render them
      refresh();
    } catch (logErr) {
      console.error(logErr);
      setMsg(logErr?.detail || "Logged payment failed.");
    }
  }

  // Header UI for wallet connection
  async function handleConnectMetaMask() {
    setMsg("");
    try {
      const addr = await connectMetaMask();
      setMsg(`MetaMask connected: ${addr}`);
    } catch (e) {
      setMsg(e.message || "MetaMask connect failed");
    }
  }
  async function handleConnectTronLink() {
    setMsg("");
    try {
      const addr = await connectTronLink();
      setMsg(`TronLink connected: ${addr}`);
    } catch (e) {
      setMsg(e.message || "TronLink connect failed");
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Referral Payout — Admin</h1>
        <div className="flex gap-2">
          <button
            className="px-3 py-2 rounded bg-neutral-100 hover:bg-neutral-200"
            onClick={handleConnectMetaMask}
            title={walletState.erc20.connected ? walletState.erc20.address : "Connect MetaMask"}
          >
            {walletState.erc20.connected ? "MetaMask ✅" : "Connect MetaMask"}
          </button>
          <button
            className="px-3 py-2 rounded bg-neutral-100 hover:bg-neutral-200"
            onClick={handleConnectTronLink}
            title={walletState.trc20.connected ? walletState.trc20.address : "Connect TronLink"}
          >
            {walletState.trc20.connected ? "TronLink ✅" : "Connect TronLink"}
          </button>
        </div>
      </div>

      {/* Users */}
      <section className="border rounded p-4">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-medium">Users</h2>
          <input
            className="border rounded px-3 py-2 flex-1 max-w-sm"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {loading ? (
          <div className="text-sm text-neutral-500">Loading…</div>
        ) : filtered.length ? (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-3">User ID</th>
                  <th className="py-2 pr-3">Nick</th>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Wallet</th>
                  <th className="py-2 pr-3">Network</th>
                  <th className="py-2 pr-3">Total Paid</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b">
                    <td className="py-2 pr-3">{u.user_id}</td>
                    <td className="py-2 pr-3">{u.nick}</td>
                    <td className="py-2 pr-3">{u.email}</td>
                    <td className="py-2 pr-3">{u.wallet}</td>
                    <td className="py-2 pr-3">{u.network}</td>
                    <td className="py-2 pr-3">{fmt(u.total_paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm text-neutral-500">No users.</div>
        )}
      </section>

      {/* Create user */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-3">Add User</h2>
        <form onSubmit={createUser} className="space-y-3">
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="User ID"
            value={nu.user_id}
            onChange={(e) => setNu({ ...nu, user_id: e.target.value })}
          />
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Nick"
            value={nu.nick}
            onChange={(e) => setNu({ ...nu, nick: e.target.value })}
          />
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Email"
            value={nu.email}
            onChange={(e) => setNu({ ...nu, email: e.target.value })}
          />
          <input
            className="border rounded px-3 py-2 w-full"
            placeholder="Wallet"
            value={nu.wallet}
            onChange={(e) => setNu({ ...nu, wallet: e.target.value })}
          />
          <select
            className="border rounded px-3 py-2 w-full"
            value={nu.network}
            onChange={(e) => setNu({ ...nu, network: e.target.value })}
          >
            <option>ERC20</option>
            <option>TRC20</option>
          </select>
          <button className="px-4 py-2 rounded bg-indigo-600 text-white">Create User</button>
        </form>
      </section>

      {/* Payout */}
      <section className="border rounded p-4">
        <h2 className="text-lg font-medium mb-3">Payout</h2>
        <form onSubmit={doPay} className="grid md:grid-cols-2 gap-3">
          <div className="space-y-3">
            <select
              className="border rounded px-3 py-2 w-full"
              value={payUserId}
              onChange={(e) => {
                const uid = e.target.value;
                setPayUserId(uid);
                const u = users.find((x) => x.user_id === uid);
                if (u) setPayNetwork(u.network || "ERC20");
              }}
            >
              {users.map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.user_id} — {u.nick}
                </option>
              ))}
            </select>

            <select
              className="border rounded px-3 py-2 w-full"
              value={payNetwork}
              onChange={(e) => setPayNetwork(e.target.value)}
            >
              <option>ERC20</option>
              <option>TRC20</option>
            </select>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onChain}
                onChange={(e) => setOnChain(e.target.checked)}
              />
              Send on-chain (MetaMask/TronLink)
            </label>
          </div>

          <div className="space-y-3">
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Amount (USDT)"
              value={payAmount}
              onChange={(e) => setPayAmount(e.target.value)}
              inputMode="decimal"
            />
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Tx Hash (optional)"
              value={payHash}
              onChange={(e) => setPayHash(e.target.value)}
            />
            <button className="px-4 py-2 rounded bg-violet-600 text-white">Send Payout</button>
          </div>
        </form>
      </section>

      {!!msg && (
        <div className="text-sm text-neutral-700">
          {msg}
        </div>
      )}
    </div>
  );
}


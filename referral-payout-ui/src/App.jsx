// src/App.jsx
import { useEffect, useMemo, useState } from "react";
import {
  session, login, logout,
  listPending, listApproved,
  approvePending, denyPending,
  createUser, deleteUser, pay
} from "./lib/api";
import {
  isMetaMaskAvailable, connectMetaMask, onEthereumEvents,
  isTronLinkAvailable, connectTronLink, waitForTronWeb,
  sendPayout,            // unified on-chain payout
  evmRequireChain,       // enforce EVM chain (for ERC20 → mainnet)
} from "./lib/wallets";

const cx = (...a) => a.filter(Boolean).join(" ");

// Hard-coded stablecoin map (USDT) by chain family
const STABLECOIN = {
  ERC20: {
    chain: "evm",
    token: "erc20",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT (Ethereum mainnet)
    decimals: 6,
    chainIdHex: "0x1", // Enforce Ethereum mainnet
  },
  TRC20: {
    chain: "tron",
    token: "trc20",
    address: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", // USDT (TRON mainnet)
    decimals: 6,
  },
};

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
  const [amount, setAmount] = useState("25"); // interpreted as 25 USDT
  const [network, setNetwork] = useState("ERC20"); // fallback if user lookup fails
  const [txHash, setTxHash] = useState("");

  // NEW: Payout-specific search
  const [paySearch, setPaySearch] = useState("");
  const payoutOptions = useMemo(() => {
    const q = paySearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      `${u.user_id} ${u.nick} ${u.email} ${u.wallet}`.toLowerCase().includes(q)
    );
  }, [users, paySearch]);

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

    const onVis = () => {
      if (!document.hidden) {
        setMmAvailable(isMetaMaskAvailable());
        setTlAvailable(!!(window.tronWeb?.defaultAddress?.base58) || isTronLinkAvailable());
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);

    return () => {
      mounted = false;
      off();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
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

  // Pending actions
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

  // ------- Payout (USDT stablecoin on ERC20/TRC20) -------
  async function onSendPayout(e) {
    e.preventDefault();

    const amt = Number(amount);
    if (!payUserId || !amt || amt <= 0) {
      return alert("Enter a valid user and amount.");
    }

    // Look up the selected user for wallet + network truth
    const u = users.find(x => x.user_id === payUserId);
    if (!u) return alert("Selected user not found.");
    if (!u.wallet) return alert("Selected user has no wallet address.");

    const userNetwork = (u.network || network || "ERC20").toUpperCase(); // "ERC20" | "TRC20"
    const cfg = STABLECOIN[userNetwork];
    if (!cfg) return alert(`Unsupported network: ${userNetwork}`);

    let finalTxHash = (txHash || "").trim();

    try {
      // If no tx hash provided, send on-chain USDT
      if (!finalTxHash) {
        // Enforce Ethereum mainnet for ERC20 payouts (recommended)
        if (userNetwork === "ERC20" && cfg.chainIdHex) {
          await evmRequireChain(cfg.chainIdHex);
        }

        finalTxHash = await sendPayout({
          chain: cfg.chain,               // "evm" | "tron"
          token: cfg.token,               // "erc20" | "trc20"
          tokenAddress: cfg.address,      // USDT contract by chain
          decimals: cfg.decimals,         // USDT uses 6
          to: u.wallet,
          amount: String(amt),            // e.g., "5" USDT
        });
      }

      const res = await pay({
        user_id: u.user_id,
        amount: amt,
        network: userNetwork,     // "ERC20" | "TRC20"
        tx_hash: finalTxHash || undefined,
        status: "success"
      });

      alert(`Paid ${amt} USDT to ${u.user_id}\nTx: ${finalTxHash || `(logged #${res?.tx_id ?? "?"})`}`);

      // Refresh totals
      const a = await listApproved();
      setUsers(a || []);
      setTxHash("");
    } catch (err) {
      console.error(err);
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
      setMmAvailable(true);
    } catch (e) {
      setWalletError(e.message || "MetaMask connect failed");
      setMmAvailable(isMetaMaskAvailable()); // re-evaluate
    }
  }

  async function handleConnectTronLink() {
    setWalletError("");
    try {
      await waitForTronWeb(3000);
      const { account } = await connectTronLink();
      setTronAccount(account || "");
      setTlAvailable(true);
    } catch (e) {
      setWalletError(e.message || "TronLink connect failed");
      setTlAvailable(!!(window.tronWeb?.defaultAddress?.base58) || isTronLinkAvailable());
    }
  }

  // Users table filter (existing)
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
          {/* NEW: search users by name/email/id/wallet for the payout dropdown */}
          <input
            className="border rounded p-2"
            placeholder="Search user…"
            value={paySearch}
            onChange={(e) => setPaySearch(e.target.value)}
            aria-label="Search payout user"
          />

          {/* Filtered select driven by paySearch */}
          <select
            className="border rounded p-2"
            value={payUserId}
            onChange={e => setPayUserId(e.target.value)}
          >
            {payoutOptions.map(u => (
              <option key={u.user_id} value={u.user_id}>
                {u.user_id} — {u.nick || u.email || (u.wallet ? `${u.wallet.slice(0,6)}…${u.wallet.slice(-4)}` : "")}
              </option>
            ))}
            {payoutOptions.length === 0 && (
              <option value="" disabled>No matches</option>
            )}
          </select>

          <input
            className="border rounded p-2"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Amount (USDT)"
          />

          {/* Manual network selector as fallback; actual send uses the user's saved network */}
          <select className="border rounded p-2" value={network} onChange={e => setNetwork(e.target.value)}>
            <option>ERC20</option>
            <option>TRC20</option>
          </select>

          <input
            className="border rounded p-2 md:col-span-3"
            placeholder="Tx Hash (optional)"
            value={txHash}
            onChange={e => setTxHash(e.target.value)}
          />

          <div className="md:col-span-4">
            <button className="w-full py-3 rounded bg-purple-600 text-white cursor-pointer hover:bg-purple-700">
              Send Payout
            </button>
          </div>
        </form>

        <p className="text-xs text-gray-500 mt-2">
          Stablecoin mode: sends <strong>USDT</strong> on the user’s network (ERC20 → Ethereum mainnet, TRC20 → TRON mainnet).<br />
          Tip: <strong>Install, unlock, and pin MetaMask/TronLink</strong> so the top-right connect buttons detect them instantly.
          Leave “Tx Hash” blank to send via the connected wallet. Provide a Tx Hash to skip sending and only log the payout.
        </p>
      </section>
    </div>
  );
}


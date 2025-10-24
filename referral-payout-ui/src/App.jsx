import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api";

const Card = ({ title, right, children }) => (
  <section className="max-w-6xl mx-auto bg-white border rounded-2xl p-6 my-6 shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {right}
    </div>
    {children}
  </section>
);
const Btn = ({ children, ...p }) => (
  <button className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60" {...p}>
    {children}
  </button>
);
const Input = (props) => (
  <input
    {...props}
    className={"w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 " + (props.className || "")}
  />
);
const Select = (props) => (
  <select {...props} className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
);

export default function App() {
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("admin123");
  const [loginErr, setLoginErr] = useState("");

  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [uForm, setUForm] = useState({ user_id: "", nick: "", email: "", wallet: "", network: "ERC20" });
  const [uMsg, setUMsg] = useState("");

  const [amount, setAmount] = useState("25");
  const [txHash, setTxHash] = useState("");
  const [net, setNet] = useState("ERC20");
  const [selected, setSelected] = useState("");
  const [payMsg, setPayMsg] = useState("");
  const [txList, setTxList] = useState([]);

  const amtRef = useRef(null);
  const selectedUser = useMemo(() => users.find((u) => u.user_id === selected), [selected, users]);

  async function loadUsers() {
    try {
      const list = await api.users(q, statusFilter || undefined);
      setUsers(list);
      if (list.length && !selected) setSelected(list[0].user_id);
    } catch (e) {}
  }

  useEffect(() => { if (authed) loadUsers(); }, [authed, q, statusFilter]);

  function handleAmountChange(e) {
    const v = e.target.value;
    if (/^[0-9]*\.?[0-9]*$/.test(v) || v === "") setAmount(v);
  }

  async function handleLogin(e) {
    e.preventDefault(); setLoginErr("");
    try { await api.login(email.trim(), password.trim()); setAuthed(true); }
    catch (err) { setLoginErr(err.message || "Login failed"); }
  }

  async function handleLogout() {
    try { await api.logout(); } catch {}
    setAuthed(false); setUsers([]); setTxList([]);
  }

  async function createUser(e) {
    e.preventDefault(); setUMsg("");
    try {
      const payload = {
        user_id: uForm.user_id.trim(),
        nick: uForm.nick.trim(),
        email: uForm.email.trim(),
        wallet: uForm.wallet.trim(),
        network: uForm.network,
      };
      await api.createUser(payload);
      setUMsg("User created (approved).");
      setUForm({ user_id: "", nick: "", email: "", wallet: "", network: "ERC20" });
      await loadUsers();
    } catch (err) { setUMsg(err.message || "Failed to create user"); }
  }

  async function removeUser(u) {
    if (!window.confirm(`Delete ${u.user_id}?`)) return;
    try { await api.delUser(u.user_id); await loadUsers(); if (selected === u.user_id) { setSelected(""); setTxList([]); } }
    catch (err) { alert(err.message || "Failed to delete"); }
  }

  async function setStatus(u, status) {
    try {
      await api.updateUserStatus(u.user_id, status);
      await loadUsers();
    } catch (err) {
      alert(err.message || "Failed to update status");
    }
  }

  async function doPay(e) {
    e.preventDefault(); setPayMsg("");
    if (!selectedUser) { setPayMsg("Pick a user first."); return; }
    if (selectedUser.status !== "approved") { setPayMsg("User must be approved before payout."); return; }
    const amt = Number.parseFloat((amount || "").trim());
    if (Number.isNaN(amt) || amt <= 0) { setPayMsg("Enter a valid amount."); amtRef.current?.focus(); return; }
    try {
      const res = await api.pay({
        user_id: selectedUser.user_id,
        amount: amt,
        network: net,
        tx_hash: txHash.trim(),
        status: "success",
      });
      setPayMsg(`Paid ${amt} USDT to ${selectedUser.user_id} (tx #${res.tx_id}).`);
      const txs = await api.txByUser(selectedUser.user_id);
      setTxList(txs); setTxHash("");
    } catch (err) { setPayMsg(err.message || "Payout failed"); }
  }

  async function loadTxsFor(u) {
    if (!u) return setTxList([]);
    try { const txs = await api.txByUser(u.user_id); setTxList(txs); } catch { setTxList([]); }
  }
  useEffect(() => { if (selectedUser) loadTxsFor(selectedUser); }, [selected]); // eslint-disable-line

  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <Card title="Login">
          <form onSubmit={handleLogin} className="max-w-lg space-y-4">
            <div><label className="block text-sm font-medium mb-1">Admin Email</label><Input value={email} onChange={(e)=>setEmail(e.target.value)} /></div>
            <div><label className="block text-sm font-medium mb-1">Password</label><Input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} /></div>
            {loginErr && <p className="text-red-600 mt-2">{loginErr}</p>}
            <Btn type="submit">Sign In</Btn>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="max-w-6xl mx-auto flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Referral Payout — Admin</h1>
        <Btn onClick={handleLogout}>Logout</Btn>
      </div>

      <Card
        title="Users"
        right={
          <div className="flex gap-2">
            <Input placeholder="Search..." value={q} onChange={(e)=>setQ(e.target.value)} />
            <Select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </Select>
            <Btn onClick={loadUsers}>Filter</Btn>
          </div>
        }
      >
        {!users.length ? (
          <p>No users found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border rounded-xl overflow-hidden">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-left px-3 py-2">ID</th>
                  <th className="text-left px-3 py-2">Nick</th>
                  <th className="text-left px-3 py-2">Email</th>
                  <th className="text-left px-3 py-2">Wallet</th>
                  <th className="text-left px-3 py-2">Network</th>
                  <th className="text-left px-3 py-2">Total Paid</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="px-3 py-2">{u.user_id}</td>
                    <td className="px-3 py-2">{u.nick}</td>
                    <td className="px-3 py-2">{u.email}</td>
                    <td className="px-3 py-2">{u.wallet}</td>
                    <td className="px-3 py-2">{u.network}</td>
                    <td className="px-3 py-2">{u.total_paid ?? 0}</td>
                    <td className="px-3 py-2">
                      <span className={
                        "px-2 py-1 rounded text-sm " +
                        (u.status === "approved" ? "bg-green-100 text-green-700" :
                         u.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                         "bg-red-100 text-red-700")
                      }>
                        {u.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 flex flex-wrap gap-2">
                      <Btn onClick={() => setSelected(u.user_id)}>Select</Btn>
                      {u.status !== "approved" && <button className="px-3 py-2 rounded-lg border hover:bg-green-50" onClick={() => setStatus(u, "approved")}>Approve</button>}
                      {u.status !== "denied" && <button className="px-3 py-2 rounded-lg border hover:bg-red-50" onClick={() => setStatus(u, "denied")}>Deny</button>}
                      <button className="px-3 py-2 rounded-lg border text-red-600 hover:bg-red-50" onClick={() => removeUser(u)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Add User (Approved)">
        <form onSubmit={createUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium mb-1">User ID</label><Input value={uForm.user_id} onChange={(e)=>setUForm({...uForm, user_id:e.target.value})} /></div>
          <div><label className="block text-sm font-medium mb-1">Nick</label><Input value={uForm.nick} onChange={(e)=>setUForm({...uForm, nick:e.target.value})} /></div>
          <div><label className="block text-sm font-medium mb-1">Email</label><Input value={uForm.email} onChange={(e)=>setUForm({...uForm, email:e.target.value})} /></div>
          <div><label className="block text-sm font-medium mb-1">Wallet</label><Input value={uForm.wallet} onChange={(e)=>setUForm({...uForm, wallet:e.target.value})} /></div>
          <div><label className="block text-sm font-medium mb-1">Network</label>
            <Select value={uForm.network} onChange={(e)=>setUForm({...uForm, network:e.target.value})}>
              <option value="ERC20">ERC20</option>
              <option value="TRC20">TRC20</option>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Btn type="submit">Create</Btn>
            {uMsg && <span className="ml-3 text-sm">{uMsg}</span>}
          </div>
        </form>
      </Card>

      <Card title="Payout">
        <form onSubmit={doPay} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium mb-1">User</label>
            <Select value={selected} onChange={(e)=>setSelected(e.target.value)}>
              {users.map((u)=>(
                <option key={u.user_id} value={u.user_id}>{u.user_id} — {u.nick} ({u.status})</option>
              ))}
            </Select>
          </div>
          <div><label className="block text-sm font-medium mb-1">Amount (USDT)</label>
            <Input ref={amtRef} value={amount} onChange={handleAmountChange} inputMode="decimal" />
          </div>
          <div><label className="block text-sm font-medium mb-1">Network</label>
            <Select value={net} onChange={(e)=>setNet(e.target.value)}><option value="ERC20">ERC20</option><option value="TRC20">TRC20</option></Select>
          </div>
          <div><label className="block text-sm font-medium mb-1">Tx Hash (optional)</label>
            <Input value={txHash} onChange={(e)=>setTxHash(e.target.value)} placeholder="0x…" />
          </div>
          <div className="md:col-span-2">
            <Btn type="submit">Send Payout</Btn>
            {payMsg && <span className="ml-3 text-green-700">{payMsg}</span>}
          </div>
        </form>
      </Card>

      <Card title="Transactions">
        {!selectedUser ? (
          <p>Select a user to view transactions.</p>
        ) : !txList.length ? (
          <p>No transactions yet for {selectedUser.user_id}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border rounded-xl overflow-hidden">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-left px-3 py-2">ID</th>
                  <th className="text-left px-3 py-2">Amount</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Tx Hash</th>
                  <th className="text-left px-3 py-2">Network</th>
                  <th className="text-left px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {txList.map((t)=>(
                  <tr key={t.id} className="border-t">
                    <td className="px-3 py-2">{t.id}</td>
                    <td className="px-3 py-2">{t.amount}</td>
                    <td className="px-3 py-2">{t.status}</td>
                    <td className="px-3 py-2">{t.tx_hash}</td>
                    <td className="px-3 py-2">{t.network}</td>
                    <td className="px-3 py-2">{new Date(t.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}


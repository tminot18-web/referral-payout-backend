// src/lib/wallets.js

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
const toHex = (n) => "0x" + BigInt(n).toString(16);

// Convert decimal string (e.g., "0.05") to wei (as a decimal string)
const toWei = (eth) => {
  const [whole, frac = ""] = String(eth).trim().split(".");
  const weiWhole = BigInt(whole || "0") * 10n ** 18n;
  const weiFrac = BigInt((frac + "0".repeat(18)).slice(0, 18));
  return (weiWhole + weiFrac).toString();
};

// Generic units converter for token decimals
const toUnits = (amt, decimals) => {
  const [w, f = ""] = String(amt).trim().split(".");
  const base = 10n ** BigInt(decimals);
  const wN = BigInt(w || "0") * base;
  const fN = BigInt((f + "0".repeat(decimals)).slice(0, decimals));
  return (wN + fN).toString();
};

// Minimal ERC-20 transfer data payload: transfer(address,uint256) -> 0xa9059cbb
const erc20TransferData = (to, amountUnits) => {
  const selector = "0xa9059cbb";
  const addr = String(to).toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const val = BigInt(amountUnits).toString(16).padStart(64, "0");
  return selector + addr + val;
};

// Simple validators
function isHexAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr || "");
}
function isBase58Tron(addr) {
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr || "");
}

// ─────────────────────────────────────────────────────────────────────────────
// MetaMask (EVM)
// ─────────────────────────────────────────────────────────────────────────────
export function isMetaMaskAvailable() {
  return !!(window.ethereum && (window.ethereum.isMetaMask || window.ethereum.isBraveWallet === false));
}

export async function connectMetaMask() {
  if (!isMetaMaskAvailable()) throw new Error("MetaMask not found");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  return { account: accounts?.[0] || null, chainId };
}

// Subscribe to account/chain changes; returns an unsubscribe function
export function onEthereumEvents({ onAccountsChanged, onChainChanged } = {}) {
  const eth = window.ethereum;
  if (!eth) return () => {};
  const accHandler = (accs) => onAccountsChanged?.(accs?.[0] || null);
  const chainHandler = (cid) => onChainChanged?.(cid);
  eth.on?.("accountsChanged", accHandler);
  eth.on?.("chainChanged", chainHandler);
  return () => {
    eth.removeListener?.("accountsChanged", accHandler);
    eth.removeListener?.("chainChanged", chainHandler);
  };
}

export async function evmEnsure() {
  if (!isMetaMaskAvailable()) throw new Error("MetaMask not available");
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) throw new Error("No MetaMask account");
  return { account: accounts[0] };
}

async function evmSelectedAccount() {
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  const from = accounts?.[0];
  if (!from) throw new Error("No MetaMask account selected");
  return from;
}

export async function evmChainId() {
  return await window.ethereum.request({ method: "eth_chainId" }); // e.g. '0x1'
}

export async function evmSendNative(to, amountEth) {
  await evmEnsure();
  if (!isHexAddress(to)) throw new Error("Invalid EVM recipient address");
  const valueWei = toWei(amountEth);
  let txHash;
  try {
    txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ to, value: toHex(BigInt(valueWei)) }],
    });
  } catch (e) {
    if (e?.code === 4001) throw new Error("Transaction rejected in MetaMask");
    throw e;
  }
  if (typeof txHash !== "string") throw new Error("EVM native send failed");
  return txHash;
}

export async function evmSendERC20(tokenAddress, to, amount, decimals = 18) {
  await evmEnsure();
  const from = await evmSelectedAccount();
  if (!isHexAddress(tokenAddress)) throw new Error("Invalid token contract address");
  if (!isHexAddress(to)) throw new Error("Invalid recipient address");
  const data = erc20TransferData(to, toUnits(amount, decimals));
  let txHash;
  try {
    txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from, to: tokenAddress, value: "0x0", data }],
    });
  } catch (e) {
    if (e?.code === 4001) throw new Error("Transaction rejected in MetaMask");
    throw e;
  }
  if (typeof txHash !== "string") throw new Error("EVM ERC-20 send failed");
  return txHash;
}

// Optional helper if you want to enforce network before sending
export async function evmRequireChain(chainIdHex) {
  const have = await evmChainId();
  if (have === chainIdHex) return true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
    return true;
  } catch (e) {
    // If the chain is not added, you could call wallet_addEthereumChain here.
    throw new Error("Please switch MetaMask to the required network");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TronLink (TRON)
// ─────────────────────────────────────────────────────────────────────────────
export function isTronLinkAvailable() {
  return !!(window.tronLink || window.tronWeb);
}

export async function connectTronLink() {
  // Newer TronLink exposes tronLink.request; older injects tronWeb directly
  if (window.tronLink?.request) {
    try {
      await window.tronLink.request({ method: "tron_requestAccounts" });
    } catch {
      // user may reject; we'll check defaultAddress below
    }
  }
  const addr = window.tronWeb?.defaultAddress?.base58 || null;
  if (!addr) throw new Error("TronLink not ready");
  return { account: addr };
}

// Poll for tronWeb readiness if needed (TronLink sometimes injects late)
export async function waitForTronWeb(timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.tronWeb?.defaultAddress?.base58) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function tronEnsure() {
  if (!isTronLinkAvailable()) throw new Error("TronLink not available");
  if (!window.tronWeb?.defaultAddress?.base58) {
    await window.tronLink?.request?.({ method: "tron_requestAccounts" });
  }
  const addr = window.tronWeb?.defaultAddress?.base58;
  if (!addr) throw new Error("TronLink not authorized");
  return { account: addr };
}

export async function tronSendNative(to, amountTrx) {
  await tronEnsure();
  if (!isBase58Tron(to)) throw new Error("Invalid Tron recipient address");
  const sun = window.tronWeb.toSun(String(amountTrx)); // exact conversion, no FP rounding
  let res;
  try {
    res = await window.tronWeb.trx.sendTransaction(to, sun);
  } catch (e) {
    throw new Error(e?.message || "TRX send failed");
  }
  if (!res?.txid) throw new Error("TRX send failed");
  return res.txid;
}

export async function tronSendTRC20(tokenAddress, to, amount, decimals = 6) {
  await tronEnsure();
  if (!isBase58Tron(to)) throw new Error("Invalid Tron recipient address");
  const contract = await window.tronWeb.contract().at(tokenAddress);
  const units = toUnits(amount, decimals);
  const toHexAddr = window.tronWeb.address.toHex(to); // TRON contracts prefer hex
  let txid;
  try {
    txid = await contract.transfer(toHexAddr, units).send({ feeLimit: 100_000_000 }); // 100 TRX
  } catch (e) {
    throw new Error(e?.message || "TRC-20 send failed");
  }
  if (typeof txid !== "string") throw new Error("TRC-20 send failed");
  return txid;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified payout entry
// ─────────────────────────────────────────────────────────────────────────────
// config = { chain: 'evm'|'tron', token: 'native'|'erc20'|'trc20', tokenAddress?, decimals?, to, amount }
export async function sendPayout(config) {
  const { chain, token = "native", tokenAddress, decimals = 6, to, amount } = config || {};
  if (!to) throw new Error("Missing recipient");
  if (!amount || Number(amount) <= 0) throw new Error("Amount must be > 0");

  if (chain === "evm") {
    if (token === "native") return await evmSendNative(to, amount);
    if (token === "erc20") {
      if (!tokenAddress) throw new Error("Missing ERC-20 token address");
      return await evmSendERC20(tokenAddress, to, amount, decimals);
    }
    throw new Error("Unknown EVM token type");
  }

  if (chain === "tron") {
    if (token === "native") return await tronSendNative(to, amount);
    if (token === "trc20") {
      if (!tokenAddress) throw new Error("Missing TRC-20 token address");
      return await tronSendTRC20(tokenAddress, to, amount, decimals);
    }
    throw new Error("Unknown TRON token type");
  }

  throw new Error("Unknown chain");
}


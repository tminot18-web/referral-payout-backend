// src/lib/wallets.js

// ---------- MetaMask (EVM) ----------
export function isMetaMaskAvailable() {
  return !!(window.ethereum && window.ethereum.isMetaMask);
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

// ---------- TronLink (TRON) ----------
export function isTronLinkAvailable() {
  return !!(window.tronLink || window.tronWeb);
}

export async function connectTronLink() {
  // Newer TronLink exposes tronLink.request; older injects tronWeb directly
  if (window.tronLink?.request) {
    try {
      await window.tronLink.request({ method: "tron_requestAccounts" });
    } catch (e) {
      // user rejected
    }
  }
  const addr = window.tronWeb?.defaultAddress?.base58 || null;
  if (!addr) throw new Error("TronLink not ready");
  return { account: addr };
}

// poll for tronWeb readiness if needed (TronLink sometimes injects late)
export async function waitForTronWeb(timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (window.tronWeb?.defaultAddress?.base58) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}


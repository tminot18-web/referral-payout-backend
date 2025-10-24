// src/lib/wallet.js

export async function connectMetaMask() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("MetaMask not found. Please install the wallet extension.");
  }
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  if (!accounts || !accounts.length) throw new Error("No account authorized.");
  return { address: accounts[0], chainId: await window.ethereum.request({ method: "eth_chainId" }) };
}

export async function connectTronLink() {
  if (typeof window === "undefined") {
    throw new Error("TronLink not available on this page.");
  }

  // Modern TronLink
  if (window.tronLink && window.tronLink.request) {
    try {
      await window.tronLink.request({ method: "tron_requestAccounts" });
    } catch (e) {
      // user rejected or wallet locked
      throw new Error(e?.message || "TronLink connection rejected.");
    }
  }

  // TronWeb injected after TronLink connects
  if (window.tronWeb && window.tronWeb.ready) {
    const addr = window.tronWeb.defaultAddress?.base58 || "Unknown";
    return { address: addr };
  }

  throw new Error("TronLink not detected or not ready. Open the TronLink extension and try again.");
}


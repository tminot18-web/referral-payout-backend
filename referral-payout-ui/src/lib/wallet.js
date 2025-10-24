// src/lib/wallet.js
import { ethers } from "ethers";

// Minimal ERC20 ABI: transfer(address,uint256)
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) public returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const USDT_ERC20 = import.meta.env.VITE_USDT_ERC20 || "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDT_TRC20 = import.meta.env.VITE_USDT_TRC20 || "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const ETH_CHAIN_ID = import.meta.env.VITE_ETH_CHAIN_ID || "0x1"; // Mainnet by default

export const walletState = {
  erc20: { connected: false, address: "" },
  trc20: { connected: false, address: "" },
};

export async function connectMetaMask() {
  if (!window.ethereum) throw new Error("MetaMask not found");
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId !== ETH_CHAIN_ID) {
    // prompt a network switch; if it fails we still continue (some wallets reject)
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: ETH_CHAIN_ID }],
      });
    } catch {}
  }
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  walletState.erc20.connected = true;
  walletState.erc20.address = accounts[0];
  return walletState.erc20.address;
}

export async function connectTronLink() {
  // TronLink injects window.tronLink or window.tronWeb
  if (!window.tronLink && !window.tronWeb) {
    throw new Error("TronLink not found");
  }
  // Ask for account access if using tronLink
  if (window.tronLink && window.tronLink.request) {
    try {
      await window.tronLink.request({ method: "tron_requestAccounts" });
    } catch {}
  }
  const tw = window.tronWeb;
  if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) {
    throw new Error("TronWeb not ready—open TronLink and unlock");
  }
  walletState.trc20.connected = true;
  walletState.trc20.address = tw.defaultAddress.base58;
  return walletState.trc20.address;
}

/**
 * Send USDT on Ethereum (ERC20) from MetaMask.
 * @param {string} to - recipient address (0x...)
 * @param {number} amount - human amount in USDT (e.g., 25)
 * @returns {string} txHash
 */
export async function sendUsdtErc20(to, amount) {
  if (!window.ethereum) throw new Error("MetaMask not available");
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const token = new ethers.Contract(USDT_ERC20, ERC20_ABI, signer);

  // USDT has 6 decimals
  const value = ethers.parseUnits(String(amount), 6);
  const tx = await token.transfer(to, value);
  const rec = await tx.wait();
  return tx.hash ?? rec?.hash;
}

/**
 * Send USDT on Tron (TRC20) from TronLink.
 * @param {string} to - recipient base58 address (e.g., T... address)
 * @param {number} amount - human amount in USDT (e.g., 25)
 * @returns {string} txId
 */
export async function sendUsdtTrc20(to, amount) {
  const tw = window.tronWeb;
  if (!tw || !tw.contract) throw new Error("TronWeb not available");

  const contract = await tw.contract().at(USDT_TRC20);

  // TRC20 uses integer amount with token decimals (USDT = 6)
  const raw = String(Math.round(Number(amount) * 1e6)); // as string to avoid JS precision issues
  const result = await contract.transfer(to, raw).send({
    feeLimit: 20_000_000, // in Sun (TRX), adjust if needed
  });

  // TronWeb returns txId or boolean; often `result` is txId string
  return typeof result === "string" ? result : tw?.trx?.lastTransaction?.txID;
}

/**
 * High-level helper used by the Admin UI.
 * Chooses ERC20 vs TRC20 based on `network` and returns { txHash, status }
 */
export async function payOnChain({ network, wallet, amount }) {
  // network: "ERC20" | "TRC20"
  if (network === "ERC20") {
    if (!walletState.erc20.connected) await connectMetaMask();
    const txHash = await sendUsdtErc20(wallet, amount);
    return { txHash, status: "success" };
  }
  if (network === "TRC20") {
    if (!walletState.trc20.connected) await connectTronLink();
    const txHash = await sendUsdtTrc20(wallet, amount);
    return { txHash, status: "success" };
  }
  throw new Error(`Unsupported network: ${network}`);
}


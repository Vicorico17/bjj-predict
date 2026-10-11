import bs58 from "bs58";
import nacl from "tweetnacl";

const STORAGE_KEY = "bjj-predict-ows-wallet-v1";

export type LinkedOwsWallet = {
  address: string;
  linkedAt: string;
};

export function loadLinkedOwsWallet(): LinkedOwsWallet | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as Partial<LinkedOwsWallet> | null;
    if (value && typeof value.address === "string" && typeof value.linkedAt === "string" &&
      isSolanaAddress(value.address)) return value as LinkedOwsWallet;
  } catch {
    // The wallet link is optional; unavailable storage should not block the app.
  }
  return null;
}

export function saveLinkedOwsWallet(wallet: LinkedOwsWallet | null) {
  try {
    if (wallet) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
    else window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function createOwsChallenge() {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
  return `BJJ Predict wallet link | origin=${window.location.origin} | nonce=${nonce}`;
}

function isSolanaAddress(address: string) {
  try {
    return bs58.decode(address).length === 32;
  } catch {
    return false;
  }
}

function decodeSignature(input: string) {
  const value = input.trim();
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{128}$/.test(hex)) {
    return Uint8Array.from(hex.match(/.{2}/g)!, part => Number.parseInt(part, 16));
  }
  return bs58.decode(value);
}

export function verifyOwsSolanaSignature(address: string, signature: string, challenge: string) {
  try {
    const publicKey = bs58.decode(address.trim());
    const signedBytes = decodeSignature(signature);
    return publicKey.length === 32 && signedBytes.length === 64 &&
      nacl.sign.detached.verify(new TextEncoder().encode(challenge), signedBytes, publicKey);
  } catch {
    return false;
  }
}

export function owsSignCommand(walletName: string, challenge: string) {
  const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
  return `ows sign message --chain solana --wallet ${shellQuote(walletName)} --message ${shellQuote(challenge)}`;
}

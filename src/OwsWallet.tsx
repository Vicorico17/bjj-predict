import { useState, type FormEvent } from "react";
import { Check, Copy, Link2, Unplug } from "lucide-react";
import {
  createOwsChallenge,
  loadLinkedOwsWallet,
  owsSignCommand,
  saveLinkedOwsWallet,
  verifyOwsSolanaSignature,
  type LinkedOwsWallet
} from "./ows";

export function OwsWallet() {
  const [linked, setLinked] = useState<LinkedOwsWallet | null>(loadLinkedOwsWallet);
  const [expanded, setExpanded] = useState(false);
  const [walletName, setWalletName] = useState("bjj-predict");
  const [address, setAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [challenge, setChallenge] = useState(createOwsChallenge);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);

  function linkWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedAddress = address.trim();
    if (!verifyOwsSolanaSignature(normalizedAddress, signature, challenge)) {
      setNotice("That signature does not match the Solana address and message. Check the wallet name, address, and pasted signature.");
      return;
    }
    const next = { address: normalizedAddress, linkedAt: new Date().toISOString() };
    setLinked(next);
    setExpanded(false);
    setSignature("");
    setNotice(saveLinkedOwsWallet(next) ? "OWS wallet linked to this browser's points account." : "Wallet linked for this session. Browser storage is unavailable, so the link may not survive a reload.");
  }

  function unlinkWallet() {
    saveLinkedOwsWallet(null);
    setLinked(null);
    setAddress("");
    setSignature("");
    setChallenge(createOwsChallenge());
    setNotice("OWS wallet unlinked from this browser.");
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(owsSignCommand(walletName.trim(), challenge));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice("Clipboard unavailable. Select and copy the command below.");
    }
  }

  return (
    <section className="ows-wallet-card" aria-label="Open Wallet Standard wallet">
      <div className="ows-wallet-heading">
        <div><span>Solana wallet</span><strong>{linked ? `${linked.address.slice(0, 6)}…${linked.address.slice(-6)}` : "No wallet linked"}</strong></div>
        {linked ? <button className="ows-wallet-icon-button" type="button" title="Unlink OWS wallet" aria-label="Unlink OWS wallet" onClick={unlinkWallet}><Unplug size={16} /></button> :
          <button className="ows-wallet-link-button" type="button" onClick={() => { setExpanded(value => !value); setNotice(""); }}><Link2 size={14} />Link OWS</button>}
      </div>
      {linked && <p>OWS address linked locally. Predictions still use demo points.</p>}
      {notice && <p className="ows-wallet-notice" role="status">{notice}</p>}
      {!linked && expanded && <form className="ows-wallet-form" onSubmit={linkWallet}>
        <p>Use your local OWS wallet to sign this message. No funds move.</p>
        <label>OWS wallet name<input value={walletName} onChange={event => setWalletName(event.target.value)} required /></label>
        <label>Solana address<input value={address} onChange={event => setAddress(event.target.value)} placeholder="Paste the Solana address from ows wallet list" required autoComplete="off" /></label>
        <span className="ows-wallet-step">Run <code>ows wallet list</code> in your terminal, then sign with the command below. If you need a wallet, run <code>ows wallet create --name bjj-predict</code> locally first.</span>
        <div className="ows-wallet-command"><code>{owsSignCommand(walletName.trim(), challenge)}</code><button type="button" onClick={copyCommand} aria-label="Copy OWS sign command" title="Copy command">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
        <label>Signature<input value={signature} onChange={event => setSignature(event.target.value)} placeholder="Paste the signature printed by OWS" required autoComplete="off" /></label>
        <button className="ows-wallet-submit" type="submit">Verify and link wallet</button>
      </form>}
    </section>
  );
}

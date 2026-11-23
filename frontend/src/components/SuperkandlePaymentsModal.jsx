import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
}

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function shortHash(value) {
  if (!value) return "—";
  const hash = String(value);
  if (hash.length < 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function statusLabel(value) {
  if (!value) return "Unknown";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SuperkandlePaymentsModal({ onClose, onChanged }) {
  const { notify } = useFeedback();
  const [payments, setPayments] = useState([]);
  const [stats, setStats] = useState({
    pending: 0,
    confirmed: 0,
    cancelled: 0,
    confirmed_amount: 0,
  });
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hashes, setHashes] = useState({});
  const [verifyingId, setVerifyingId] = useState(null);
  const [copiedTx, setCopiedTx] = useState("");
  const [tab, setTab] = useState("checkouts");
  const [chainHours, setChainHours] = useState("12");
  const [chain, setChain] = useState({
    wallet: "",
    transfers: [],
    fromBlock: null,
    toBlock: null,
  });
  const [chainLoading, setChainLoading] = useState(false);

  async function load(query = search, payStatus = status) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (payStatus !== "all") params.set("status", payStatus);
      const data = await api(
        `/api/superkandle/payments${
          params.toString() ? `?${params.toString()}` : ""
        }`
      );
      setPayments(data.payments || []);
      setStats(data.stats || stats);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const delay = search.trim() ? 280 : 0;
    const timer = setTimeout(() => load(search, status), delay);
    return () => clearTimeout(timer);
  }, [search, status]);

  async function loadChain(hours = chainHours) {
    setChainLoading(true);
    setError("");
    try {
      const data = await api(
        `/api/superkandle/payments/onchain?hours=${encodeURIComponent(hours)}`
      );
      setChain({
        wallet: data.wallet || "",
        transfers: data.transfers || [],
        fromBlock: data.fromBlock,
        toBlock: data.toBlock,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setChainLoading(false);
    }
  }

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    if (tab !== "chain") return undefined;
    loadChain(chainHours);
    return undefined;
  }, [tab, chainHours]);

  async function copyHash(hash) {
    try {
      await navigator.clipboard.writeText(hash);
      setCopiedTx(hash);
      setTimeout(() => setCopiedTx(""), 1200);
    } catch {
      setError("Could not copy hash");
    }
  }

  async function verify(row) {
    const txHash = String(hashes[row.id] || row.tx_hash || "").trim();
    if (!txHash) {
      setError("Paste the BEP20 transaction hash first.");
      return;
    }
    setVerifyingId(row.id);
    setError("");
    try {
      const data = await api(`/api/superkandle/payments/${row.id}/verify`, {
        method: "POST",
        body: JSON.stringify({ txHash }),
      });
      notify({
        title: data.alreadyConfirmed ? "Already confirmed" : "Payment verified",
        message:
          data.message ||
          "On-chain USDT was checked and membership was updated.",
      });
      setHashes((current) => ({ ...current, [row.id]: "" }));
      await load(search, status);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifyingId(null);
    }
  }

  const unmatched = chain.transfers.filter((row) => !row.checkout).length;

  const modal = (
    <div
      className="sk-plans-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sk-pay-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sk-pay-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sk-pay-head">
          <div>
            <p className="sk-pay-kicker">SuperKandle</p>
            <h2 id="sk-pay-title">USDT payments</h2>
            <p className="sk-pay-sub">
              BNB Smart Chain · BEP-20 · academy wallet
            </p>
          </div>
          <button
            type="button"
            className="sk-pay-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>

        <nav className="sk-pay-tabs" role="tablist" aria-label="Payment source">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "checkouts"}
            className={tab === "checkouts" ? "is-on" : ""}
            onClick={() => setTab("checkouts")}
          >
            Checkouts
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "chain"}
            className={tab === "chain" ? "is-on" : ""}
            onClick={() => setTab("chain")}
          >
            On-chain
          </button>
        </nav>

        {tab === "checkouts" ? (
          <div className="sk-pay-kpis">
            <article>
              <span>Pending</span>
              <strong>{stats.pending}</strong>
            </article>
            <article>
              <span>Confirmed</span>
              <strong>{stats.confirmed}</strong>
            </article>
            <article>
              <span>Cancelled</span>
              <strong>{stats.cancelled}</strong>
            </article>
            <article>
              <span>Confirmed volume</span>
              <strong>{money(stats.confirmed_amount)}</strong>
            </article>
          </div>
        ) : (
          <div className="sk-pay-kpis">
            <article>
              <span>Incoming</span>
              <strong>{chain.transfers.length}</strong>
            </article>
            <article>
              <span>Unmatched</span>
              <strong>{unmatched}</strong>
            </article>
            <article className="sk-pay-kpis__wide">
              <span>Receiving wallet</span>
              <strong title={chain.wallet}>
                {chain.wallet ? shortHash(chain.wallet) : "—"}
              </strong>
            </article>
          </div>
        )}

        {error ? <p className="sk-pay-error">{error}</p> : null}

        <div className="sk-pay-body">
          {tab === "checkouts" ? (
            <>
              <div className="sk-pay-bar">
                <label className="sk-pay-search">
                  <Search size={15} strokeWidth={2} aria-hidden="true" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, email, plan, or hash"
                  />
                </label>
                <select
                  aria-label="Status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
                <button
                  type="button"
                  className="sk-pay-ghost"
                  onClick={() => load(search, status)}
                  disabled={loading}
                >
                  <RefreshCw size={14} strokeWidth={2} />
                  Refresh
                </button>
              </div>

              <div className="sk-pay-ledger">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Plan</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Transaction</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="sk-pay-empty">
                          Loading checkout records…
                        </td>
                      </tr>
                    ) : payments.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="sk-pay-empty">
                          No checkout records in this view.
                        </td>
                      </tr>
                    ) : (
                      payments.map((row) => {
                        const canVerify = row.status !== "confirmed";
                        return (
                          <tr key={row.id}>
                            <td>
                              <div className="sk-pay-person">
                                <strong>
                                  {fullName(row.first_name, row.last_name)}
                                </strong>
                                <span>{row.email || "—"}</span>
                              </div>
                            </td>
                            <td>{row.plan_name || "—"}</td>
                            <td className="sk-pay-amt">
                              {Number(row.amount).toFixed(2)}{" "}
                              <em>{row.token || "USDT"}</em>
                            </td>
                            <td>
                              <span className={`sk-pill sk-pill--${row.status}`}>
                                {statusLabel(row.status)}
                              </span>
                            </td>
                            <td>
                              {canVerify ? (
                                <div className="sk-pay-verify">
                                  <input
                                    value={hashes[row.id] ?? row.tx_hash ?? ""}
                                    onChange={(e) =>
                                      setHashes((current) => ({
                                        ...current,
                                        [row.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Paste 0x hash"
                                    spellCheck={false}
                                  />
                                  <button
                                    type="button"
                                    disabled={verifyingId === row.id}
                                    onClick={() => verify(row)}
                                  >
                                    <ShieldCheck size={14} strokeWidth={2} />
                                    {verifyingId === row.id
                                      ? "Checking"
                                      : "Verify"}
                                  </button>
                                </div>
                              ) : (
                                <HashActions
                                  hash={row.tx_hash}
                                  copiedTx={copiedTx}
                                  onCopy={copyHash}
                                />
                              )}
                            </td>
                            <td>
                              <div className="sk-pay-when">
                                <strong>
                                  {formatWhen(
                                    row.confirmed_at || row.created_at
                                  )}
                                </strong>
                                <span>
                                  {row.confirmed_at
                                    ? "Confirmed"
                                    : "Awaiting hash"}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div className="sk-pay-bar">
                <select
                  aria-label="Lookback"
                  value={chainHours}
                  onChange={(e) => setChainHours(e.target.value)}
                >
                  <option value="6">Last 6 hours</option>
                  <option value="12">Last 12 hours</option>
                  <option value="24">Last 24 hours</option>
                </select>
                <button
                  type="button"
                  className="sk-pay-ghost"
                  onClick={() => loadChain(chainHours)}
                  disabled={chainLoading}
                >
                  <RefreshCw size={14} strokeWidth={2} />
                  {chainLoading ? "Scanning" : "Scan chain"}
                </button>
                {chain.wallet ? (
                  <button
                    type="button"
                    className="sk-pay-wallet"
                    onClick={() => copyHash(chain.wallet)}
                    title={chain.wallet}
                  >
                    <Wallet size={14} strokeWidth={2} />
                    {copiedTx === chain.wallet ? "Copied" : shortHash(chain.wallet)}
                  </button>
                ) : null}
              </div>

              <div className="sk-pay-ledger">
                <table>
                  <thead>
                    <tr>
                      <th>Received</th>
                      <th>From</th>
                      <th>Amount</th>
                      <th>Transaction</th>
                      <th>Checkout</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chainLoading ? (
                      <tr>
                        <td colSpan={5} className="sk-pay-empty">
                          Scanning BNB Smart Chain for incoming USDT…
                        </td>
                      </tr>
                    ) : chain.transfers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="sk-pay-empty">
                          No incoming USDT in this window.
                        </td>
                      </tr>
                    ) : (
                      chain.transfers.map((row, index) => (
                        <tr key={`${row.txHash}-${index}`}>
                          <td>
                            <div className="sk-pay-when">
                              <strong>{formatWhen(row.at)}</strong>
                              <span>Block {row.blockNumber}</span>
                            </div>
                          </td>
                          <td>
                            <span className="sk-pay-mono" title={row.from}>
                              {shortHash(row.from)}
                            </span>
                          </td>
                          <td className="sk-pay-amt">
                            {Number(row.amount).toFixed(2)} <em>USDT</em>
                          </td>
                          <td>
                            <HashActions
                              hash={row.txHash}
                              copiedTx={copiedTx}
                              onCopy={copyHash}
                            />
                          </td>
                          <td>
                            {row.checkout ? (
                              <div className="sk-pay-person">
                                <span
                                  className={`sk-pill sk-pill--${row.checkout.status}`}
                                >
                                  {statusLabel(row.checkout.status)}
                                </span>
                                <span>
                                  {fullName(
                                    row.checkout.first_name,
                                    row.checkout.last_name
                                  )}
                                </span>
                              </div>
                            ) : (
                              <span className="sk-pill sk-pill--cancelled">
                                Unmatched
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function HashActions({ hash, copiedTx, onCopy }) {
  if (!hash) return <span className="sk-pay-muted">—</span>;
  return (
    <div className="sk-pay-hash">
      <a
        href={`https://bscscan.com/tx/${hash}`}
        target="_blank"
        rel="noreferrer"
        title={hash}
      >
        {shortHash(hash)}
        <ExternalLink size={12} strokeWidth={2} />
      </a>
      <button type="button" title="Copy hash" onClick={() => onCopy(hash)}>
        {copiedTx === hash ? (
          <Check size={14} strokeWidth={2} />
        ) : (
          <Copy size={14} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

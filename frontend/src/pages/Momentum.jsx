import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  Layers,
  Mail,
  RefreshCw,
  Rocket,
  ShieldCheck,
  ShieldOff,
  TrendingUp,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { EntityCell, MetricCell } from "../components/TableCells";

const MOMENTUM_PORTAL_URL = "https://tcadmin.vercel.app";

const emptyTotals = {
  totalMomentumStudents: 0,
  activeMomentumStudents: 0,
  totalMentors: 0,
  activeMentors: 0,
  totalBatches: 0,
  activeBatches: 0,
};

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function rowKey(row, index) {
  return row?._id || row?.id || row?.email || `row-${index}`;
}

export default function Momentum() {
  const [totals, setTotals] = useState(emptyTotals);
  const [topTraders, setTopTraders] = useState([]);
  const [mentors, setMentors] = useState([]);
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCheckModal, setShowCheckModal] = useState(false);

  async function loadDashboard() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/momentum/dashboard");
      setTotals({ ...emptyTotals, ...(data.totals || {}) });
      setTopTraders(data.topProfitableStudents || []);
      setMentors(data.mentors || []);
      setBatches(data.batches || []);
    } catch (err) {
      setError(err.message);
      setTotals(emptyTotals);
      setTopTraders([]);
      setMentors([]);
      setBatches([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  return (
    <div className="portal-page momentum-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <Rocket size={14} strokeWidth={2} aria-hidden="true" />
            Products
          </p>
          <h1>Momentum</h1>
          <p>
            Live Momentum overview from TraderConnect — students, mentors, and
            batches.
          </p>
        </div>
        <div className="admins-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={loadDashboard}
            disabled={loading}
          >
            <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowCheckModal(true)}
          >
            <Mail size={16} strokeWidth={2} aria-hidden="true" />
            Check email
          </button>
          <a
            className="btn-momentum-portal"
            href={MOMENTUM_PORTAL_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
            Momentum portal
          </a>
        </div>
      </header>

      <a
        className="momentum-portal-banner"
        href={MOMENTUM_PORTAL_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="momentum-portal-banner__mark" aria-hidden="true">
          <Rocket size={18} strokeWidth={2} />
        </span>
        <div className="momentum-portal-banner__copy">
          <span className="momentum-portal-banner__badge">Main portal</span>
          <strong>Momentum Admin</strong>
          <span>tcadmin.vercel.app — open the full Momentum management app</span>
        </div>
        <span className="momentum-portal-banner__cta">
          Launch
          <ExternalLink size={14} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </a>

      {error ? <p className="portal-alert">{error}</p> : null}

      <section className="admins-stats momentum-stats" aria-label="Momentum totals">
        <article className="admins-stat">
          <span className="admins-stat__icon" aria-hidden="true">
            <Users size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>{loading ? "—" : totals.totalMomentumStudents}</strong>
            <span>Total students</span>
          </div>
        </article>
        <article className="admins-stat">
          <span className="admins-stat__icon" aria-hidden="true">
            <ShieldCheck size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>{loading ? "—" : totals.activeMomentumStudents}</strong>
            <span>Active students</span>
          </div>
        </article>
        <article className="admins-stat">
          <span className="admins-stat__icon" aria-hidden="true">
            <UserRound size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>
              {loading
                ? "—"
                : `${totals.activeMentors}/${totals.totalMentors}`}
            </strong>
            <span>Active mentors</span>
          </div>
        </article>
        <article className="admins-stat">
          <span className="admins-stat__icon" aria-hidden="true">
            <Layers size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>
              {loading
                ? "—"
                : `${totals.activeBatches}/${totals.totalBatches}`}
            </strong>
            <span>Active batches</span>
          </div>
        </article>
      </section>

      <section className="admins-panel">
        <div className="admins-panel__toolbar">
          <div>
            <h2 className="momentum-panel-title">
              <TrendingUp size={16} strokeWidth={2} aria-hidden="true" />
              Top profitable students
            </h2>
            <p className="momentum-panel-sub">
              Highest total profit from Momentum / TraderConnect.
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Email</th>
                <th>Active batch</th>
                <th className="is-num">Total profit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <EmptyRows
                  cols={5}
                  title="Loading traders"
                  text="Fetching top profitable students…"
                />
              ) : topTraders.length === 0 ? (
                <EmptyRows
                  cols={5}
                  title="No traders yet"
                  text="Top profitable students will appear here."
                />
              ) : (
                topTraders.map((trader, index) => (
                  <tr key={rowKey(trader, index)}>
                    <td>
                      <EntityCell
                        title={trader.name || "—"}
                        subtitle={`#${index + 1} · Momentum trader`}
                        tone="forest"
                      />
                    </td>
                    <td>{trader.email || "—"}</td>
                    <td>
                      {trader.activeBatch?.name ||
                        trader.batches?.[0]?.name ||
                        "—"}
                    </td>
                    <td className="is-num">
                      <MetricCell
                        value={money(trader.totalProfit)}
                        label="profit"
                      />
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          trader.isActive ? "status-active" : "status-inactive"
                        }`}
                      >
                        {trader.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="momentum-grid">
        <section className="admins-panel">
          <div className="admins-panel__toolbar">
            <div>
              <h2 className="momentum-panel-title">Mentors</h2>
              <p className="momentum-panel-sub">
                {loading ? "—" : mentors.length} mentor
                {!loading && mentors.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Mentor</th>
                  <th className="is-num">Groups</th>
                  <th className="is-num">Traders</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <EmptyRows
                    cols={4}
                    title="Loading mentors"
                    text="Fetching mentor list…"
                  />
                ) : mentors.length === 0 ? (
                  <EmptyRows
                    cols={4}
                    title="No mentors"
                    text="Mentors will appear here."
                  />
                ) : (
                  mentors.map((mentor, index) => (
                    <tr key={rowKey(mentor, index)}>
                      <td>
                        <EntityCell
                          title={mentor.name || "—"}
                          subtitle={
                            mentor.isMaster
                              ? `${mentor.email || "—"} · Master`
                              : mentor.email || "—"
                          }
                          tone="forest"
                        />
                      </td>
                      <td className="is-num">{mentor.groupsCount ?? 0}</td>
                      <td className="is-num">{mentor.tradersCount ?? 0}</td>
                      <td>
                        <span
                          className={`status-pill ${
                            mentor.isActive
                              ? "status-active"
                              : "status-inactive"
                          }`}
                        >
                          {mentor.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admins-panel">
          <div className="admins-panel__toolbar">
            <div>
              <h2 className="momentum-panel-title">Batches</h2>
              <p className="momentum-panel-sub">
                {loading ? "—" : batches.length} batch
                {!loading && batches.length === 1 ? "" : "es"}
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="is-num">Groups</th>
                  <th className="is-num">Traders</th>
                  <th>Start</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <EmptyRows
                    cols={5}
                    title="Loading batches"
                    text="Fetching batch list…"
                  />
                ) : batches.length === 0 ? (
                  <EmptyRows
                    cols={5}
                    title="No batches"
                    text="Batches will appear here."
                  />
                ) : (
                  batches.map((batch, index) => (
                    <tr key={rowKey(batch, index)}>
                      <td>
                        <EntityCell
                          title={batch.name || "—"}
                          subtitle={batch.description || "Momentum batch"}
                          tone="forest"
                        />
                      </td>
                      <td className="is-num">{batch.groupsCount ?? 0}</td>
                      <td className="is-num">{batch.tradersCount ?? 0}</td>
                      <td>
                        <span className="cell-date">
                          {formatDate(batch.startDate)}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`status-pill status-${String(
                            batch.status || "inactive"
                          ).toLowerCase()}`}
                        >
                          {batch.status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {showCheckModal ? (
        <CheckEmailModal onClose={() => setShowCheckModal(false)} />
      ) : null}
    </div>
  );
}

function EmptyRows({ cols, title, text }) {
  return (
    <tr>
      <td colSpan={cols} className="table-empty">
        <div className="table-empty__box">
          <strong>{title}</strong>
          <span>{text}</span>
        </div>
      </td>
    </tr>
  );
}

function CheckEmailModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(event) {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;

    setChecking(true);
    setError("");
    setResult(null);
    try {
      const data = await api("/api/momentum/check-trader", {
        method: "POST",
        body: JSON.stringify({ email: value }),
      });
      setResult({
        email: data.email,
        isTrader: Boolean(data.isTrader),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  return createPortal(
    <div
      className="momentum-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="momentum-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="momentum-check-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="momentum-modal__head">
          <div>
            <p className="momentum-modal__kicker">
              <Mail size={13} strokeWidth={2} aria-hidden="true" />
              TraderConnect
            </p>
            <h2 id="momentum-check-title">Check email</h2>
            <p>Verify whether an email belongs to a Momentum member.</p>
          </div>
          <button
            type="button"
            className="momentum-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>

        <form className="momentum-modal__body" onSubmit={handleSubmit}>
          {error ? <p className="momentum-modal__error">{error}</p> : null}

          <div className="field">
            <label htmlFor="momentumEmail">Email address</label>
            <input
              id="momentumEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="trader@email.com"
              autoFocus
              required
            />
          </div>

          {result ? (
            <div
              className={`momentum-status ${
                result.isTrader ? "is-on" : "is-off"
              }`}
            >
              <span className="momentum-status__icon" aria-hidden="true">
                {result.isTrader ? (
                  <ShieldCheck size={18} strokeWidth={2} />
                ) : (
                  <ShieldOff size={18} strokeWidth={2} />
                )}
              </span>
              <div>
                <strong>
                  {result.isTrader
                    ? "Active Momentum member"
                    : "Not in Momentum"}
                </strong>
                <span>{result.email}</span>
              </div>
            </div>
          ) : null}

          <footer className="momentum-modal__foot">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={checking}
            >
              Close
            </button>
            <button type="submit" className="btn-primary" disabled={checking}>
              {checking ? "Checking…" : "Check membership"}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body
  );
}

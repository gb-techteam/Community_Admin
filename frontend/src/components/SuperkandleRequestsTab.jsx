import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10) || "—";
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
}

export default function SuperkandleRequestsTab({ onStats }) {
  const { confirm, notify } = useFeedback();
  const [status, setStatus] = useState("pending");
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState({ pending: 0, approved: 0, rejected: 0 });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(nextStatus = status) {
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/student-requests?status=${nextStatus}`);
      setRequests(data.requests || []);
      setStats(data.stats || stats);
      onStats?.(data.stats || { pending: 0 });
      setSelected((current) => {
        if (!current) return current;
        return (
          (data.requests || []).find((row) => row.id === current.id) || current
        );
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("pending");
  }, []);

  async function approve(row) {
    const ok = await confirm({
      title: "Approve access request?",
      message: `${fullName(row.first_name, row.last_name)} (${row.email}) will be added to the students list.`,
      confirmLabel: "Approve",
      tone: "info",
    });
    if (!ok) return;
    try {
      await api(`/api/student-requests/${row.id}/approve`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      notify({
        title: "Request approved",
        message: "They can now use this email on the subscribe page.",
      });
      setSelected(null);
      await load(status);
    } catch (err) {
      setError(err.message);
    }
  }

  async function reject(row) {
    const ok = await confirm({
      title: "Reject this request?",
      message: `${fullName(row.first_name, row.last_name)} will not be added as a student.`,
      confirmLabel: "Reject",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api(`/api/student-requests/${row.id}/reject`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      notify({
        title: "Request rejected",
        message: "This access request was declined.",
      });
      setSelected(null);
      await load(status);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="sk-roster">
      <div className="sk-roster__head">
        <div>
          <h2>Requests</h2>
          <p>Filter by status and open a row to review the details they submitted.</p>
        </div>
        <div className="filter-bar__select">
          <label htmlFor="skReqStatus">Status</label>
          <select
            id="skReqStatus"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              load(e.target.value);
            }}
          >
            <option value="pending">Pending ({stats.pending || 0})</option>
            <option value="approved">Approved ({stats.approved || 0})</option>
            <option value="rejected">Rejected ({stats.rejected || 0})</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {error ? <p className="portal-alert">{error}</p> : null}

      {selected ? (
        <section className="entity-form student-detail">
          <div className="entity-form__header">
            <h2>{fullName(selected.first_name, selected.last_name)}</h2>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setSelected(null)}
            >
              Close
            </button>
          </div>
          <dl className="student-detail__dl">
            <div className="student-detail__item">
              <dt>Email</dt>
              <dd>{selected.email || "—"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Phone</dt>
              <dd>{selected.phone || "—"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Date of birth</dt>
              <dd>{formatDate(selected.date_of_birth)}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Telegram</dt>
              <dd>{selected.telegram_user || "—"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>TradingView</dt>
              <dd>{selected.tradingview_username || "—"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Batch</dt>
              <dd>{selected.batch_name || "—"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Status</dt>
              <dd>{selected.status}</dd>
            </div>
            <div className="student-detail__item student-detail__item--span">
              <dt>Address</dt>
              <dd>{selected.address || "—"}</dd>
            </div>
            <div className="student-detail__item student-detail__item--span">
              <dt>Note</dt>
              <dd>{selected.note || "—"}</dd>
            </div>
          </dl>
          {selected.status === "pending" ? (
            <div className="entity-form__actions">
              <button
                type="button"
                className="btn-primary"
                onClick={() => approve(selected)}
              >
                <Check size={16} strokeWidth={2} />
                Approve
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => reject(selected)}
              >
                <X size={16} strokeWidth={2} />
                Reject
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Contact</th>
              <th>TradingView</th>
              <th>Batch</th>
              <th>Submitted</th>
              <th>Status</th>
              <th className="is-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  Loading requests…
                </td>
              </tr>
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  No {status === "all" ? "" : status} requests
                </td>
              </tr>
            ) : (
              requests.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{fullName(row.first_name, row.last_name)}</strong>
                    <div className="cell-muted">{row.email}</div>
                  </td>
                  <td>{row.phone || "—"}</td>
                  <td>{row.tradingview_username || "—"}</td>
                  <td>{row.batch_name || "—"}</td>
                  <td>{formatDate(row.created_at)}</td>
                  <td>
                    <span className={`sk-pill sk-pill--${row.status}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="is-actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => setSelected(row)}
                      >
                        View
                      </button>
                      {row.status === "pending" ? (
                        <>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => approve(row)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            onClick={() => reject(row)}
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

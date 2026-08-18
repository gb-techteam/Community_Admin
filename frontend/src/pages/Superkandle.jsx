import { useEffect, useState } from "react";
import { BadgeDollarSign, CandlestickChart, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";
import { EntityCell, MetricCell } from "../components/TableCells";
import SuperkandleMemberModal from "../components/SuperkandleMemberModal";
import SuperkandlePlansModal from "../components/SuperkandlePlansModal";

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
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

function expiryLabel(state) {
  if (state === "expired") return "Expired";
  if (state === "expiring") return "Expiring soon";
  if (state === "active") return "Valid";
  return "No expiry";
}

function durationLabel(value, unit = "month") {
  const n = Number(value) || 1;
  const u = String(unit || "month").toLowerCase();
  if (u === "day") return n === 1 ? "1 day" : `${n} days`;
  if (u === "week") return n === 1 ? "1 week" : `${n} weeks`;
  return n === 1 ? "1 month" : `${n} months`;
}

export default function Superkandle() {
  const { confirm, notify } = useFeedback();
  const [members, setMembers] = useState([]);
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    expired: 0,
    expiring: 0,
    pending_payments: 0,
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadMembers(
    query = search,
    status = statusFilter,
    expiry = expiryFilter
  ) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (status !== "all") params.set("status", status);
      if (expiry !== "all") params.set("expiry", expiry);

      const data = await api(
        `/api/superkandle${params.toString() ? `?${params.toString()}` : ""}`
      );
      setMembers(data.members || []);
      setStats(data.stats || stats);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMembers("", "all", "all");
  }, []);

  function openCreate() {
    setEditingMember(null);
    setShowModal(true);
    setError("");
  }

  function openEdit(member) {
    setEditingMember(member);
    setShowModal(true);
    setError("");
  }

  function closeModal() {
    setShowModal(false);
    setEditingMember(null);
  }

  async function handleDelete(id) {
    const ok = await confirm({
      title: "Remove Superkandle member",
      message:
        "This student will lose tool access immediately. Membership and payment history for this record will be removed.",
      confirmLabel: "Remove member",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api(`/api/superkandle/${id}`, { method: "DELETE" });
      await loadMembers();
      notify({
        title: "Member removed",
        message: "Superkandle access has been revoked successfully.",
      });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <CandlestickChart size={14} strokeWidth={2} aria-hidden="true" />
            Products
          </p>
          <h1>Superkandle</h1>
          <p>
            Manage tool access for students. Fee is $8 / month; payment and
            expiry are entered manually.
          </p>
        </div>
        <div className="admins-header-actions">
          <button
            type="button"
            className="btn-plans"
            onClick={() => setShowPlans(true)}
          >
            <BadgeDollarSign size={16} strokeWidth={2} aria-hidden="true" />
            Manage plans
          </button>
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Add member
          </button>
        </div>
      </header>

      <section className="admins-stats" aria-label="Superkandle summary">
        <article className="admins-stat">
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.total}</strong>
            <span>Total members</span>
          </div>
        </article>
        <article className="admins-stat">
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.active}</strong>
            <span>Active</span>
          </div>
        </article>
        <article className="admins-stat">
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.expiring}</strong>
            <span>Expiring soon</span>
          </div>
        </article>
        <article className="admins-stat">
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.expired}</strong>
            <span>Expired</span>
          </div>
        </article>
        <article className="admins-stat">
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.pending_payments}</strong>
            <span>Pending payments</span>
          </div>
        </article>
      </section>

      {error ? <p className="portal-alert">{error}</p> : null}

      {showModal ? (
        <SuperkandleMemberModal
          member={editingMember}
          onClose={closeModal}
          onSaved={loadMembers}
        />
      ) : null}

      {showPlans ? (
        <SuperkandlePlansModal
          onClose={() => setShowPlans(false)}
          onChanged={loadMembers}
        />
      ) : null}

      <section className="admins-panel">
        <div className="admins-panel__toolbar">
          <div className="filter-bar__search">
            <Search size={16} strokeWidth={2} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members"
              onKeyDown={(e) => {
                if (e.key === "Enter") loadMembers();
              }}
            />
          </div>
          <div className="filter-bar__select">
            <label htmlFor="skStatusFilter">Member</label>
            <select
              id="skStatusFilter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>
          <div className="filter-bar__select">
            <label htmlFor="skExpiryFilter">Expiry</label>
            <select
              id="skExpiryFilter"
              value={expiryFilter}
              onChange={(e) => setExpiryFilter(e.target.value)}
            >
              <option value="all">All</option>
              <option value="valid">Valid</option>
              <option value="expiring">Expiring soon</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => loadMembers()}
          >
            Apply
          </button>
        </div>

        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Plan</th>
                <th>Payment</th>
                <th>Amount</th>
                <th>Expiry</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    Loading members…
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    No Superkandle members yet. Add a student to get started.
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <EntityCell
                        title={fullName(member.first_name, member.last_name)}
                        subtitle={
                          [member.email, member.phone]
                            .filter(Boolean)
                            .join(" · ") || "—"
                        }
                      />
                    </td>
                    <td>
                      <EntityCell
                        title={member.plan_name || "No plan"}
                        subtitle={
                          member.plan_duration_value ||
                          member.plan_duration_months
                            ? durationLabel(
                                member.plan_duration_value ||
                                  member.plan_duration_months,
                                member.plan_duration_unit
                              )
                            : "—"
                        }
                        tone="sage"
                      />
                    </td>
                    <td>
                      <div className="sk-pay-cell">
                        <span
                          className={`sk-pill sk-pill--${member.payment_status}`}
                        >
                          {member.payment_status}
                        </span>
                        <span className="cell-muted">
                          {formatDate(member.payment_date)}
                          {member.payment_method
                            ? ` · ${member.payment_method}`
                            : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <MetricCell
                        value={`$${Number(member.amount).toFixed(2)}`}
                      />
                    </td>
                    <td>
                      <div className="sk-pay-cell">
                        <span
                          className={`sk-pill sk-pill--${member.expiry_state}`}
                        >
                          {expiryLabel(member.expiry_state)}
                        </span>
                        <span className="cell-muted">
                          {formatDate(member.expires_at)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`sk-pill ${
                          member.is_active
                            ? "sk-pill--active"
                            : "sk-pill--inactive"
                        }`}
                      >
                        {member.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => openEdit(member)}
                        >
                          <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => handleDelete(member.id)}
                        >
                          <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

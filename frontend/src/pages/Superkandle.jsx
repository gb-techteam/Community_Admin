import { useEffect, useState } from "react";
import {
  BadgeDollarSign,
  Ban,
  CircleDollarSign,
  Clock3,
  Copy,
  KeyRound,
  Link2,
  Pencil,
  Share2,
  Plus,
  Search,
  Trash2,
  Users,
  UserCheck,
} from "lucide-react";
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

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
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
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);

  async function loadMembers(
    query = search,
    status = statusFilter,
    expiry = expiryFilter,
    payment = paymentFilter
  ) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (status !== "all") params.set("status", status);
      if (expiry !== "all") params.set("expiry", expiry);
      if (payment !== "all") params.set("payment", payment);

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
    loadMembers("", "all", "all", "all");
    api("/api/superkandle/checkout-settings")
      .then(setCheckout)
      .catch(() => {});
  }, []);

  async function copySubscribeLink() {
    const url = checkout?.subscribeUrl;
    if (!url) {
      setError("Set the student checkout URL in Settings first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      notify({
        title: "Link copied",
        message: "Share this with students. They must verify email first.",
      });
      setTimeout(() => setCopiedLink(false), 1600);
    } catch {
      setError("Could not copy the subscribe link");
    }
  }

  function applyView({
    status = statusFilter,
    expiry = expiryFilter,
    payment = paymentFilter,
    accessShared = sharedFilter,
    query = search,
  } = {}) {
    setStatusFilter(status);
    setExpiryFilter(expiry);
    setPaymentFilter(payment);
    setSharedFilter(accessShared);
    loadMembers(query, status, expiry, payment, accessShared);
  }

  async function handleAccessShared(member, accessShared) {
    try {
      await api(`/api/superkandle/${member.id}/access-shared`, {
        method: "PATCH",
        body: JSON.stringify({ accessShared }),
      });
      await loadMembers();
      notify({
        title: accessShared ? "Access marked shared" : "Access unmarked",
        message: accessShared
          ? "This subscription is marked as invite/access shared."
          : "This subscription is waiting for access to be shared.",
      });
    } catch (err) {
      setError(err.message);
    }
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

  const activeKpi =
    paymentFilter === "pending"
      ? "pending"
      : expiryFilter === "expiring"
        ? "expiring"
        : expiryFilter === "expired"
          ? "expired"
          : statusFilter === "active" &&
              expiryFilter === "all" &&
              paymentFilter === "all"
            ? "active"
            : statusFilter === "all" &&
                expiryFilter === "all" &&
                paymentFilter === "all"
              ? "total"
              : "";

  const banners = [
    {
      key: "total",
      label: "Total seats",
      value: stats.total,
      hint: "View all members →",
      icon: Users,
      tone: "blue",
      onClick: () =>
        applyView({ status: "all", expiry: "all", payment: "all" }),
    },
    {
      key: "active",
      label: "Active access",
      value: stats.active,
      hint: "Currently enabled →",
      icon: UserCheck,
      tone: "green",
      onClick: () =>
        applyView({ status: "active", expiry: "all", payment: "all" }),
    },
    {
      key: "pending",
      label: "Pending payments",
      value: stats.pending_payments,
      hint: "Collect now →",
      icon: CircleDollarSign,
      tone: "purple",
      onClick: () =>
        applyView({ status: "all", expiry: "all", payment: "pending" }),
    },
  ];

  return (
    <div className="portal-page sk-dash">
      <header className="sk-dash__head">
        <div>
          <p className="sk-crumb">Products / Superkandle</p>
          <h1>Superkandle</h1>
        </div>
        <div className="sk-dash__actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={copySubscribeLink}
          >
            {copiedLink ? (
              <Copy size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Link2 size={16} strokeWidth={2} aria-hidden="true" />
            )}
            {copiedLink ? "Copied" : "Copy student link"}
          </button>
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

      {checkout && !checkout.walletConfigured ? (
        <p className="sk-sub__note">
          Set the USDT BEP20 wallet in Settings to accept student payments. Free
          trial still works.
        </p>
      ) : null}

      <section className="sk-banners" aria-label="Superkandle summary">
        {banners.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              className={`sk-banner sk-banner--${item.tone} ${
                activeKpi === item.key ? "is-on" : ""
              }`}
              onClick={item.onClick}
            >
              <span className="sk-banner__icon" aria-hidden="true">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span>
                <span className="sk-banner__label">{item.label}</span>
                <strong className="sk-banner__value">
                  {loading ? "—" : item.value}
                </strong>
                <span className="sk-banner__hint">{item.hint}</span>
              </span>
            </button>
          );
        })}
      </section>

      <section className="sk-strip" aria-label="More metrics">
        <div className="sk-strip__pin">
          <span className="sk-strip__icon" aria-hidden="true">
            <KeyRound size={16} strokeWidth={2} />
          </span>
          <div className="sk-strip__meta">
            <span>Standard fee</span>
            <strong>
              $8 <em>/ month</em>
            </strong>
          </div>
        </div>
        <button
          type="button"
          className={`sk-strip__stat sk-strip__stat--warn ${
            activeKpi === "expiring" ? "is-on" : ""
          }`}
          onClick={() =>
            applyView({ status: "all", expiry: "expiring", payment: "all" })
          }
        >
          <span className="sk-strip__icon" aria-hidden="true">
            <Clock3 size={16} strokeWidth={2} />
          </span>
          <div className="sk-strip__meta">
            <span>Expiring soon</span>
            <strong>{loading ? "—" : stats.expiring}</strong>
          </div>
        </button>
        <button
          type="button"
          className={`sk-strip__stat sk-strip__stat--risk ${
            activeKpi === "expired" ? "is-on" : ""
          }`}
          onClick={() =>
            applyView({ status: "all", expiry: "expired", payment: "all" })
          }
        >
          <span className="sk-strip__icon" aria-hidden="true">
            <Ban size={16} strokeWidth={2} />
          </span>
          <div className="sk-strip__meta">
            <span>Expired</span>
            <strong>{loading ? "—" : stats.expired}</strong>
          </div>
        </button>
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

      <section className="sk-roster">
        <div className="sk-roster__head">
          <div>
            <h2>Member roster</h2>
            <p>Student, plan, payment, and expiry in one list.</p>
          </div>
          <p className="sk-roster__count">
            <strong>{loading ? "…" : members.length}</strong> shown
          </p>
        </div>

        <div className="admins-panel__toolbar">
          <div className="admins-search">
            <Search size={16} strokeWidth={2} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, or plan"
              onKeyDown={(e) => {
                if (e.key === "Enter") loadMembers();
              }}
            />
          </div>
          <div className="filter-bar__select">
            <label htmlFor="skStatusFilter">Access</label>
            <select
              id="skStatusFilter"
              value={statusFilter}
              onChange={(e) =>
                applyView({ status: e.target.value, query: search })
              }
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="filter-bar__select">
            <label htmlFor="skExpiryFilter">Expiry</label>
            <select
              id="skExpiryFilter"
              value={expiryFilter}
              onChange={(e) =>
                applyView({ expiry: e.target.value, query: search })
              }
            >
              <option value="all">All</option>
              <option value="valid">Valid</option>
              <option value="expiring">Expiring soon</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div className="filter-bar__select">
            <label htmlFor="skPaymentFilter">Payment</label>
            <select
              id="skPaymentFilter"
              value={paymentFilter}
              onChange={(e) =>
                applyView({ payment: e.target.value, query: search })
              }
            >
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
          <div className="filter-bar__select">
            <label htmlFor="skSharedFilter">Invite shared</label>
            <select
              id="skSharedFilter"
              value={sharedFilter}
              onChange={(e) =>
                applyView({ accessShared: e.target.value, query: search })
              }
            >
              <option value="all">All</option>
              <option value="false">Not shared</option>
              <option value="true">Shared</option>
            </select>
          </div>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => loadMembers()}
          >
            Search
          </button>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Plan</th>
                <th>Payment</th>
                <th className="is-num">Amount</th>
                <th>Expiry</th>
                <th>Access</th>
                <th>Invite</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="table-empty">
                    <div className="sk-empty">
                      <strong>Loading roster</strong>
                      <span>Fetching memberships and billing…</span>
                    </div>
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-empty">
                    <div className="sk-empty">
                      <span className="sk-empty__icon" aria-hidden="true">
                        <Users size={20} strokeWidth={2} />
                      </span>
                      <strong>No members in this view</strong>
                      <span>
                        Try another filter, or add a student to grant access.
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                members.map((member) => (
                  <tr
                    key={member.id}
                    className={
                      member.expiry_state === "expired" ? "sk-row--risk" : ""
                    }
                  >
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
                    <td className="is-num">
                      <MetricCell value={money(member.amount)} label="USD" />
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
                      <div className="sk-pay-cell">
                        <span
                          className={`sk-pill ${
                            member.access_shared
                              ? "sk-pill--active"
                              : "sk-pill--pending"
                          }`}
                        >
                          {member.access_shared ? "Shared" : "Not shared"}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() =>
                            handleAccessShared(member, !member.access_shared)
                          }
                        >
                          <Share2 size={14} strokeWidth={2} aria-hidden="true" />
                          {member.access_shared ? "Undo" : "Mark shared"}
                        </button>
                      </div>
                    </td>
                    <td className="is-actions">
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

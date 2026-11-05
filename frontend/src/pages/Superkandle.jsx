import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeDollarSign,
  Ban,
  Check,
  CircleDollarSign,
  Clock3,
  Copy,
  KeyRound,
  Link2,
  Eye,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  UserCheck,
} from "lucide-react";
import { api } from "../lib/api";
import { connectSuperkandleSocket } from "../lib/superkandleSocket";
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

function paymentMethodLabel(method) {
  const value = String(method || "").trim();
  if (!value) return "";
  if (/usdt/i.test(value)) return "USDT";
  if (value === "free_trial") return "Trial";
  return value;
}

function hasAccessError(member) {
  return Boolean(member?.error ?? member?.access_error);
}

function accessErrorMessage(member) {
  return String(
    member?.errorMessage ?? member?.access_error_message ?? ""
  ).trim();
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
    access_pending: 0,
  });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sharedFilter, setSharedFilter] = useState("all");
  const [showModal, setShowModal] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkout, setCheckout] = useState(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedTv, setCopiedTv] = useState("");
  const [editingTvId, setEditingTvId] = useState(null);
  const [tvDraft, setTvDraft] = useState("");
  const [savingTv, setSavingTv] = useState(false);
  const [viewingMember, setViewingMember] = useState(null);

  async function loadMembers(
    query = search,
    status = statusFilter,
    expiry = expiryFilter,
    payment = paymentFilter,
    accessShared = sharedFilter,
    options = {}
  ) {
    const silent = options.silent === true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (status !== "all") params.set("status", status);
      if (expiry !== "all") params.set("expiry", expiry);
      if (payment !== "all") params.set("payment", payment);
      if (accessShared !== "all") params.set("accessShared", accessShared);

      const data = await api(
        `/api/superkandle${params.toString() ? `?${params.toString()}` : ""}`
      );
      const nextMembers = data.members || [];
      setMembers(nextMembers);
      setStats(data.stats || stats);
      setViewingMember((current) => {
        if (!current) return current;
        return (
          nextMembers.find((row) => Number(row.id) === Number(current.id)) ||
          current
        );
      });
    } catch (err) {
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  const loadRef = useRef(loadMembers);
  loadRef.current = loadMembers;
  const filtersRef = useRef({
    search,
    statusFilter,
    expiryFilter,
    paymentFilter,
    sharedFilter,
  });
  filtersRef.current = {
    search,
    statusFilter,
    expiryFilter,
    paymentFilter,
    sharedFilter,
  };

  function refreshMembersSilent() {
    const q = filtersRef.current;
    loadRef.current(
      q.search,
      q.statusFilter,
      q.expiryFilter,
      q.paymentFilter,
      q.sharedFilter,
      { silent: true }
    );
  }

  useEffect(() => {
    loadMembers("", "all", "all", "all", "all");
    api("/api/superkandle/checkout-settings")
      .then(setCheckout)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const stopSocket = connectSuperkandleSocket((event) => {
      const member = event?.member;
      if (member?.id) {
        const id = Number(member.id);
        setMembers((rows) =>
          rows.map((row) =>
            Number(row.id) === id ? { ...row, ...member } : row
          )
        );
        setViewingMember((current) =>
          Number(current?.id) === id ? { ...current, ...member } : current
        );
      }
      refreshMembersSilent();
    });
    const timer = setInterval(refreshMembersSilent, 4000);
    return () => {
      stopSocket();
      clearInterval(timer);
    };
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
    const name = fullName(member.first_name, member.last_name);
    const ok = await confirm({
      title: accessShared ? "Mark invite as shared?" : "Undo shared invite?",
      message: accessShared
        ? `Confirm that TradingView access has been shared with ${name}.`
        : `Mark ${name} as not shared again?`,
      confirmLabel: accessShared ? "Mark shared" : "Undo",
      tone: accessShared ? "info" : "danger",
    });
    if (!ok) return;

    try {
      const data = await api(`/api/superkandle/${member.id}/access-shared`, {
        method: "PATCH",
        body: JSON.stringify(
          accessShared
            ? { accessShared: true, error: false, errorMessage: "" }
            : { accessShared: false, unmark: true }
        ),
      });
      await loadMembers();
      notify({
        title: accessShared ? "Access marked shared" : "Access unmarked",
        message: accessShared
          ? data.mailSent
            ? "Invite marked shared and the student was emailed."
            : `Invite marked shared, but the email did not send${
                data.mailError ? `: ${data.mailError}` : ""
              }.`
          : "This subscription is waiting for access to be shared.",
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function copyTradingview(member) {
    const username = String(member.tradingview_username || "").trim();
    if (!username) return;
    try {
      await navigator.clipboard.writeText(username);
      setCopiedTv(member.id);
      setTimeout(() => setCopiedTv(""), 1400);
    } catch {
      setError("Could not copy TradingView username");
    }
  }

  function startEditTradingview(member) {
    setEditingTvId(member.id);
    setTvDraft(member.tradingview_username || "");
  }

  async function saveTradingview(member) {
    const name = fullName(member.first_name, member.last_name);
    const ok = await confirm({
      title: "Save TradingView username?",
      message: tvDraft.trim()
        ? `Update TradingView ID for ${name} to “${tvDraft.trim()}”?`
        : `Clear the TradingView ID for ${name}?`,
      confirmLabel: "Save",
      tone: "info",
    });
    if (!ok) return;

    setSavingTv(true);
    setError("");
    try {
      await api(`/api/superkandle/${member.id}/tradingview`, {
        method: "PATCH",
        body: JSON.stringify({ tradingviewUsername: tvDraft }),
      });
      setEditingTvId(null);
      await loadMembers();
      notify({
        title: "TradingView updated",
        message: "The username is saved for this student.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingTv(false);
    }
  }

  function openCreate() {
    setEditingMember(null);
    setShowModal(true);
    setError("");
  }

  function openView(member) {
    setViewingMember(member);
    setError("");
  }

  function closeView() {
    setViewingMember(null);
  }

  function closeModal() {
    setShowModal(false);
    setEditingMember(null);
  }

  async function handleResetTrial(member) {
    const name = fullName(member.first_name, member.last_name);
    const ok = await confirm({
      title: "Reset this student's free trial?",
      message: `${name} will be able to take the SuperKandle free trial again.`,
      confirmLabel: "Reset trial",
      tone: "info",
    });
    if (!ok) return;
    try {
      const data = await api(`/api/superkandle/${member.id}/reset-trial`, {
        method: "POST",
      });
      if (data.member) {
        setMembers((rows) =>
          rows.map((row) =>
            Number(row.id) === Number(member.id) ? { ...row, ...data.member } : row
          )
        );
        setViewingMember((current) =>
          current && Number(current.id) === Number(member.id)
            ? { ...current, ...data.member }
            : current
        );
      }
      notify({
        title: "Trial reset",
        message: data.message || "This student can take the free trial again.",
      });
    } catch (err) {
      setError(err.message);
    }
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
      setViewingMember((current) => (current?.id === id ? null : current));
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

      {viewingMember ? (
        <section className="entity-form student-detail">
          <div className="entity-form__header">
            <h2>
              {fullName(viewingMember.first_name, viewingMember.last_name)}
            </h2>
            <button type="button" className="btn-ghost" onClick={closeView}>
              Close
            </button>
          </div>

          <div className="student-detail__ids">
            <div className="student-detail__id-card">
              <span>TradingView ID</span>
              <strong>{viewingMember.tradingview_username || "—"}</strong>
            </div>
            <div className="student-detail__id-card">
              <span>Invite</span>
              <strong>
                {viewingMember.access_shared ? "Shared" : "Not shared"}
              </strong>
            </div>
          </div>

          {hasAccessError(viewingMember) ? (
            <p className="sk-view-error">
              <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
              <span>
                <strong>Share error</strong>
                {accessErrorMessage(viewingMember) ||
                  "TradingView invite could not be shared."}
              </span>
            </p>
          ) : null}

          <dl className="student-detail__dl">
            <div className="student-detail__item">
              <dt>Email</dt>
              <dd>{viewingMember.email || "—"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Phone</dt>
              <dd>{viewingMember.phone || "—"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Plan</dt>
              <dd>
                {viewingMember.plan_name || "No plan"}
                {viewingMember.plan_duration_value ||
                viewingMember.plan_duration_months
                  ? ` · ${durationLabel(
                      viewingMember.plan_duration_value ||
                        viewingMember.plan_duration_months,
                      viewingMember.plan_duration_unit
                    )}`
                  : ""}
              </dd>
            </div>
            <div className="student-detail__item">
              <dt>Amount</dt>
              <dd>{money(viewingMember.amount)}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Payment</dt>
              <dd>
                {viewingMember.payment_status}
                {paymentMethodLabel(viewingMember.payment_method)
                  ? ` · ${paymentMethodLabel(viewingMember.payment_method)}`
                  : ""}
              </dd>
            </div>
            <div className="student-detail__item">
              <dt>Paid on</dt>
              <dd>{formatDate(viewingMember.payment_date)}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Expiry</dt>
              <dd>
                {expiryLabel(viewingMember.expiry_state)} ·{" "}
                {formatDate(viewingMember.expires_at)}
              </dd>
            </div>
            <div className="student-detail__item">
              <dt>Access</dt>
              <dd>{viewingMember.is_active ? "Active" : "Inactive"}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Free trial</dt>
              <dd>{viewingMember.trial_used ? "Used" : "Available"}</dd>
            </div>
            {viewingMember.payment_note ? (
              <div className="student-detail__item student-detail__item--span">
                <dt>Note</dt>
                <dd>{viewingMember.payment_note}</dd>
              </div>
            ) : null}
          </dl>
          <div className="entity-form__actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handleResetTrial(viewingMember)}
            >
              <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
              Reset this student's trial
            </button>
          </div>
        </section>
      ) : null}

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
              placeholder="Search name, email, phone, plan, or TradingView"
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
          <table className="data-table sk-table">
            <thead>
              <tr>
                <th className="sk-col-student">Student</th>
                <th className="sk-col-tv">TradingView</th>
                <th className="sk-col-plan">Plan</th>
                <th className="sk-col-pay">Payment</th>
                <th className="sk-col-amount">Amount</th>
                <th className="sk-col-expiry">Expiry</th>
                <th className="sk-col-access">Access</th>
                <th className="sk-col-invite">Invite</th>
                <th className="sk-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="table-empty">
                    <div className="sk-empty">
                      <strong>Loading roster</strong>
                      <span>Fetching memberships and billing…</span>
                    </div>
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={9} className="table-empty">
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
                    className={`${
                      member.expiry_state === "expired" ? "sk-row--risk" : ""
                    } ${viewingMember?.id === member.id ? "sk-row--on" : ""}`}
                  >
                    <td className="sk-col-student">
                      <EntityCell
                        title={fullName(member.first_name, member.last_name)}
                        subtitle={
                          [member.email, member.phone]
                            .filter(Boolean)
                            .join(" · ") || "—"
                        }
                      />
                    </td>
                    <td className="sk-col-tv">
                      {editingTvId === member.id ? (
                        <form
                          className="sk-tv-edit"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveTradingview(member);
                          }}
                        >
                          <input
                            value={tvDraft}
                            onChange={(e) => setTvDraft(e.target.value)}
                            placeholder="TradingView ID"
                            autoFocus
                            disabled={savingTv}
                          />
                          <button
                            type="submit"
                            className="sk-tv-icon"
                            disabled={savingTv}
                            aria-label="Save TradingView username"
                          >
                            <Check size={14} strokeWidth={2} />
                          </button>
                          <button
                            type="button"
                            className="sk-tv-icon"
                            onClick={() => setEditingTvId(null)}
                            disabled={savingTv}
                            aria-label="Cancel"
                          >
                            ×
                          </button>
                        </form>
                      ) : (
                        <div className="sk-tv-cell">
                          <span
                            className="sk-tv-name"
                            title={member.tradingview_username || ""}
                          >
                            {member.tradingview_username || "—"}
                          </span>
                          <button
                            type="button"
                            className="sk-tv-icon"
                            disabled={!member.tradingview_username}
                            onClick={() => copyTradingview(member)}
                            aria-label="Copy TradingView username"
                          >
                            {copiedTv === member.id ? (
                              <Check size={14} strokeWidth={2} />
                            ) : (
                              <Copy size={14} strokeWidth={2} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="sk-tv-icon"
                            onClick={() => startEditTradingview(member)}
                            aria-label="Edit TradingView username"
                          >
                            <Pencil size={14} strokeWidth={2} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="sk-col-plan">
                      <div className="sk-pay-cell">
                        <strong>{member.plan_name || "No plan"}</strong>
                        <span className="cell-muted">
                          {member.plan_duration_value ||
                          member.plan_duration_months
                            ? durationLabel(
                                member.plan_duration_value ||
                                  member.plan_duration_months,
                                member.plan_duration_unit
                              )
                            : "—"}
                        </span>
                      </div>
                    </td>
                    <td className="sk-col-pay">
                      <div className="sk-pay-cell">
                        <span
                          className={`sk-pill sk-pill--${member.payment_status}`}
                        >
                          {member.payment_status}
                        </span>
                        <span className="cell-muted">
                          {formatDate(member.payment_date)}
                          {paymentMethodLabel(member.payment_method)
                            ? ` · ${paymentMethodLabel(member.payment_method)}`
                            : ""}
                        </span>
                      </div>
                    </td>
                    <td className="sk-col-amount">
                      <MetricCell value={money(member.amount)} label="USD" />
                    </td>
                    <td className="sk-col-expiry">
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
                    <td className="sk-col-access">
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
                    <td className="sk-col-invite">
                      <div className="sk-invite-cell">
                        <span className="sk-invite-status">
                          {hasAccessError(member) ? (
                            <span
                              className="sk-error-flag"
                              title={
                                accessErrorMessage(member) ||
                                "TradingView invite failed"
                              }
                            >
                              <AlertTriangle size={14} strokeWidth={2} />
                            </span>
                          ) : null}
                          <span
                            className={`sk-pill ${
                              hasAccessError(member)
                                ? "sk-pill--expired"
                                : member.access_shared
                                  ? "sk-pill--active"
                                  : "sk-pill--pending"
                            }`}
                          >
                            {hasAccessError(member)
                              ? "Error"
                              : member.access_shared
                                ? "Shared"
                                : "Not shared"}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="sk-invite-btn"
                          onClick={() =>
                            handleAccessShared(member, !member.access_shared)
                          }
                        >
                          {member.access_shared ? "Undo" : "Mark shared"}
                        </button>
                      </div>
                    </td>
                    <td className="sk-col-actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => openView(member)}
                        >
                          <Eye size={14} strokeWidth={2} aria-hidden="true" />
                          View
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => handleResetTrial(member)}
                          title="Reset this student's free trial"
                        >
                          <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
                          Reset trial
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

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CandlestickChart,
  Check,
  Clock3,
  Layers,
  Search,
  Tag,
  UserRound,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";

const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "crypto", label: "Crypto" },
];

function todayInputDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const emptyForm = {
  studentId: "",
  studentLabel: "",
  planId: "",
  amount: "",
  paymentStatus: "pending",
  paymentDate: todayInputDate(),
  paymentMethod: "upi",
  paymentNote: "",
  expiresAt: "",
  isActive: true,
};

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
}

function toInputDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function planPrice(plan) {
  if (!plan) return "";
  if (plan.offer_price != null && plan.offer_price !== "") {
    return String(plan.offer_price);
  }
  return String(plan.amount ?? "");
}

function durationLabel(value, unit = "month") {
  const n = Number(value) || 1;
  const u = String(unit || "month").toLowerCase();
  if (u === "day") return n === 1 ? "1 day" : `${n} days`;
  if (u === "week") return n === 1 ? "1 week" : `${n} weeks`;
  return n === 1 ? "1 month" : `${n} months`;
}

function formatInputDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Expiry = payment date + plan duration */
function calcExpiresAt(paymentDate, plan) {
  if (!paymentDate || !plan) return "";
  const parts = String(paymentDate).slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return "";
  const [year, month, day] = parts;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return "";

  const value = Number(plan.duration_value || plan.duration_months || 1);
  const unit = String(plan.duration_unit || "month").toLowerCase();
  if (!Number.isFinite(value) || value < 1) return "";

  if (unit === "day") date.setDate(date.getDate() + value);
  else if (unit === "week") date.setDate(date.getDate() + value * 7);
  else date.setMonth(date.getMonth() + value);

  return formatInputDate(date);
}

function money(value, { trial = false } = {}) {
  if (trial) return "Free";
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (n === 0) return "Free";
  return `$${n.toFixed(2)}`;
}

function normalizeMethod(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (PAYMENT_METHODS.some((item) => item.value === raw)) return raw;
  return "upi";
}

export default function SuperkandleMemberModal({
  member = null,
  onClose,
  onSaved,
}) {
  const { notify } = useFeedback();
  const editingId = member?.id || null;
  const [addMode, setAddMode] = useState("single"); // single | batch
  const [form, setForm] = useState(emptyForm);
  const [plans, setPlans] = useState([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [studentResults, setStudentResults] = useState([]);
  const [batches, setBatches] = useState([]);
  const [batchQuery, setBatchQuery] = useState("");
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);

  useEffect(() => {
    async function loadPlans() {
      setLoadingPlans(true);
      try {
        const data = await api("/api/superkandle/plans");
        const list = (data.plans || []).filter((plan) => plan.is_active);
        setPlans(list);

        if (member) {
          setForm({
            studentId: String(member.student_id),
            studentLabel: fullName(member.first_name, member.last_name),
            planId: member.plan_id ? String(member.plan_id) : "",
            amount: String(member.amount ?? ""),
            paymentStatus: member.payment_status || "pending",
            paymentDate: toInputDate(member.payment_date) || todayInputDate(),
            paymentMethod: normalizeMethod(member.payment_method),
            paymentNote: member.payment_note || "",
            expiresAt: toInputDate(member.expires_at),
            isActive: Boolean(member.is_active),
          });
        } else {
          const defaultPlan =
            list.find((plan) => plan.is_default) || list[0] || null;
          const paymentDate = todayInputDate();
          setForm({
            ...emptyForm,
            paymentDate,
            paymentMethod: "upi",
            planId: defaultPlan ? String(defaultPlan.id) : "",
            amount: planPrice(defaultPlan),
            expiresAt: calcExpiresAt(paymentDate, defaultPlan),
          });
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoadingPlans(false);
      }
    }

    loadPlans();
    setStudentQuery("");
    setStudentResults([]);
    setBatchQuery("");
    setSelectedBatchIds([]);
    setAddMode("single");
    setError("");
  }, [member]);

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

  useEffect(() => {
    if (editingId || addMode !== "single" || studentQuery.trim().length < 1) {
      setStudentResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const data = await api(
          `/api/superkandle/students-search?search=${encodeURIComponent(
            studentQuery.trim()
          )}`
        );
        setStudentResults(data.students || []);
      } catch {
        setStudentResults([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [studentQuery, editingId, addMode]);

  useEffect(() => {
    if (editingId || addMode !== "batch") return undefined;

    const timer = setTimeout(async () => {
      setLoadingBatches(true);
      try {
        const data = await api(
          `/api/superkandle/batches${
            batchQuery.trim()
              ? `?search=${encodeURIComponent(batchQuery.trim())}`
              : ""
          }`
        );
        setBatches(data.batches || []);
      } catch (err) {
        setError(err.message);
        setBatches([]);
      } finally {
        setLoadingBatches(false);
      }
    }, batchQuery.trim() ? 250 : 0);

    return () => clearTimeout(timer);
  }, [batchQuery, addMode, editingId]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => String(plan.id) === String(form.planId)) || null,
    [plans, form.planId]
  );

  const selectedBatchCount = useMemo(
    () =>
      batches
        .filter((batch) => selectedBatchIds.includes(batch.id))
        .reduce((sum, batch) => sum + (batch.eligible_count || 0), 0),
    [batches, selectedBatchIds]
  );

  function pickStudent(student) {
    setForm((prev) => ({
      ...prev,
      studentId: String(student.id),
      studentLabel: fullName(student.first_name, student.last_name),
    }));
    setStudentQuery("");
    setStudentResults([]);
  }

  function toggleBatch(id) {
    setSelectedBatchIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function selectPlan(plan) {
    setForm((prev) => ({
      ...prev,
      planId: String(plan.id),
      amount: planPrice(plan),
      expiresAt: calcExpiresAt(prev.paymentDate, plan),
    }));
  }

  function onPaymentDateChange(value) {
    setForm((prev) => {
      const plan =
        plans.find((item) => String(item.id) === String(prev.planId)) || null;
      return {
        ...prev,
        paymentDate: value,
        expiresAt: calcExpiresAt(value, plan),
      };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const basePayload = {
        planId: Number(form.planId),
        amount: Number(form.amount),
        paymentStatus: form.paymentStatus,
        paymentDate: form.paymentDate || null,
        paymentMethod: form.paymentMethod,
        paymentNote: form.paymentNote,
        expiresAt: form.expiresAt || null,
        isActive: form.isActive,
      };

      if (!basePayload.planId) {
        throw new Error("Select a plan");
      }

      if (editingId) {
        await api(`/api/superkandle/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({
            ...basePayload,
            studentId: Number(form.studentId),
          }),
        });
        await onSaved?.();
        notify({
          title: "Member updated",
          message: "Payment and access details were saved successfully.",
        });
      } else if (addMode === "batch") {
        if (!selectedBatchIds.length) {
          throw new Error("Select at least one batch");
        }
        const data = await api("/api/superkandle/bulk", {
          method: "POST",
          body: JSON.stringify({
            ...basePayload,
            batchIds: selectedBatchIds,
          }),
        });
        await onSaved?.();
        const added = data.added || 0;
        const skipped = data.skipped || 0;
        notify({
          title:
            added === 0 ? "No new members added" : "Members added in bulk",
          message:
            added === 0
              ? "Everyone in the selected batches is already a Superkandle member."
              : `${added} student${added === 1 ? "" : "s"} provisioned${
                  skipped
                    ? ` · ${skipped} already had access and were skipped`
                    : ""
                }.`,
          tone: added === 0 ? "info" : "success",
        });
      } else {
        if (!form.studentId) {
          throw new Error("Pick a student first");
        }
        await api("/api/superkandle", {
          method: "POST",
          body: JSON.stringify({
            ...basePayload,
            studentId: Number(form.studentId),
          }),
        });
        await onSaved?.();
        notify({
          title: "Member added",
          message: "Superkandle access has been provisioned for this student.",
        });
      }

      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const modal = (
    <div
      className="sk-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sk-modal sk-modal--member"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sk-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sk-modal__head">
          <div>
            <p className="sk-modal__kicker">
              <CandlestickChart size={13} strokeWidth={2} aria-hidden="true" />
              Superkandle
            </p>
            <h2 id="sk-modal-title">
              {editingId ? "Edit member" : "Add member"}
            </h2>
            <p>
              {editingId
                ? "Update plan and payment details for this member."
                : "Choose a plan, then add one student or an entire batch."}
            </p>
          </div>
          <button
            type="button"
            className="sk-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </header>

        {error ? <p className="sk-modal__error">{error}</p> : null}

        <form className="sk-modal__form" onSubmit={handleSubmit}>
          <div className="sk-modal__body">
            <div className="sk-plan-section">
              <div className="sk-plan-section__head">
                <label>Plan requested</label>
                {selectedPlan ? (
                  <span>
                    {durationLabel(
                      selectedPlan.duration_value ||
                        selectedPlan.duration_months,
                      selectedPlan.duration_unit
                    )}
                  </span>
                ) : null}
              </div>

              {loadingPlans ? (
                <p className="muted">Loading plans…</p>
              ) : plans.length === 0 ? (
                <p className="muted">
                  No active plans. Create one from Manage plans first.
                </p>
              ) : (
                <ul className="sk-plan-row">
                  {plans.map((plan) => {
                    const selected = String(form.planId) === String(plan.id);
                    const hasOffer =
                      plan.offer_price != null && plan.offer_price !== "";
                    return (
                      <li key={plan.id}>
                        <button
                          type="button"
                          className={`sk-plan-tile ${
                            plan.is_trial ? "is-trial" : ""
                          } ${selected ? "is-selected" : ""}`}
                          onClick={() => selectPlan(plan)}
                        >
                          <span className="sk-plan-tile__top">
                            <span className="sk-plan-tile__icon" aria-hidden="true">
                              <Tag size={15} strokeWidth={2} />
                            </span>
                            <span className="sk-plan-tile__top-end">
                              {plan.is_trial ? (
                                <span className="sk-plan-tile__badge is-trial">
                                  Trial
                                </span>
                              ) : plan.is_default ? (
                                <span className="sk-plan-tile__badge">
                                  Default
                                </span>
                              ) : null}
                              {selected ? (
                                <span
                                  className="sk-plan-tile__check"
                                  aria-hidden="true"
                                >
                                  <Check size={12} strokeWidth={2.4} />
                                </span>
                              ) : null}
                            </span>
                          </span>
                          <strong>{plan.name}</strong>
                          <span className="sk-plan-tile__price">
                            {plan.is_trial ? (
                              <em>{money(0, { trial: true })}</em>
                            ) : hasOffer ? (
                              <>
                                <span className="sk-plans-card__strike">
                                  {money(plan.amount)}
                                </span>
                                <em>{money(plan.offer_price)}</em>
                              </>
                            ) : (
                              <em>{money(plan.amount)}</em>
                            )}
                          </span>
                          <span className="sk-plan-tile__meta">
                            <Clock3 size={12} strokeWidth={2} />
                            {durationLabel(
                              plan.duration_value || plan.duration_months,
                              plan.duration_unit
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="form-grid">
              {!editingId ? (
                <div className="sk-add-tabs field-span" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={addMode === "single"}
                    className={`sk-add-tab ${
                      addMode === "single" ? "is-active" : ""
                    }`}
                    onClick={() => setAddMode("single")}
                  >
                    <UserRound size={15} strokeWidth={2} aria-hidden="true" />
                    Single student
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={addMode === "batch"}
                    className={`sk-add-tab ${
                      addMode === "batch" ? "is-active" : ""
                    }`}
                    onClick={() => setAddMode("batch")}
                  >
                    <Layers size={15} strokeWidth={2} aria-hidden="true" />
                    By batch
                  </button>
                </div>
              ) : null}

              {editingId || addMode === "single" ? (
                <div className="field field-span">
                  <label htmlFor="skStudent">Student</label>
                  {editingId ? (
                    <input
                      id="skStudent"
                      value={form.studentLabel}
                      disabled
                      readOnly
                    />
                  ) : (
                    <>
                      {form.studentId ? (
                        <div className="sk-picked">
                          <strong>{form.studentLabel}</strong>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() =>
                              setForm((prev) => ({
                                ...prev,
                                studentId: "",
                                studentLabel: "",
                              }))
                            }
                          >
                            Change
                          </button>
                        </div>
                      ) : (
                        <div className="sk-student-search">
                          <Search
                            size={16}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                          <input
                            id="skStudent"
                            value={studentQuery}
                            onChange={(e) => setStudentQuery(e.target.value)}
                            placeholder="Search students by name, email, or phone"
                            autoComplete="off"
                            autoFocus
                          />
                        </div>
                      )}
                      {!form.studentId && studentResults.length > 0 ? (
                        <ul className="sk-student-results">
                          {studentResults.map((student) => (
                            <li key={student.id}>
                              <button
                                type="button"
                                onClick={() => pickStudent(student)}
                              >
                                <strong>
                                  {fullName(
                                    student.first_name,
                                    student.last_name
                                  )}
                                </strong>
                                <span>
                                  {[student.email, student.phone]
                                    .filter(Boolean)
                                    .join(" · ") || "No contact"}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <div className="field field-span sk-batch-field">
                  <label htmlFor="skBatchSearch">Batches</label>
                  <div className="sk-student-search">
                    <Search size={16} strokeWidth={2} aria-hidden="true" />
                    <input
                      id="skBatchSearch"
                      type="search"
                      value={batchQuery}
                      onChange={(e) => setBatchQuery(e.target.value)}
                      placeholder="Search batches by name or course"
                      autoComplete="off"
                    />
                  </div>

                  {selectedBatchIds.length ? (
                    <p className="sk-batch-hint">
                      {selectedBatchIds.length} batch
                      {selectedBatchIds.length === 1 ? "" : "es"} selected ·{" "}
                      {selectedBatchCount} eligible student
                      {selectedBatchCount === 1 ? "" : "s"}
                    </p>
                  ) : (
                    <p className="sk-batch-hint is-muted">
                      Existing Superkandle members in a batch are skipped
                      automatically.
                    </p>
                  )}

                  <div className="sk-batch-list-wrap">
                    {loadingBatches ? (
                      <p className="muted">Loading batches…</p>
                    ) : batches.length === 0 ? (
                      <p className="muted">No batches found.</p>
                    ) : (
                      <ul className="sk-batch-list">
                        {batches.map((batch) => {
                          const active = selectedBatchIds.includes(batch.id);
                          return (
                            <li key={batch.id}>
                              <button
                                type="button"
                                className={`sk-batch-pick ${
                                  active ? "is-selected" : ""
                                }`}
                                onClick={() => toggleBatch(batch.id)}
                              >
                                <span
                                  className="sk-batch-pick__icon"
                                  aria-hidden="true"
                                >
                                  <Layers size={16} strokeWidth={2} />
                                </span>
                                <span className="sk-batch-pick__meta">
                                  <strong>{batch.name}</strong>
                                  <em>
                                    {batch.course_title || "No course"} ·{" "}
                                    {batch.eligible_count || 0} eligible /{" "}
                                    {batch.student_count || 0} total
                                  </em>
                                </span>
                                <span
                                  className="sk-batch-pick__check"
                                  aria-hidden="true"
                                >
                                  {active ? (
                                    <Check size={14} strokeWidth={2.6} />
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="field">
                <label htmlFor="skAmount">Amount (USD)</label>
                <input
                  id="skAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) =>
                    setForm({ ...form, amount: e.target.value })
                  }
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="skPayStatus">Payment status</label>
                <select
                  id="skPayStatus"
                  value={form.paymentStatus}
                  onChange={(e) =>
                    setForm({ ...form, paymentStatus: e.target.value })
                  }
                >
                  <option value="paid">Paid</option>
                  <option value="pending">Pending</option>
                  <option value="overdue">Overdue</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="skPayDate">Payment date</label>
                <input
                  id="skPayDate"
                  type="date"
                  value={form.paymentDate}
                  onChange={(e) => onPaymentDateChange(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="skPayMethod">Payment method</label>
                <select
                  id="skPayMethod"
                  value={form.paymentMethod}
                  onChange={(e) =>
                    setForm({ ...form, paymentMethod: e.target.value })
                  }
                  required
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method.value} value={method.value}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="skExpires">
                  Expiry date
                  {selectedPlan ? (
                    <span className="field-hint">
                      {" "}
                      · from plan ({durationLabel(
                        selectedPlan.duration_value ||
                          selectedPlan.duration_months,
                        selectedPlan.duration_unit
                      )})
                    </span>
                  ) : null}
                </label>
                <input
                  id="skExpires"
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) =>
                    setForm({ ...form, expiresAt: e.target.value })
                  }
                />
              </div>

              <div className="field">
                <label htmlFor="skActive">Status</label>
                <select
                  id="skActive"
                  value={form.isActive ? "active" : "inactive"}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      isActive: e.target.value === "active",
                    })
                  }
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="field field-span">
                <label htmlFor="skNote">Payment note</label>
                <textarea
                  id="skNote"
                  rows={2}
                  value={form.paymentNote}
                  onChange={(e) =>
                    setForm({ ...form, paymentNote: e.target.value })
                  }
                  placeholder="Reference ID or short note"
                />
              </div>
            </div>
          </div>

          <footer className="sk-modal__foot">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? "Saving…"
                : editingId
                  ? "Save changes"
                  : addMode === "batch"
                    ? selectedBatchIds.length
                      ? `Add from ${selectedBatchIds.length} batch${
                          selectedBatchIds.length === 1 ? "" : "es"
                        }`
                      : "Add from batches"
                    : "Add member"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

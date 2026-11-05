import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Clock3,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";

const emptyForm = {
  name: "",
  amount: "8",
  offerPrice: "",
  durationValue: "1",
  durationUnit: "month",
  isActive: true,
  isDefault: false,
  isTrial: false,
};

const FALLBACK_SUGGESTIONS = {
  day: [1, 3, 7, 14, 30],
  week: [1, 2, 4, 8],
  month: [1, 3, 6, 12],
};

function durationLabel(value, unit = "month") {
  const n = Number(value) || 1;
  const u = String(unit || "month").toLowerCase();
  if (u === "day") return n === 1 ? "1 day" : `${n} days`;
  if (u === "week") return n === 1 ? "1 week" : `${n} weeks`;
  return n === 1 ? "1 month" : `${n} months`;
}

function money(value, { trial = false } = {}) {
  if (trial) return "Free";
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (n === 0) return "Free";
  return `$${n.toFixed(2)}`;
}

function unitWord(unit, plural = false) {
  if (unit === "day") return plural ? "days" : "day";
  if (unit === "week") return plural ? "weeks" : "week";
  return plural ? "months" : "month";
}

export default function SuperkandlePlansModal({ onClose, onChanged }) {
  const { confirm, notify } = useFeedback();
  const [plans, setPlans] = useState([]);
  const [durationSuggestions, setDurationSuggestions] =
    useState(FALLBACK_SUGGESTIONS);
  const [form, setForm] = useState(emptyForm);
  const [mode, setMode] = useState("list");
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [displayPricedPlans, setDisplayPricedPlans] = useState(true);
  const [resettingTrials, setResettingTrials] = useState(false);

  const suggestionValues = useMemo(
    () =>
      durationSuggestions[form.durationUnit] ||
      FALLBACK_SUGGESTIONS[form.durationUnit] ||
      FALLBACK_SUGGESTIONS.month,
    [durationSuggestions, form.durationUnit]
  );

  async function loadPlans() {
    setLoading(true);
    setError("");
    try {
      const [data, checkout] = await Promise.all([
        api("/api/superkandle/plans"),
        api("/api/superkandle/checkout-settings"),
      ]);
      setPlans(data.plans || []);
      setDurationSuggestions(data.durationSuggestions || FALLBACK_SUGGESTIONS);
      setDisplayPricedPlans(checkout.displayPricedPlans !== false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlans();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (mode === "form") {
        backToList();
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, mode]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setMode("form");
    setError("");
  }

  function openEdit(plan) {
    setEditingId(plan.id);
    setForm({
      name: plan.name || "",
      amount: String(plan.amount ?? ""),
      offerPrice:
        plan.offer_price == null || plan.offer_price === ""
          ? ""
          : String(plan.offer_price),
      durationValue: String(
        plan.duration_value || plan.duration_months || 1
      ),
      durationUnit: plan.duration_unit || "month",
      isActive: Boolean(plan.is_active),
      isDefault: Boolean(plan.is_default),
      isTrial: Boolean(plan.is_trial),
    });
    setMode("form");
    setError("");
  }

  function backToList() {
    setMode("list");
    setEditingId(null);
    setForm(emptyForm);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        name: form.name,
        amount: Number(form.amount),
        offerPrice: form.offerPrice === "" ? null : Number(form.offerPrice),
        durationValue: Number(form.durationValue),
        durationUnit: form.durationUnit,
        isActive: form.isActive,
        isDefault: form.isDefault,
        isTrial: form.isTrial,
      };

      if (editingId) {
        await api(`/api/superkandle/plans/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/superkandle/plans", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      backToList();
      await loadPlans();
      await onChanged?.();
      notify({
        title: editingId ? "Plan updated" : "Plan created",
        message: editingId
          ? "Pricing and duration changes are saved."
          : "The new plan is available when adding members.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(plan) {
    if (plan.is_default) {
      setError(
        "Cannot delete the default plan. Set another plan as default first."
      );
      return;
    }
    if (plan.member_count > 0) {
      setError("Cannot delete a plan assigned to members.");
      return;
    }
    const ok = await confirm({
      title: "Delete plan",
      message: `“${plan.name}” will be permanently removed. Members already on this plan are unaffected only if the plan is unused.`,
      confirmLabel: "Delete plan",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api(`/api/superkandle/plans/${plan.id}`, { method: "DELETE" });
      await loadPlans();
      await onChanged?.();
      notify({
        title: "Plan deleted",
        message: "The pricing plan has been removed.",
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function togglePricedPlans(next) {
    const previous = displayPricedPlans;
    setDisplayPricedPlans(next);
    setError("");
    try {
      await api("/api/superkandle/checkout-settings", {
        method: "PATCH",
        body: JSON.stringify({ displayPricedPlans: next }),
      });
      notify({
        title: next ? "Priced plans visible" : "Priced plans hidden",
        message: next
          ? "Students can see paid SuperKandle plans."
          : "Students will only see a free plan, if one is active.",
      });
    } catch (err) {
      setDisplayPricedPlans(previous);
      setError(err.message);
    }
  }

  async function resetTrials() {
    const ok = await confirm({
      title: "Reset free trials for every student?",
      message:
        "Every student will be able to take the free SuperKandle trial again.",
      confirmLabel: "Reset trials",
      tone: "danger",
    });
    if (!ok) return;
    setResettingTrials(true);
    setError("");
    try {
      const data = await api("/api/superkandle/reset-trials", { method: "POST" });
      notify({
        title: "Free trials reset",
        message: data.message || "Every student can take the free trial again.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setResettingTrials(false);
    }
  }

  const modal = (
    <div
      className="sk-plans-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sk-plans-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sk-plans-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sk-plans-modal__head">
          <button
            type="button"
            className="sk-plans-modal__icon-btn"
            onClick={mode === "form" ? backToList : onClose}
            aria-label={mode === "form" ? "Back" : "Close"}
          >
            {mode === "form" ? (
              <ArrowLeft size={18} strokeWidth={2.2} />
            ) : (
              <X size={18} strokeWidth={2.2} />
            )}
          </button>

          <div className="sk-plans-modal__titles">
            <p className="sk-plans-modal__kicker">
              <Layers size={13} strokeWidth={2} aria-hidden="true" />
              Pricing
            </p>
            <h2 id="sk-plans-title">
              {mode === "form"
                ? editingId
                  ? "Edit plan"
                  : "New plan"
                : "Manage plans"}
            </h2>
            <p>
              {mode === "form"
                ? "Set amount, offer price, and duration in days, weeks, or months."
                : "Create and edit membership plans for Superkandle."}
            </p>
          </div>

          {mode === "list" ? (
            <button
              type="button"
              className="sk-plans-modal__cta"
              onClick={openCreate}
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              New plan
            </button>
          ) : null}
        </header>

        {error ? <p className="sk-plans-modal__error">{error}</p> : null}

        {mode === "form" ? (
          <form className="sk-plans-modal__form" onSubmit={handleSubmit}>
            <div className="sk-plans-modal__body">
              <div className="sk-plans-form-grid">
                <div className="field sk-plans-span">
                  <label htmlFor="skPlanName">Plan name</label>
                  <input
                    id="skPlanName"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Quarterly"
                    required
                    autoFocus
                  />
                </div>

                <div className="field">
                  <label htmlFor="skPlanAmount">Regular amount (USD)</label>
                  <input
                    id="skPlanAmount"
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
                  <label htmlFor="skPlanOffer">Offer price (optional)</label>
                  <input
                    id="skPlanOffer"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.offerPrice}
                    onChange={(e) =>
                      setForm({ ...form, offerPrice: e.target.value })
                    }
                    placeholder="Leave empty if none"
                  />
                </div>

                <div className="field sk-plans-span">
                  <label>Duration unit</label>
                  <div className="sk-duration-chips">
                    {[
                      { value: "day", label: "Days" },
                      { value: "week", label: "Weeks" },
                      { value: "month", label: "Months" },
                    ].map((unit) => (
                      <button
                        key={unit.value}
                        type="button"
                        className={`sk-duration-chip ${
                          form.durationUnit === unit.value ? "is-on" : ""
                        }`}
                        onClick={() =>
                          setForm({
                            ...form,
                            durationUnit: unit.value,
                            durationValue: String(
                              (durationSuggestions[unit.value] ||
                                FALLBACK_SUGGESTIONS[unit.value])[0]
                            ),
                          })
                        }
                      >
                        {unit.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field sk-plans-span">
                  <label>Suggested duration</label>
                  <div className="sk-duration-chips">
                    {suggestionValues.map((value) => (
                      <button
                        key={`${form.durationUnit}-${value}`}
                        type="button"
                        className={`sk-duration-chip ${
                          Number(form.durationValue) === value ? "is-on" : ""
                        }`}
                        onClick={() =>
                          setForm({
                            ...form,
                            durationValue: String(value),
                          })
                        }
                      >
                        {durationLabel(value, form.durationUnit)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="skPlanCustomDuration">
                    Custom ({unitWord(form.durationUnit, true)})
                  </label>
                  <input
                    id="skPlanCustomDuration"
                    type="number"
                    min="1"
                    step="1"
                    value={form.durationValue}
                    onChange={(e) =>
                      setForm({ ...form, durationValue: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="skPlanStatus">Status</label>
                  <select
                    id="skPlanStatus"
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

                <label className="sk-plans-default sk-plans-span">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) =>
                      setForm({ ...form, isDefault: e.target.checked })
                    }
                  />
                  <span className="sk-plans-default__box" aria-hidden="true" />
                  <span className="sk-plans-default__copy">
                    <strong>Set as default plan</strong>
                    <em>Used first when adding a new member.</em>
                  </span>
                </label>

                <label className="sk-plans-default sk-plans-span is-trial">
                  <input
                    type="checkbox"
                    checked={form.isTrial}
                    onChange={(e) => {
                      const isTrial = e.target.checked;
                      setForm({
                        ...form,
                        isTrial,
                        amount: isTrial ? "0" : form.amount === "0" ? "8" : form.amount,
                      });
                    }}
                  />
                  <span className="sk-plans-default__box" aria-hidden="true" />
                  <span className="sk-plans-default__copy">
                    <strong>Free trial plan</strong>
                    <em>Highlighted with a distinct color when selecting a plan.</em>
                  </span>
                </label>
              </div>
            </div>

            <footer className="sk-plans-modal__foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={backToList}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving
                  ? "Saving…"
                  : editingId
                    ? "Save changes"
                    : "Create plan"}
              </button>
            </footer>
          </form>
        ) : (
          <div className="sk-plans-modal__body">
            <div className="sk-plans-offer">
              <label className="sk-plans-default">
                <input
                  type="checkbox"
                  checked={displayPricedPlans}
                  onChange={(e) => togglePricedPlans(e.target.checked)}
                />
                <span className="sk-plans-default__box" aria-hidden="true" />
                <span className="sk-plans-default__copy">
                  <strong>Display priced plans</strong>
                  <em>
                    If this is off, students can only take a free plan. If there
                    is no free plan, they will see that there is no SuperKandle
                    offer.
                  </em>
                </span>
              </label>
              <button
                type="button"
                className="btn-secondary"
                onClick={resetTrials}
                disabled={resettingTrials}
              >
                <RotateCcw size={16} strokeWidth={2} aria-hidden="true" />
                {resettingTrials ? "Resetting…" : "Reset free trials"}
              </button>
            </div>
            {loading ? (
              <div className="sk-plans-empty">
                <strong>Loading plans</strong>
                <span>Fetching pricing options…</span>
              </div>
            ) : plans.length === 0 ? (
              <div className="sk-plans-empty">
                <strong>No plans yet</strong>
                <span>Create a day, week, or month based plan.</span>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={openCreate}
                >
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  New plan
                </button>
              </div>
            ) : (
              <ul className="sk-plans-grid">
                {plans.map((plan) => {
                  const hasOffer =
                    plan.offer_price != null && plan.offer_price !== "";
                  const value =
                    plan.duration_value || plan.duration_months || 1;
                  const unit = plan.duration_unit || "month";
                  return (
                    <li key={plan.id}>
                      <article
                        className={`sk-plan-tile sk-plan-tile--manage ${
                          plan.is_default ? "is-default" : ""
                        } ${plan.is_trial ? "is-trial" : ""} ${
                          plan.is_active ? "" : "is-off"
                        }`}
                      >
                        <div className="sk-plan-tile__top">
                          <span
                            className="sk-plan-tile__icon"
                            aria-hidden="true"
                          >
                            <Tag size={15} strokeWidth={2} />
                          </span>
                          <span className="sk-plan-tile__top-end">
                            {plan.is_trial ? (
                              <span className="sk-plan-tile__badge is-trial">
                                Trial
                              </span>
                            ) : null}
                            {plan.is_default ? (
                              <span className="sk-plan-tile__badge">
                                Default
                              </span>
                            ) : null}
                          </span>
                        </div>

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
                          <Clock3 size={12} strokeWidth={2} aria-hidden="true" />
                          {durationLabel(value, unit)}
                        </span>

                        <span className="sk-plan-tile__members">
                          {plan.member_count || 0} member
                          {(plan.member_count || 0) === 1 ? "" : "s"}
                          {!plan.is_active ? " · Inactive" : ""}
                        </span>

                        <div className="sk-plan-tile__actions">
                          <button
                            type="button"
                            className="sk-plans-action"
                            onClick={() => openEdit(plan)}
                          >
                            <Pencil
                              size={14}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="sk-plans-action is-danger"
                            onClick={() => handleDelete(plan)}
                            disabled={
                              plan.is_default || plan.member_count > 0
                            }
                            title={
                              plan.is_default
                                ? "Default plan cannot be deleted"
                                : plan.member_count > 0
                                  ? "Plan is in use"
                                  : "Delete plan"
                            }
                          >
                            <Trash2
                              size={14}
                              strokeWidth={2}
                              aria-hidden="true"
                            />
                            Delete
                          </button>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

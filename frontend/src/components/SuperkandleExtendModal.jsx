import { useState } from "react";
import { createPortal } from "react-dom";
import { CalendarPlus, X } from "lucide-react";

const PRESETS = [
  { id: "week", label: "1 week" },
  { id: "month", label: "1 month" },
  { id: "months3", label: "3 months" },
  { id: "months6", label: "6 months" },
  { id: "custom", label: "Custom date" },
];

function todayInput() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function SuperkandleExtendModal({
  member,
  name,
  currentExpiry,
  saving,
  onClose,
  onSave,
}) {
  const [preset, setPreset] = useState("month");
  const [customDate, setCustomDate] = useState(todayInput());

  return createPortal(
    <div
      className="sk-plans-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="sk-extend-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sk-extend-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sk-extend-head">
          <div>
            <p className="sk-pay-kicker">SuperKandle</p>
            <h2 id="sk-extend-title">Extend expiry</h2>
            <p className="sk-pay-sub">{name}</p>
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

        <div className="sk-extend-body">
          <p className="sk-extend-current">
            Current expiry <strong>{currentExpiry}</strong>
          </p>
          <div className="sk-extend-presets" role="group" aria-label="Extend by">
            {PRESETS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={preset === option.id ? "is-on" : ""}
                onClick={() => setPreset(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          {preset === "custom" ? (
            <label className="sk-extend-date">
              New expiry date
              <input
                type="date"
                min={todayInput()}
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            </label>
          ) : (
            <p className="sk-extend-hint">
              Time is added from today’s date, or from the current expiry if that
              is later.
            </p>
          )}
        </div>

        <footer className="sk-extend-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving || (preset === "custom" && !customDate)}
            onClick={() =>
              onSave({
                member,
                preset,
                expiresAt: preset === "custom" ? customDate : undefined,
              })
            }
          >
            <CalendarPlus size={16} strokeWidth={2} />
            {saving ? "Saving…" : "Extend"}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}

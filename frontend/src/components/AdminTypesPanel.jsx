import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Layers,
  Plus,
  Pencil,
  Trash2,
  X,
  Radio,
  Shield,
  Users,
} from "lucide-react";
import { api } from "../lib/api";
import { PORTAL_POWERS, isSuperAdmin, powerLabel } from "../lib/auth";
import { useFeedback } from "../lib/feedback";

const emptyForm = {
  name: "",
  description: "",
  isSignalOnly: false,
  isActive: true,
  powers: [],
};

export default function AdminTypesPanel({ onClose, onChanged }) {
  const { confirm, notify } = useFeedback();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [mode, setMode] = useState("list"); // list | form
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canGrantCreateAdmins = isSuperAdmin();

  const staffPowers = canGrantCreateAdmins
    ? PORTAL_POWERS
    : PORTAL_POWERS.filter((power) => power.key !== "create_admins");

  async function loadTypes() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/admin-types");
      setTypes(data.types || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTypes();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key !== "Escape") return;
      if (mode === "form") {
        setMode("list");
        setError("");
      } else {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setMode("form");
    setError("");
  }

  function openEdit(type) {
    setEditingId(type.id);
    setForm({
      name: type.name || "",
      description: type.description || "",
      isSignalOnly: Boolean(type.is_signal_only),
      isActive: Boolean(type.is_active),
      powers: type.is_signal_only ? [] : type.powers || [],
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

  function togglePower(powerKey) {
    if (form.isSignalOnly) return;
    setForm((prev) => {
      const exists = prev.powers.includes(powerKey);
      return {
        ...prev,
        powers: exists
          ? prev.powers.filter((item) => item !== powerKey)
          : [...prev.powers, powerKey],
      };
    });
  }

  function handleSignalOnlyChange(checked) {
    setForm((prev) => ({
      ...prev,
      isSignalOnly: checked,
      powers: checked ? [] : prev.powers,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const payload = {
        name: form.name,
        description: form.description,
        isSignalOnly: form.isSignalOnly,
        isActive: form.isActive,
        powers: form.isSignalOnly ? ["give_signals"] : form.powers,
      };

      if (!form.isSignalOnly && !payload.powers.length) {
        throw new Error(
          "Select at least one power, or enable Signal giving only"
        );
      }

      if (editingId) {
        await api(`/api/admin-types/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/admin-types", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      backToList();
      await loadTypes();
      await onChanged?.();
      notify({
        title: editingId ? "Admin type updated" : "Admin type created",
        message: editingId
          ? "Powers and type settings were saved successfully."
          : "The new admin type is available when creating portal admins.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(type) {
    if (type.admin_count > 0) {
      setError("Cannot delete a type assigned to admins. Reassign them first.");
      return;
    }
    const ok = await confirm({
      title: "Delete admin type",
      message: `“${type.name}” will be permanently removed. Existing admins using another type are not affected.`,
      confirmLabel: "Delete type",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api(`/api/admin-types/${type.id}`, { method: "DELETE" });
      await loadTypes();
      await onChanged?.();
      notify({
        title: "Admin type deleted",
        message: "The admin type has been removed.",
      });
    } catch (err) {
      setError(err.message);
    }
  }

  const modal = (
    <div
      className="atype-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="atype-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atype-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="atype-modal__head">
          <button
            type="button"
            className="atype-modal__icon-btn"
            onClick={mode === "form" ? backToList : onClose}
            aria-label={mode === "form" ? "Back" : "Close"}
          >
            {mode === "form" ? (
              <ArrowLeft size={18} strokeWidth={2.2} />
            ) : (
              <X size={18} strokeWidth={2.2} />
            )}
          </button>
          <div className="atype-modal__titles">
            <p className="atype-modal__kicker">
              <Layers size={13} strokeWidth={2} aria-hidden="true" />
              Role setup
            </p>
            <h2 id="atype-modal-title">
              {mode === "form"
                ? editingId
                  ? "Edit admin type"
                  : "New admin type"
                : "Admin types"}
            </h2>
            <p>
              {mode === "form"
                ? "Name the type, then choose powers. Admins inherit them."
                : "Create roles and assign powers once — all admins of that type get them."}
            </p>
          </div>
          {mode === "list" ? (
            <button
              type="button"
              className="atype-modal__add"
              onClick={openCreate}
            >
              <Plus size={16} strokeWidth={2} aria-hidden="true" />
              New type
            </button>
          ) : null}
        </header>

        {error ? <p className="atype-modal__error">{error}</p> : null}

        {mode === "list" ? (
          <div className="atype-modal__body">
            {loading ? (
              <div className="atype-modal__empty">
                <strong>Loading types</strong>
                <span>Fetching admin roles…</span>
              </div>
            ) : types.length === 0 ? (
              <div className="atype-modal__empty">
                <strong>No types yet</strong>
                <span>Create Portal staff, Signal giver, or any custom type.</span>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={openCreate}
                >
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  New type
                </button>
              </div>
            ) : (
              <ul className="atype-modal__list">
                {types.map((type) => (
                  <li
                    key={type.id}
                    className={`atype-modal__item ${
                      type.is_signal_only ? "is-signal" : ""
                    } ${type.is_active ? "" : "is-off"}`}
                    onClick={() => openEdit(type)}
                  >
                    <span
                      className={`atype-modal__avatar ${
                        type.is_signal_only ? "is-signal" : ""
                      }`}
                      aria-hidden="true"
                    >
                      {type.is_signal_only ? (
                        <Radio size={18} strokeWidth={2} />
                      ) : (
                        <Shield size={18} strokeWidth={2} />
                      )}
                    </span>

                    <div className="atype-modal__item-main">
                      <div className="atype-modal__item-title">
                        <h3>{type.name}</h3>
                        {type.is_signal_only ? (
                          <span className="atype-pill is-signal">
                            Signal only
                          </span>
                        ) : null}
                        <span
                          className={`atype-pill ${
                            type.is_active ? "is-on" : "is-off"
                          }`}
                        >
                          {type.is_active ? "Active" : "Disabled"}
                        </span>
                      </div>
                      <p>{type.description || "No description"}</p>
                      <div className="atype-modal__chips">
                        {(type.powers || []).length ? (
                          type.powers.map((power) => (
                            <span
                              key={power}
                              className={`atype-chip ${
                                power === "give_signals" ||
                                power === "create_admins"
                                  ? "is-key"
                                  : ""
                              }`}
                            >
                              {powerLabel(power)}
                            </span>
                          ))
                        ) : (
                          <span className="atype-chip is-empty">No powers</span>
                        )}
                      </div>
                      <span className="atype-modal__count">
                        <Users size={13} strokeWidth={2} aria-hidden="true" />
                        {type.admin_count || 0} admin
                        {(type.admin_count || 0) === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div
                      className="atype-modal__item-actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        type="button"
                        className="atype-mini-btn"
                        onClick={() => openEdit(type)}
                      >
                        <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="atype-mini-btn is-danger"
                        onClick={() => handleDelete(type)}
                      >
                        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <form className="atype-modal__form" onSubmit={handleSubmit}>
            <div className="atype-modal__form-scroll">
              <div className="atype-modal__fields">
                <div className="field">
                  <label htmlFor="adminTypeName">Type name</label>
                  <input
                    id="adminTypeName"
                    value={form.name}
                    onChange={(e) =>
                      setForm({ ...form, name: e.target.value })
                    }
                    placeholder="e.g. Portal staff"
                    required
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label htmlFor="adminTypeStatus">Status</label>
                  <select
                    id="adminTypeStatus"
                    value={form.isActive ? "active" : "inactive"}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        isActive: e.target.value === "active",
                      })
                    }
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Disabled</option>
                  </select>
                </div>
                <div className="field field-span">
                  <label htmlFor="adminTypeDescription">Description</label>
                  <textarea
                    id="adminTypeDescription"
                    rows={2}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Short note about this admin type"
                  />
                </div>
              </div>

              <div className="atype-modal__powers">
                <div className="atype-modal__powers-head">
                  <h3>Powers</h3>
                  <span>
                    {form.isSignalOnly
                      ? "Signal only"
                      : `${form.powers.length} selected`}
                  </span>
                </div>

                <label className="atype-signal-only">
                  <input
                    type="checkbox"
                    checked={form.isSignalOnly}
                    onChange={(e) => handleSignalOnlyChange(e.target.checked)}
                  />
                  <span className="atype-signal-only__box" aria-hidden="true" />
                  <span className="atype-signal-only__copy">
                    <strong>Signal giving only</strong>
                    <em>
                      If checked, other powers are locked and Give signals is
                      applied automatically.
                    </em>
                  </span>
                </label>

                {form.isSignalOnly ? (
                  <div className="atype-signal-banner">
                    <Radio size={16} strokeWidth={2} aria-hidden="true" />
                    <div>
                      <strong>Give signals</strong>
                      <span>Applied automatically for this type.</span>
                    </div>
                  </div>
                ) : (
                  <div className="atype-modal__power-grid">
                    {staffPowers.map((power) => {
                      const checked = form.powers.includes(power.key);
                      return (
                        <label
                          key={power.key}
                          className={`atype-power ${checked ? "is-on" : ""} ${
                            power.key === "give_signals" ||
                            power.key === "create_admins"
                              ? "is-key"
                              : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePower(power.key)}
                          />
                          <span
                            className="atype-power__tick"
                            aria-hidden="true"
                          />
                          <span className="atype-power__copy">
                            <strong>{power.label}</strong>
                            <em>{power.description}</em>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {!form.isSignalOnly && !canGrantCreateAdmins ? (
                  <p className="atype-powers__note">
                    Only super admin can grant “Create other admins”.
                  </p>
                ) : null}
              </div>
            </div>

            <footer className="atype-modal__foot">
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
                    : "Create type"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

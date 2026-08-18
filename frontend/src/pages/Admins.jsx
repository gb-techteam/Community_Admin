import { useEffect, useMemo, useState } from "react";
import {
  Shield,
  Plus,
  Search,
  Pencil,
  Trash2,
  UserCog,
  Radio,
  ShieldCheck,
  KeyRound,
  Layers,
} from "lucide-react";
import { api } from "../lib/api";
import { powerLabel } from "../lib/auth";
import { useFeedback } from "../lib/feedback";
import AdminTypesPanel from "../components/AdminTypesPanel";

const emptyForm = {
  adminId: "",
  name: "",
  email: "",
  password: "",
  adminTypeId: "",
  isActive: true,
};

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

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function Admins() {
  const { confirm, notify } = useFeedback();
  const [admins, setAdmins] = useState([]);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showTypes, setShowTypes] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");

  const activeTypes = useMemo(
    () => types.filter((type) => type.is_active),
    [types]
  );

  const selectedType = useMemo(
    () => types.find((type) => String(type.id) === String(form.adminTypeId)),
    [types, form.adminTypeId]
  );

  const stats = useMemo(() => {
    const signal = admins.filter(
      (a) => a.is_signal_only || a.admin_type === "signal_giver"
    );
    const staff = admins.filter(
      (a) => !(a.is_signal_only || a.admin_type === "signal_giver")
    );
    const active = admins.filter((a) => a.is_active);
    return {
      total: admins.length,
      staff: staff.length,
      signal: signal.length,
      active: active.length,
    };
  }, [admins]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return admins.filter((admin) => {
      if (typeFilter !== "all" && String(admin.admin_type_id) !== typeFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [
        admin.name,
        admin.admin_id,
        admin.email,
        admin.type_name,
        ...(admin.powers || []).map(powerLabel),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [admins, search, typeFilter]);

  async function loadAdmins() {
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/portal-admins");
      setAdmins(data.admins || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadTypes() {
    try {
      const data = await api("/api/admin-types");
      setTypes(data.types || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadAdmins();
    loadTypes();
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      adminTypeId: activeTypes[0] ? String(activeTypes[0].id) : "",
    });
    setShowForm(true);
    setShowTypes(false);
    setError("");
  }

  function openEdit(admin) {
    setEditingId(admin.id);
    setForm({
      adminId: admin.admin_id || "",
      name: admin.name || "",
      email: admin.email || "",
      password: "",
      adminTypeId: admin.admin_type_id ? String(admin.admin_type_id) : "",
      isActive: Boolean(admin.is_active),
    });
    setShowForm(true);
    setShowTypes(false);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      if (!form.adminTypeId) {
        throw new Error("Select an admin type");
      }

      const payload = {
        adminId: form.adminId,
        name: form.name,
        email: form.email,
        adminTypeId: Number(form.adminTypeId),
        isActive: form.isActive,
      };

      if (form.password.trim()) {
        payload.password = form.password;
      }

      if (editingId) {
        await api(`/api/portal-admins/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        if (!form.password.trim()) {
          throw new Error("Password is required for new admins");
        }
        payload.password = form.password;
        await api("/api/portal-admins", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await loadAdmins();
      notify({
        title: editingId ? "Admin updated" : "Admin created",
        message: editingId
          ? "Portal admin details were saved successfully."
          : "The new portal admin can sign in with their credentials.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    const ok = await confirm({
      title: "Delete portal admin",
      message:
        "This account will lose portal access immediately. This action cannot be undone.",
      confirmLabel: "Delete admin",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api(`/api/portal-admins/${id}`, { method: "DELETE" });
      await loadAdmins();
      notify({
        title: "Admin deleted",
        message: "The portal admin account has been removed.",
      });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="portal-page admins-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <Shield size={14} strokeWidth={2} aria-hidden="true" />
            Access control
          </p>
          <h1>Admins</h1>
          <p>
            Create admins by type. Manage type powers from Admin type
            management.
          </p>
        </div>
        <div className="admins-header-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setShowTypes(true);
              setShowForm(false);
            }}
          >
            <Layers size={16} strokeWidth={2} aria-hidden="true" />
            Admin types
          </button>
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Add admin
          </button>
        </div>
      </header>

      <section className="admins-stats" aria-label="Admin summary">
        <article className="admins-stat">
          <span className="admins-stat__icon" aria-hidden="true">
            <ShieldCheck size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.total}</strong>
            <span>Total admins</span>
          </div>
        </article>
        <article className="admins-stat">
          <span className="admins-stat__icon admins-stat__icon--staff" aria-hidden="true">
            <UserCog size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.staff}</strong>
            <span>Portal staff</span>
          </div>
        </article>
        <article className="admins-stat">
          <span className="admins-stat__icon admins-stat__icon--signal" aria-hidden="true">
            <Radio size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.signal}</strong>
            <span>Signal givers</span>
          </div>
        </article>
        <article className="admins-stat">
          <span className="admins-stat__icon admins-stat__icon--active" aria-hidden="true">
            <KeyRound size={18} strokeWidth={2} />
          </span>
          <div className="admins-stat__body">
            <strong>{loading ? "—" : stats.active}</strong>
            <span>Active now</span>
          </div>
        </article>
      </section>

      {error ? <p className="portal-alert">{error}</p> : null}

      {showTypes ? (
        <AdminTypesPanel
          onClose={() => setShowTypes(false)}
          onChanged={async () => {
            await loadTypes();
            await loadAdmins();
          }}
        />
      ) : null}

      {showForm ? (
        <form className="entity-form admins-form" onSubmit={handleSubmit}>
          <div className="entity-form__header">
            <div>
              <h2>{editingId ? "Edit admin" : "New admin"}</h2>
              <p className="muted" style={{ marginTop: "0.3rem" }}>
                Choose an admin type. Powers come from that type.
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowForm(false)}
            >
              Close
            </button>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="portalAdminId">Admin ID</label>
              <input
                id="portalAdminId"
                value={form.adminId}
                onChange={(e) => setForm({ ...form, adminId: e.target.value })}
                placeholder="login id"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="portalAdminName">Name</label>
              <input
                id="portalAdminName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Full name"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="portalAdminEmail">Email</label>
              <input
                id="portalAdminEmail"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="portalAdminPassword">
                Password {editingId ? "(leave blank to keep)" : ""}
              </label>
              <input
                id="portalAdminPassword"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required={!editingId}
              />
            </div>
            <div className="field">
              <label htmlFor="portalAdminType">Admin type</label>
              <select
                id="portalAdminType"
                value={form.adminTypeId}
                onChange={(e) =>
                  setForm({ ...form, adminTypeId: e.target.value })
                }
                required
              >
                <option value="">Select type</option>
                {activeTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                    {type.is_signal_only ? " (signal only)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="portalAdminStatus">Status</label>
              <select
                id="portalAdminStatus"
                value={form.isActive ? "active" : "inactive"}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.value === "active" })
                }
              >
                <option value="active">Active</option>
                <option value="inactive">Disabled</option>
              </select>
            </div>
          </div>

          {selectedType ? (
            <div className="admin-type-preview">
              <strong>
                Powers from “{selectedType.name}”
                {selectedType.is_signal_only ? " · Signal only" : ""}
              </strong>
              <div className="admins-power-row">
                {(selectedType.powers || []).length ? (
                  selectedType.powers.map((power) => (
                    <span
                      key={power}
                      className={`admins-power ${
                        power === "give_signals" || power === "create_admins"
                          ? "is-key"
                          : ""
                      }`}
                    >
                      {powerLabel(power)}
                    </span>
                  ))
                ) : (
                  <span className="admins-power is-empty">No powers</span>
                )}
              </div>
            </div>
          ) : (
            <p className="muted">
              No types available. Open Admin types to create one first.
            </p>
          )}

          <div className="entity-form__actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? "Saving…"
                : editingId
                  ? "Update admin"
                  : "Create admin"}
            </button>
          </div>
        </form>
      ) : null}

      <section className="admins-panel">
        <div className="admins-panel__toolbar">
          <div className="admins-search">
            <Search size={16} strokeWidth={2} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, login id, email, type…"
            />
          </div>
          <div className="admins-filters">
            <button
              type="button"
              className={`admins-filter ${typeFilter === "all" ? "is-active" : ""}`}
              onClick={() => setTypeFilter("all")}
            >
              All
            </button>
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                className={`admins-filter ${
                  typeFilter === String(type.id) ? "is-active" : ""
                }`}
                onClick={() => setTypeFilter(String(type.id))}
              >
                {type.name}
              </button>
            ))}
          </div>
        </div>

        <div className="admins-panel__meta">
          <strong>{loading ? "…" : filtered.length}</strong>
          <span>
            {typeFilter === "all" ? "admins shown" : "matching filters"}
          </span>
        </div>

        {loading ? (
          <div className="admins-empty">
            <strong>Loading admins</strong>
            <span>Fetching portal accounts…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="admins-empty">
            <strong>{admins.length ? "No matches" : "No admins yet"}</strong>
            <span>
              {admins.length
                ? "Try another search or filter."
                : "Create an admin type, then add an admin."}
            </span>
          </div>
        ) : (
          <ul className="admins-list">
            {filtered.map((admin) => {
              const isSignal =
                Boolean(admin.is_signal_only) ||
                admin.admin_type === "signal_giver";
              const powers = admin.powers || [];
              const visiblePowers = powers.slice(0, 3);
              const extraPowers = powers.length - visiblePowers.length;

              return (
                <li
                  key={admin.id}
                  className={`admins-card ${isSignal ? "is-signal" : ""} ${
                    admin.is_active ? "" : "is-disabled"
                  }`}
                >
                  <div className="admins-card__main">
                    <span
                      className={`admins-avatar ${isSignal ? "is-signal" : ""}`}
                      aria-hidden="true"
                    >
                      {initials(admin.name)}
                    </span>

                    <div className="admins-card__identity">
                      <div className="admins-card__title-row">
                        <h3>{admin.name}</h3>
                        <span
                          className={`admins-type ${
                            isSignal ? "is-signal" : "is-staff"
                          }`}
                        >
                          {admin.type_name ||
                            (isSignal ? "Signal giver" : "Portal staff")}
                        </span>
                        <span
                          className={`admins-status ${
                            admin.is_active ? "is-on" : "is-off"
                          }`}
                        >
                          {admin.is_active ? "Active" : "Disabled"}
                        </span>
                      </div>
                      <p>
                        <code>{admin.admin_id}</code>
                        <span>·</span>
                        <em>{admin.email || "No email"}</em>
                      </p>
                    </div>
                  </div>

                  <div className="admins-card__powers">
                    <span className="admins-card__powers-label">
                      Type powers
                    </span>
                    {powers.length ? (
                      <div className="admins-power-row">
                        {visiblePowers.map((power) => (
                          <span
                            key={power}
                            className={`admins-power ${
                              power === "give_signals" ||
                              power === "create_admins"
                                ? "is-key"
                                : ""
                            }`}
                          >
                            {powerLabel(power)}
                          </span>
                        ))}
                        {extraPowers > 0 ? (
                          <span className="admins-power is-more">
                            +{extraPowers}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="admins-power is-empty">No powers</span>
                    )}
                  </div>

                  <div className="admins-card__side">
                    <span className="admins-card__date">
                      Joined {formatDate(admin.created_at)}
                    </span>
                    <div className="admins-card__actions">
                      <button
                        type="button"
                        className="admins-action"
                        onClick={() => openEdit(admin)}
                      >
                        <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="admins-action is-danger"
                        onClick={() => handleDelete(admin.id)}
                      >
                        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

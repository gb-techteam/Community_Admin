import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";
import { EntityCell, MetricCell } from "../components/TableCells";
import CrmDisclaimer from "../components/CrmDisclaimer";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  telegramUser: "",
  tradingviewUsername: "",
};

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
}

function displayValue(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function formatDate(value) {
  if (!value) return "—";
  const text = String(value).slice(0, 10);
  return text || "—";
}

function formFromStudent(student) {
  return {
    firstName: student.first_name || "",
    lastName: student.last_name || "",
    email: student.email || "",
    phone: student.phone || "",
    address: student.address || "",
    dateOfBirth: student.date_of_birth
      ? String(student.date_of_birth).slice(0, 10)
      : "",
    telegramUser: student.telegram_user || "",
    tradingviewUsername: student.tradingview_username || "",
  };
}

function BatchTags({ value }) {
  if (!value) return <span className="cell-muted">No batch</span>;
  const items = value.split(", ").filter(Boolean);
  return (
    <div className="tag-row">
      {items.map((item) => (
        <span key={item} className="tag">
          {item}
        </span>
      ))}
    </div>
  );
}

export default function Students() {
  const { notify } = useFeedback();
  const [students, setStudents] = useState([]);
  const [batches, setBatches] = useState([]);
  const [search, setSearch] = useState("");
  const [batchFilter, setBatchFilter] = useState("all");
  const [form, setForm] = useState(emptyForm);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadBatches() {
    try {
      const data = await api("/api/batches");
      setBatches(data.batches);
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadStudents(query = search, batchId = batchFilter) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (batchId && batchId !== "all") params.set("batchId", batchId);

      const data = await api(
        `/api/students${params.toString() ? `?${params.toString()}` : ""}`
      );
      setStudents(data.students);
      setSelectedStudent((current) => {
        if (!current) return current;
        return data.students.find((row) => row.id === current.id) || current;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBatches();
    loadStudents("", "all");
  }, []);

  function openView(student) {
    setSelectedStudent(student);
    setForm(formFromStudent(student));
    setIsEditing(false);
    setError("");
  }

  function closePanel() {
    setSelectedStudent(null);
    setIsEditing(false);
    setForm(emptyForm);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!selectedStudent) return;

    setSaving(true);
    setError("");

    try {
      await api(`/api/students/${selectedStudent.id}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });

      setIsEditing(false);
      await loadStudents();
      notify({
        title: "Student updated",
        message: "Student profile changes were saved successfully.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleBatchFilter(value) {
    setBatchFilter(value);
    loadStudents(search, value);
  }

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <Users size={14} strokeWidth={2} aria-hidden="true" />
            Management
          </p>
          <h1>Students</h1>
          <p>
            Students come from CRM. View, filter, and update learner profiles
            here.
          </p>
        </div>
      </header>

      <CrmDisclaimer entity="students" />

      <div className="filter-bar">
        <div className="filter-bar__search">
          <input
            type="search"
            placeholder="Search name, email, phone, Telegram, or TradingView"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadStudents(search, batchFilter);
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => loadStudents(search, batchFilter)}
          >
            Search
          </button>
        </div>

        <div className="filter-bar__select">
          <label htmlFor="batchFilter">Batch</label>
          <select
            id="batchFilter"
            value={batchFilter}
            onChange={(e) => handleBatchFilter(e.target.value)}
          >
            <option value="all">All batches</option>
            {batches.map((batch) => (
              <option key={batch.id} value={batch.id}>
                {batch.name} ({batch.student_count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <p className="portal-alert">{error}</p> : null}

      {selectedStudent && !isEditing ? (
        <section className="entity-form student-detail">
          <div className="entity-form__header">
            <h2>
              {fullName(selectedStudent.first_name, selectedStudent.last_name)}
            </h2>
            <button type="button" className="btn-ghost" onClick={closePanel}>
              Close
            </button>
          </div>

          <div className="student-detail__ids">
            <div className="student-detail__id-card">
              <span>Telegram ID</span>
              <strong>{displayValue(selectedStudent.telegram_user)}</strong>
            </div>
            <div className="student-detail__id-card">
              <span>TradingView ID</span>
              <strong>
                {displayValue(selectedStudent.tradingview_username)}
              </strong>
            </div>
          </div>

          <dl className="student-detail__dl">
            <div className="student-detail__item">
              <dt>Email</dt>
              <dd>{displayValue(selectedStudent.email)}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Phone</dt>
              <dd>{displayValue(selectedStudent.phone, "No phone")}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Date of birth</dt>
              <dd>{formatDate(selectedStudent.date_of_birth)}</dd>
            </div>
            <div className="student-detail__item">
              <dt>Courses</dt>
              <dd>{selectedStudent.course_count ?? 0} enrolled</dd>
            </div>
            <div className="student-detail__item student-detail__item--span">
              <dt>Batch</dt>
              <dd>
                <BatchTags value={selectedStudent.batch_names} />
              </dd>
            </div>
            <div className="student-detail__item student-detail__item--span">
              <dt>Address</dt>
              <dd>{displayValue(selectedStudent.address)}</dd>
            </div>
          </dl>

          <div className="entity-form__actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setIsEditing(true)}
            >
              Edit student
            </button>
          </div>
        </section>
      ) : null}

      {selectedStudent && isEditing ? (
        <form className="entity-form" onSubmit={handleSubmit}>
          <div className="entity-form__header">
            <h2>Edit student</h2>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setIsEditing(false)}
            >
              Back to details
            </button>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="firstName">First name</label>
              <input
                id="firstName"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="lastName">Last name</label>
              <input
                id="lastName"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="dateOfBirth">Date of birth</label>
              <input
                id="dateOfBirth"
                type="date"
                value={form.dateOfBirth}
                onChange={(e) =>
                  setForm({ ...form, dateOfBirth: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="telegramUser">Telegram ID</label>
              <input
                id="telegramUser"
                value={form.telegramUser}
                onChange={(e) =>
                  setForm({ ...form, telegramUser: e.target.value })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="tradingviewUsername">TradingView ID</label>
              <input
                id="tradingviewUsername"
                value={form.tradingviewUsername}
                onChange={(e) =>
                  setForm({ ...form, tradingviewUsername: e.target.value })
                }
              />
            </div>
            <div className="field field-span">
              <label htmlFor="address">Address</label>
              <textarea
                id="address"
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
          </div>

          <div className="entity-form__actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Update student"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-shell">
        <div className="table-shell__meta">
          <div className="table-shell__meta-left">
            <strong>{loading ? "…" : students.length}</strong>
            <span>
              {batchFilter === "all"
                ? "students in all batches"
                : "students in selected batch"}
            </span>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Contact</th>
                <th>Batch</th>
                <th className="is-num">Courses</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="table-empty">
                    <div className="table-empty__box">
                      <strong>Loading students</strong>
                      <span>Fetching student records…</span>
                    </div>
                  </td>
                </tr>
              ) : students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="table-empty">
                    <div className="table-empty__box">
                      <strong>No students found</strong>
                      <span>Try another batch filter or search term.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <EntityCell
                        title={fullName(student.first_name, student.last_name)}
                        subtitle={`ID #${student.id}`}
                        tone="forest"
                      />
                    </td>
                    <td>
                      <div className="cell-stack">
                        <span>{student.email || "—"}</span>
                        <span className="cell-muted">
                          {student.phone || "No phone"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <BatchTags value={student.batch_names} />
                    </td>
                    <td className="is-num">
                      <MetricCell value={student.course_count} label="enrolled" />
                    </td>
                    <td className="is-actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => openView(student)}
                        >
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

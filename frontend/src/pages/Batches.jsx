import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";
import { EntityCell, MetricCell } from "../components/TableCells";
import CrmDisclaimer from "../components/CrmDisclaimer";

const emptyForm = {
  name: "",
  courseId: "",
  startDate: "",
  endDate: "",
  status: "active",
  isOpen: true,
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

export default function Batches() {
  const { notify } = useFeedback();
  const [batches, setBatches] = useState([]);
  const [courses, setCourses] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [batchData, courseData] = await Promise.all([
        api("/api/batches"),
        api("/api/courses"),
      ]);
      setBatches(batchData.batches);
      setCourses(courseData.courses);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filtered = batches.filter((batch) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      batch.name?.toLowerCase().includes(q) ||
      batch.course_title?.toLowerCase().includes(q) ||
      batch.status?.toLowerCase().includes(q)
    );
  });

  function openEdit(batch) {
    setEditingId(batch.id);
    setForm({
      name: batch.name || "",
      courseId: batch.course_id ? String(batch.course_id) : "",
      startDate: batch.start_date ? String(batch.start_date).slice(0, 10) : "",
      endDate: batch.end_date ? String(batch.end_date).slice(0, 10) : "",
      status: batch.status || "active",
      isOpen: Boolean(batch.is_open),
    });
    setShowForm(true);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!editingId) return;

    setSaving(true);
    setError("");

    const payload = {
      name: form.name,
      courseId: form.courseId ? Number(form.courseId) : null,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      status: form.status,
      isOpen: form.isOpen,
    };

    try {
      await api(`/api/batches/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await loadData();
      notify({
        title: "Batch updated",
        message: "Batch details were saved successfully.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <Layers size={14} strokeWidth={2} aria-hidden="true" />
            Management
          </p>
          <h1>Batches</h1>
          <p>
            Batches come from CRM. View, filter, and update batch details here.
          </p>
        </div>
      </header>

      <CrmDisclaimer entity="batches" />

      <div className="filter-bar">
        <div className="filter-bar__search">
          <input
            type="search"
            placeholder="Search batch, course, or status"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error ? <p className="portal-alert">{error}</p> : null}

      {showForm && editingId ? (
        <form className="entity-form" onSubmit={handleSubmit}>
          <div className="entity-form__header">
            <h2>Edit batch</h2>
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
              <label htmlFor="batchName">Batch name</label>
              <input
                id="batchName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="batchCourse">Course</label>
              <select
                id="batchCourse"
                value={form.courseId}
                onChange={(e) => setForm({ ...form, courseId: e.target.value })}
              >
                <option value="">Select course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="startDate">Start date</label>
              <input
                id="startDate"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="endDate">End date</label>
              <input
                id="endDate"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="batchStatus">Status</label>
              <select
                id="batchStatus"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="completed">Completed</option>
                <option value="upcoming">Upcoming</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="isOpen">Admission</label>
              <select
                id="isOpen"
                value={form.isOpen ? "open" : "closed"}
                onChange={(e) =>
                  setForm({ ...form, isOpen: e.target.value === "open" })
                }
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>

          <div className="entity-form__actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Update batch"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-shell">
        <div className="table-shell__meta">
          <div className="table-shell__meta-left">
            <strong>{loading ? "…" : filtered.length}</strong>
            <span>batches</span>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Batch</th>
                <th>Course</th>
                <th>Duration</th>
                <th className="is-num">Students</th>
                <th>Status</th>
                <th>Admission</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    <div className="table-empty__box">
                      <strong>Loading batches</strong>
                      <span>Fetching batch records…</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    <div className="table-empty__box">
                      <strong>No batches found</strong>
                      <span>Batches are managed in CRM. Adjust your search.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((batch) => (
                  <tr key={batch.id}>
                    <td>
                      <EntityCell
                        title={batch.name}
                        subtitle={`ID #${batch.id}`}
                        tone="amber"
                      />
                    </td>
                    <td>{batch.course_title || "—"}</td>
                    <td>
                      <div className="cell-stack">
                        <span className="cell-date">{formatDate(batch.start_date)}</span>
                        <span className="cell-muted">
                          to {formatDate(batch.end_date)}
                        </span>
                      </div>
                    </td>
                    <td className="is-num">
                      <MetricCell value={batch.student_count} label="students" />
                    </td>
                    <td>
                      <span
                        className={`status-pill status-${String(batch.status || "").toLowerCase()}`}
                      >
                        {batch.status || "—"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${batch.is_open ? "status-active" : "status-inactive"}`}
                      >
                        {batch.is_open ? "Open" : "Closed"}
                      </span>
                    </td>
                    <td className="is-actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => openEdit(batch)}
                        >
                          Edit
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

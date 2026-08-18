import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";
import { EntityCell, MetricCell } from "../components/TableCells";
import CrmDisclaimer from "../components/CrmDisclaimer";

const emptyForm = {
  title: "",
  description: "",
  duration: "",
  price: "",
  status: "active",
};

export default function Courses() {
  const { notify } = useFeedback();
  const [courses, setCourses] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadCourses(query = search) {
    setLoading(true);
    setError("");
    try {
      const data = await api(
        `/api/courses${query ? `?search=${encodeURIComponent(query)}` : ""}`
      );
      setCourses(data.courses);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCourses("");
  }, []);

  function openEdit(course) {
    setEditingId(course.id);
    setForm({
      title: course.title || "",
      description: course.description || "",
      duration: course.duration || "",
      price: course.price ?? "",
      status: course.status || "active",
    });
    setShowForm(true);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!editingId) return;

    setSaving(true);
    setError("");

    try {
      await api(`/api/courses/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(form),
      });

      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await loadCourses();
      notify({
        title: "Course updated",
        message: "Course details were saved successfully.",
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
            <BookOpen size={14} strokeWidth={2} aria-hidden="true" />
            Management
          </p>
          <h1>Courses</h1>
          <p>
            Courses come from CRM. View, filter, and update catalog details
            here.
          </p>
        </div>
      </header>

      <CrmDisclaimer entity="courses" />

      <div className="filter-bar">
        <div className="filter-bar__search">
          <input
            type="search"
            placeholder="Search by title, description, or status"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadCourses(search);
            }}
          />
          <button type="button" className="btn-secondary" onClick={() => loadCourses(search)}>
            Search
          </button>
        </div>
      </div>

      {error ? <p className="portal-alert">{error}</p> : null}

      {showForm && editingId ? (
        <form className="entity-form" onSubmit={handleSubmit}>
          <div className="entity-form__header">
            <h2>Edit course</h2>
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
              <label htmlFor="title">Title</label>
              <input
                id="title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="duration">Duration</label>
              <input
                id="duration"
                value={form.duration}
                onChange={(e) => setForm({ ...form, duration: e.target.value })}
                placeholder="e.g. 8 weeks"
              />
            </div>
            <div className="field">
              <label htmlFor="price">Price</label>
              <input
                id="price"
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="courseStatus">Status</label>
              <select
                id="courseStatus"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div className="field field-span">
              <label htmlFor="description">Description</label>
              <textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </div>
          </div>

          <div className="entity-form__actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Update course"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-shell">
        <div className="table-shell__meta">
          <div className="table-shell__meta-left">
            <strong>{loading ? "…" : courses.length}</strong>
            <span>courses</span>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Duration</th>
                <th>Price</th>
                <th className="is-num">Students</th>
                <th>Status</th>
                <th className="is-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="table-empty">
                    <div className="table-empty__box">
                      <strong>Loading courses</strong>
                      <span>Fetching course catalog…</span>
                    </div>
                  </td>
                </tr>
              ) : courses.length === 0 ? (
                <tr>
                  <td colSpan={6} className="table-empty">
                    <div className="table-empty__box">
                      <strong>No courses found</strong>
                      <span>Courses are managed in CRM.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                courses.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <EntityCell
                        title={course.title}
                        subtitle={`ID #${course.id}`}
                        tone="sage"
                      />
                    </td>
                    <td>{course.duration || "—"}</td>
                    <td>
                      {course.price != null && course.price !== ""
                        ? Number(course.price).toLocaleString("en-IN")
                        : "—"}
                    </td>
                    <td className="is-num">
                      <MetricCell value={course.student_count} label="students" />
                    </td>
                    <td>
                      <span
                        className={`status-pill status-${String(course.status || "").toLowerCase()}`}
                      >
                        {course.status || "—"}
                      </span>
                    </td>
                    <td className="is-actions">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          onClick={() => openEdit(course)}
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

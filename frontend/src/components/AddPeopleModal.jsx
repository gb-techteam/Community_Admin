import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  Layers,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { useFeedback } from "../lib/feedback";
import { hasPower } from "../lib/auth";

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
}

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function personKey(kind, id) {
  return `${kind}:${id}`;
}

export default function AddPeopleModal({ channel, onClose, onChanged }) {
  const { confirm, notify } = useFeedback();
  const canViewPeople = hasPower("view_channel_people");
  const canManagePeople = hasPower("manage_channels");
  const [mode, setMode] = useState("view"); // view | add
  const [addTab, setAddTab] = useState("people"); // people | batch
  const [query, setQuery] = useState("");
  const [batchQuery, setBatchQuery] = useState("");
  const [admins, setAdmins] = useState([]);
  const [students, setStudents] = useState([]);
  const [batches, setBatches] = useState([]);
  const [channelAdmins, setChannelAdmins] = useState([]);
  const [channelMembers, setChannelMembers] = useState([]);
  const [adminCount, setAdminCount] = useState(0);
  const [memberCount, setMemberCount] = useState(0);
  const [canViewDetails, setCanViewDetails] = useState(canViewPeople);
  const [selected, setSelected] = useState([]);
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [loadingChannel, setLoadingChannel] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef(null);
  const requestId = useRef(0);

  const alreadyAdminIds = useMemo(
    () => new Set(channelAdmins.map((row) => row.portal_admin_id)),
    [channelAdmins]
  );
  const alreadyMemberIds = useMemo(
    () => new Set(channelMembers.map((row) => row.student_id)),
    [channelMembers]
  );

  const totalInChannel = canViewDetails
    ? channelAdmins.length + channelMembers.length
    : adminCount + memberCount;
  const selectedBatchCount = batches
    .filter((batch) => selectedBatchIds.includes(batch.id))
    .reduce((sum, batch) => sum + (batch.student_count || 0), 0);

  async function loadChannelPeople() {
    setLoadingChannel(true);
    setError("");
    try {
      const data = await api(`/api/channels/${channel.id}/members`);
      const viewDetails = Boolean(data.canViewDetails);
      setCanViewDetails(viewDetails);
      setAdminCount(data.adminCount ?? (data.admins || []).length);
      setMemberCount(data.memberCount ?? (data.members || []).length);
      setChannelAdmins(viewDetails ? data.admins || [] : []);
      setChannelMembers(viewDetails ? data.members || [] : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingChannel(false);
    }
  }

  async function searchPeople(nextQuery) {
    const id = ++requestId.current;
    setLoadingPeople(true);
    try {
      const data = await api(
        `/api/channels/people-search${
          nextQuery ? `?search=${encodeURIComponent(nextQuery)}` : ""
        }`
      );
      if (id !== requestId.current) return;
      setAdmins(data.admins || []);
      setStudents(data.students || []);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err.message);
    } finally {
      if (id === requestId.current) setLoadingPeople(false);
    }
  }

  async function loadBatches(nextQuery = "") {
    setLoadingBatches(true);
    try {
      const data = await api(
        `/api/channels/batches${
          nextQuery ? `?search=${encodeURIComponent(nextQuery)}` : ""
        }`
      );
      setBatches(data.batches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingBatches(false);
    }
  }

  useEffect(() => {
    loadChannelPeople();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [channel.id]);

  useEffect(() => {
    if (mode !== "add") return;
    if (addTab === "people") {
      searchPeople(query.trim());
      const timer = window.setTimeout(() => searchRef.current?.focus(), 40);
      return () => window.clearTimeout(timer);
    }
    loadBatches(batchQuery.trim());
  }, [mode, addTab]);

  useEffect(() => {
    if (mode !== "add" || addTab !== "people") return;
    const timer = window.setTimeout(() => {
      searchPeople(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, mode, addTab]);

  useEffect(() => {
    if (mode !== "add" || addTab !== "batch") return;
    const timer = window.setTimeout(() => {
      loadBatches(batchQuery.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [batchQuery, mode, addTab]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") {
        if (mode === "add") {
          setMode("view");
          setSelected([]);
          setSelectedBatchIds([]);
          setError("");
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  function openAddMode() {
    if (!canManagePeople) return;
    setMode("add");
    setAddTab("people");
    setQuery("");
    setBatchQuery("");
    setSelected([]);
    setSelectedBatchIds([]);
    setError("");
  }

  function backToView() {
    setMode("view");
    setSelected([]);
    setSelectedBatchIds([]);
    setError("");
  }

  function isSelected(kind, id) {
    return selected.some((item) => item.kind === kind && item.id === id);
  }

  function togglePerson(person) {
    if (person.alreadyIn) return;
    setSelected((prev) => {
      const exists = prev.some(
        (item) => item.kind === person.kind && item.id === person.id
      );
      if (exists) {
        return prev.filter(
          (item) => !(item.kind === person.kind && item.id === person.id)
        );
      }
      return [...prev, person];
    });
  }

  function toggleBatch(batchId) {
    setSelectedBatchIds((prev) =>
      prev.includes(batchId)
        ? prev.filter((id) => id !== batchId)
        : [...prev, batchId]
    );
  }

  function removeSelected(kind, id) {
    setSelected((prev) =>
      prev.filter((item) => !(item.kind === kind && item.id === id))
    );
  }

  async function handleAddSelected() {
    const hasPeople = selected.length > 0;
    const hasBatches = selectedBatchIds.length > 0;

    if (!hasPeople && !hasBatches) {
      backToView();
      return;
    }

    setSaving(true);
    setError("");

    try {
      const adminPicks = selected.filter((item) => item.kind === "admin");
      const studentPicks = selected.filter((item) => item.kind === "student");

      for (const person of adminPicks) {
        await api(`/api/channels/${channel.id}/admins`, {
          method: "POST",
          body: JSON.stringify({ portalAdminId: person.id }),
        });
      }

      if (studentPicks.length || hasBatches) {
        await api(`/api/channels/${channel.id}/members/bulk`, {
          method: "POST",
          body: JSON.stringify({
            studentIds: studentPicks.map((item) => item.id),
            batchIds: selectedBatchIds,
          }),
        });
      }

      await loadChannelPeople();
      await onChanged?.();
      backToView();
      notify({
        title: "People updated",
        message: "Selected people were added to the channel successfully.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeFromChannel(kind, id) {
    const label = kind === "admin" ? "admin" : "member";
    const ok = await confirm({
      title: `Remove channel ${label}`,
      message:
        kind === "admin"
          ? "This admin will no longer manage or access this channel."
          : "This student will be removed from the channel membership list.",
      confirmLabel: `Remove ${label}`,
      tone: "danger",
    });
    if (!ok) return;

    setError("");
    try {
      if (kind === "admin") {
        await api(`/api/channels/${channel.id}/admins/${id}`, {
          method: "DELETE",
        });
      } else {
        await api(`/api/channels/${channel.id}/members/${id}`, {
          method: "DELETE",
        });
      }
      await loadChannelPeople();
      await onChanged?.();
      notify({
        title: kind === "admin" ? "Admin removed" : "Member removed",
        message: `The ${label} has been removed from this channel.`,
      });
    } catch (err) {
      setError(err.message);
    }
  }

  const adminRows = admins.map((admin) => ({
    kind: "admin",
    id: admin.id,
    name: admin.name || admin.admin_id,
    subtitle: admin.admin_id,
    alreadyIn: alreadyAdminIds.has(admin.id),
  }));

  const studentRows = students.map((student) => ({
    kind: "student",
    id: student.id,
    name: fullName(student.first_name, student.last_name),
    subtitle: student.email || student.phone || "Student",
    alreadyIn: alreadyMemberIds.has(student.id),
  }));

  const modal = (
    <div
      className="people-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="people-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="people-modal-title"
      >
        <header className="people-modal__head">
          <button
            type="button"
            className="people-modal__icon-btn"
            onClick={mode === "add" ? backToView : onClose}
            aria-label={mode === "add" ? "Back" : "Close"}
          >
            {mode === "add" ? (
              <ArrowLeft size={18} strokeWidth={2.2} />
            ) : (
              <X size={18} strokeWidth={2.2} />
            )}
          </button>
          <div>
            <h2 id="people-modal-title">
              {mode === "add" ? "Add participants" : channel.name}
            </h2>
            <p>
              {mode === "add"
                ? "Search people or add a full batch"
                : canViewDetails
                  ? `${totalInChannel} participant${
                      totalInChannel === 1 ? "" : "s"
                    }`
                  : "Member counts only · names hidden"}
            </p>
          </div>
        </header>

        {error ? <p className="people-modal__error">{error}</p> : null}

        {mode === "view" ? (
          <>
            <div className="people-modal__body">
              {!canViewDetails ? (
                <section className="people-section">
                  <h3>Channel summary</h3>
                  {loadingChannel ? (
                    <p className="people-empty">Loading…</p>
                  ) : (
                    <div className="people-count-grid">
                      <article className="people-count-card">
                        <strong>{adminCount}</strong>
                        <span>Admins</span>
                      </article>
                      <article className="people-count-card">
                        <strong>{memberCount}</strong>
                        <span>Members</span>
                      </article>
                      <article className="people-count-card is-total">
                        <strong>{totalInChannel}</strong>
                        <span>Total participants</span>
                      </article>
                    </div>
                  )}
                  <p className="people-empty people-empty--hint">
                    Your role can see counts only. Grant “View channel people”
                    to show names and contact details.
                  </p>
                </section>
              ) : (
                <>
                  <section className="people-section">
                    <h3>Admins · {channelAdmins.length}</h3>
                    {loadingChannel ? (
                      <p className="people-empty">Loading…</p>
                    ) : channelAdmins.length ? (
                      <ul className="people-list">
                        {channelAdmins.map((admin) => (
                          <li
                            key={`in-admin-${admin.portal_admin_id}`}
                            className="people-row"
                          >
                            <span className="people-avatar people-avatar--admin">
                              {initials(admin.name)}
                            </span>
                            <div className="people-list__meta">
                              <strong>{admin.name}</strong>
                              <span>{admin.admin_id} · Channel admin</span>
                            </div>
                            {canManagePeople ? (
                              <button
                                type="button"
                                className="people-remove"
                                onClick={() =>
                                  removeFromChannel(
                                    "admin",
                                    admin.portal_admin_id
                                  )
                                }
                              >
                                Remove
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="people-empty">No channel admins yet.</p>
                    )}
                  </section>

                  <section className="people-section">
                    <h3>Members · {channelMembers.length}</h3>
                    {loadingChannel ? (
                      <p className="people-empty">Loading…</p>
                    ) : channelMembers.length ? (
                      <ul className="people-list">
                        {channelMembers.map((member) => (
                          <li
                            key={`in-member-${member.student_id}`}
                            className="people-row"
                          >
                            <span className="people-avatar">
                              {initials(
                                fullName(member.first_name, member.last_name)
                              )}
                            </span>
                            <div className="people-list__meta">
                              <strong>
                                {fullName(member.first_name, member.last_name)}
                              </strong>
                              <span>
                                {member.email || member.phone || "Member"} ·
                                Student
                              </span>
                            </div>
                            {canManagePeople ? (
                              <button
                                type="button"
                                className="people-remove"
                                onClick={() =>
                                  removeFromChannel(
                                    "student",
                                    member.student_id
                                  )
                                }
                              >
                                Remove
                              </button>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="people-empty">No student members yet.</p>
                    )}
                  </section>
                </>
              )}
            </div>

            {canManagePeople ? (
              <button
                type="button"
                className="people-fab"
                onClick={openAddMode}
              >
                <UserPlus size={20} strokeWidth={2.2} aria-hidden="true" />
                Add participants
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="people-tabs">
              <button
                type="button"
                className={`people-tab ${addTab === "people" ? "is-active" : ""}`}
                onClick={() => setAddTab("people")}
              >
                <Users size={15} strokeWidth={2} aria-hidden="true" />
                People
              </button>
              <button
                type="button"
                className={`people-tab ${addTab === "batch" ? "is-active" : ""}`}
                onClick={() => setAddTab("batch")}
              >
                <Layers size={15} strokeWidth={2} aria-hidden="true" />
                By batch
              </button>
            </div>

            {addTab === "people" ? (
              <>
                <div className="people-modal__search">
                  <Search size={16} strokeWidth={2} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name, email, admin id…"
                  />
                </div>

                {selected.length ? (
                  <div className="people-modal__chips">
                    {selected.map((person) => (
                      <button
                        key={personKey(person.kind, person.id)}
                        type="button"
                        className="people-chip"
                        onClick={() => removeSelected(person.kind, person.id)}
                      >
                        <span className="people-avatar people-avatar--sm">
                          {initials(person.name)}
                        </span>
                        <em>{person.name.split(" ")[0]}</em>
                        <X size={12} strokeWidth={2.4} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="people-modal__body">
                  <section className="people-section">
                    <h3>
                      Admins
                      {loadingPeople ? "" : ` · ${adminRows.length}`}
                    </h3>
                    {loadingPeople && !adminRows.length ? (
                      <p className="people-empty">Searching…</p>
                    ) : adminRows.length ? (
                      <ul className="people-list">
                        {adminRows.map((person) => {
                          const active = isSelected(person.kind, person.id);
                          return (
                            <li key={personKey(person.kind, person.id)}>
                              <button
                                type="button"
                                className={`people-pick ${active ? "is-selected" : ""} ${
                                  person.alreadyIn ? "is-disabled" : ""
                                }`}
                                onClick={() => togglePerson(person)}
                                disabled={person.alreadyIn}
                              >
                                <span className="people-avatar people-avatar--admin">
                                  {initials(person.name)}
                                </span>
                                <div className="people-list__meta">
                                  <strong>{person.name}</strong>
                                  <span>
                                    {person.alreadyIn
                                      ? "Already in channel"
                                      : person.subtitle}
                                  </span>
                                </div>
                                <span className="people-check" aria-hidden="true">
                                  {person.alreadyIn || active ? (
                                    <Check size={14} strokeWidth={2.6} />
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="people-empty">No admins found.</p>
                    )}
                  </section>

                  <section className="people-section">
                    <h3>
                      Students
                      {loadingPeople ? "" : ` · ${studentRows.length}`}
                    </h3>
                    {loadingPeople && !studentRows.length ? (
                      <p className="people-empty">Searching…</p>
                    ) : studentRows.length ? (
                      <ul className="people-list">
                        {studentRows.map((person) => {
                          const active = isSelected(person.kind, person.id);
                          return (
                            <li key={personKey(person.kind, person.id)}>
                              <button
                                type="button"
                                className={`people-pick ${active ? "is-selected" : ""} ${
                                  person.alreadyIn ? "is-disabled" : ""
                                }`}
                                onClick={() => togglePerson(person)}
                                disabled={person.alreadyIn}
                              >
                                <span className="people-avatar">
                                  {initials(person.name)}
                                </span>
                                <div className="people-list__meta">
                                  <strong>{person.name}</strong>
                                  <span>
                                    {person.alreadyIn
                                      ? "Already in channel"
                                      : person.subtitle}
                                  </span>
                                </div>
                                <span className="people-check" aria-hidden="true">
                                  {person.alreadyIn || active ? (
                                    <Check size={14} strokeWidth={2.6} />
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="people-empty">No students found.</p>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <>
                <div className="people-modal__search">
                  <Search size={16} strokeWidth={2} aria-hidden="true" />
                  <input
                    type="search"
                    value={batchQuery}
                    onChange={(e) => setBatchQuery(e.target.value)}
                    placeholder="Search batches…"
                  />
                </div>

                {selectedBatchIds.length ? (
                  <p className="people-batch-hint">
                    {selectedBatchIds.length} batch
                    {selectedBatchIds.length === 1 ? "" : "es"} selected · about{" "}
                    {selectedBatchCount} students
                  </p>
                ) : null}

                <div className="people-modal__body">
                  <section className="people-section">
                    <h3>Batches</h3>
                    {loadingBatches ? (
                      <p className="people-empty">Loading batches…</p>
                    ) : batches.length ? (
                      <ul className="people-list">
                        {batches.map((batch) => {
                          const active = selectedBatchIds.includes(batch.id);
                          return (
                            <li key={batch.id}>
                              <button
                                type="button"
                                className={`people-pick ${active ? "is-selected" : ""}`}
                                onClick={() => toggleBatch(batch.id)}
                              >
                                <span className="people-avatar people-avatar--batch">
                                  <Layers size={16} strokeWidth={2} />
                                </span>
                                <div className="people-list__meta">
                                  <strong>{batch.name}</strong>
                                  <span>
                                    {batch.course_title || "No course"} ·{" "}
                                    {batch.student_count || 0} students
                                  </span>
                                </div>
                                <span className="people-check" aria-hidden="true">
                                  {active ? (
                                    <Check size={14} strokeWidth={2.6} />
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="people-empty">No batches found.</p>
                    )}
                  </section>
                </div>
              </>
            )}

            <footer className="people-modal__foot">
              <button
                type="button"
                className="btn-secondary"
                onClick={backToView}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary people-modal__done"
                onClick={handleAddSelected}
                disabled={
                  saving || (!selected.length && !selectedBatchIds.length)
                }
              >
                {saving
                  ? "Adding…"
                  : selected.length || selectedBatchIds.length
                    ? `Add ${
                        selected.length + selectedBatchIds.length
                      }`
                    : "Add"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

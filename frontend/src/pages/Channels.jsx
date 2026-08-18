import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Megaphone, MessageSquare, Plus, UserPlus } from "lucide-react";
import { api } from "../lib/api";
import { connectChannelsSocket } from "../lib/channelSocket";
import { useFeedback } from "../lib/feedback";
import { getAdmin, hasPower, isSuperAdmin } from "../lib/auth";
import { EntityCell, MetricCell } from "../components/TableCells";
import AddPeopleModal from "../components/AddPeopleModal";

const emptyForm = {
  name: "",
  code: "",
  description: "",
  status: "active",
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

function creatorLabel(channel) {
  if (!channel?.created_by_name && !channel?.created_by_admin_id) {
    return "—";
  }

  const name = channel.created_by_name || channel.created_by_admin_id;
  if (channel.created_by_role === "super_admin") {
    return `${name} (Super admin)`;
  }
  return name;
}

function formatUnread(count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  return n > 99 ? "99+" : String(n);
}

function ChannelTable({
  title,
  hint,
  channels,
  loading,
  emptyTitle,
  emptyHint,
  canManageChannels,
  onOpenChannel,
  onPeople,
  onEdit,
  onDelete,
}) {
  return (
    <div className="table-shell">
      <div className="table-shell__meta">
        <div className="table-shell__meta-left">
          <strong>{loading ? "…" : channels.length}</strong>
          <span>{title}</span>
        </div>
        {hint ? <span className="table-shell__hint">{hint}</span> : null}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Code</th>
              <th>Created by</th>
              <th className="is-num">Members</th>
              <th className="is-num">Messages</th>
              <th>Status</th>
              <th>Created</th>
              <th className="is-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="table-empty">
                  <div className="table-empty__box">
                    <strong>Loading channels</strong>
                    <span>Fetching channel records…</span>
                  </div>
                </td>
              </tr>
            ) : channels.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-empty">
                  <div className="table-empty__box">
                    <strong>{emptyTitle}</strong>
                    <span>{emptyHint}</span>
                  </div>
                </td>
              </tr>
            ) : (
              channels.map((channel) => {
                const unread = Number(channel.unread_count) || 0;
                return (
                <tr
                  key={channel.id}
                  className={unread > 0 ? "channel-row--unread" : undefined}
                >
                  <td>
                    <EntityCell
                      title={channel.name}
                      subtitle={channel.description || "No description"}
                      tone="forest"
                      badge={unread}
                      onOpen={() => onOpenChannel(channel)}
                      openLabel="Open messages"
                    />
                  </td>
                  <td>
                    <span className="tag tag-code">{channel.code}</span>
                  </td>
                  <td>
                    <span className="cell-date">{creatorLabel(channel)}</span>
                  </td>
                  <td className="is-num">
                    <MetricCell
                      value={channel.member_count ?? 0}
                      label="members"
                    />
                  </td>
                  <td className="is-num">
                    <MetricCell
                      value={channel.message_count ?? 0}
                      label="messages"
                    />
                  </td>
                  <td>
                    <span
                      className={`status-pill status-${String(channel.status || "").toLowerCase()}`}
                    >
                      {channel.status || "—"}
                    </span>
                  </td>
                  <td>
                    <span className="cell-date">
                      {formatDate(channel.created_at)}
                    </span>
                  </td>
                  <td className="is-actions">
                    <div className="row-actions">
                      <button
                        type="button"
                        className={`btn-ghost${unread > 0 ? " channel-msg-btn--unread" : ""}`}
                        onClick={() => onOpenChannel(channel)}
                      >
                        <MessageSquare
                          size={14}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                        Messages
                        {unread > 0 ? (
                          <span className="unread-badge unread-badge--inline">
                            {formatUnread(unread)}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => onPeople(channel)}
                      >
                        <UserPlus size={14} strokeWidth={2} aria-hidden="true" />
                        People
                      </button>
                      {canManageChannels ? (
                        <>
                          <button
                            type="button"
                            className="btn-ghost"
                            onClick={() => onEdit(channel)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn-danger"
                            onClick={() => onDelete(channel.id)}
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Channels() {
  const { confirm, notify } = useFeedback();
  const location = useLocation();
  const navigate = useNavigate();
  const canManageChannels = hasPower("manage_channels");
  const [channels, setChannels] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [peopleChannel, setPeopleChannel] = useState(null);

  async function loadChannels(query = search, { silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const data = await api(
        `/api/channels${query ? `?search=${encodeURIComponent(query)}` : ""}`
      );
      setChannels(data.channels);
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadChannels("");
  }, []);

  // Refresh badges when returning to this tab
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        loadChannels(search, { silent: true });
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const channelIdsKey = useMemo(
    () =>
      channels
        .map((c) => c.id)
        .sort((a, b) => a - b)
        .join(","),
    [channels]
  );

  // Live unread bumps while staying on the channels list
  useEffect(() => {
    if (!channelIdsKey) return undefined;
    const ids = channelIdsKey.split(",").map(Number);
    const admin = getAdmin();

    function isOwnMessage(message) {
      if (!message) return false;
      if (message.sent_by_portal_admin_id && admin?.portalAdminId) {
        return message.sent_by_portal_admin_id === admin.portalAdminId;
      }
      if (message.sent_by_role === "super_admin") return isSuperAdmin(admin);
      return false;
    }

    return connectChannelsSocket(ids, (event) => {
      if (event.type === "message.created" && event.message) {
        if (isOwnMessage(event.message)) return;
        const channelId = Number(event.channelId);
        setChannels((prev) =>
          prev.map((channel) =>
            Number(channel.id) === channelId
              ? {
                  ...channel,
                  message_count: (Number(channel.message_count) || 0) + 1,
                  unread_count: (Number(channel.unread_count) || 0) + 1,
                }
              : channel
          )
        );
        return;
      }

      if (event.type === "message.deleted" && event.channelId != null) {
        const channelId = Number(event.channelId);
        setChannels((prev) =>
          prev.map((channel) =>
            Number(channel.id) === channelId
              ? {
                  ...channel,
                  message_count: Math.max(
                    0,
                    (Number(channel.message_count) || 0) - 1
                  ),
                }
              : channel
          )
        );
      }
    });
  }, [channelIdsKey]);

  const requestedPeopleChannelId = location.state?.addPeopleChannelId;

  useEffect(() => {
    if (!requestedPeopleChannelId || !channels.length) return;
    const match = channels.find(
      (channel) => channel.id === requestedPeopleChannelId
    );
    if (match) {
      setShowForm(false);
      setPeopleChannel(match);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [requestedPeopleChannelId, channels]);

  const myChannels = channels.filter((channel) => channel.is_mine);
  const otherChannels = channels.filter((channel) => !channel.is_mine);
  const splitGroups = myChannels.length > 0 && otherChannels.length > 0;

  function openPeople(channel) {
    setShowForm(false);
    setPeopleChannel(channel);
  }

  function openChannel(channel) {
    navigate(`/dashboard/channels/${channel.id}`);
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setPeopleChannel(null);
    setError("");
  }

  function openEdit(channel) {
    setEditingId(channel.id);
    setForm({
      name: channel.name || "",
      code: channel.code || "",
      description: channel.description || "",
      status: channel.status || "active",
    });
    setShowForm(true);
    setPeopleChannel(null);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      if (editingId) {
        await api(`/api/channels/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(form),
        });
      } else {
        await api("/api/channels", {
          method: "POST",
          body: JSON.stringify(form),
        });
      }

      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      await loadChannels();
      notify({
        title: editingId ? "Channel updated" : "Channel created",
        message: editingId
          ? "Channel settings were saved successfully."
          : "The channel is ready. You can add people next.",
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    const ok = await confirm({
      title: "Delete channel",
      message:
        "Members and admins will be removed from this channel. Message history may no longer be accessible from the portal.",
      confirmLabel: "Delete channel",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await api(`/api/channels/${id}`, { method: "DELETE" });
      if (peopleChannel?.id === id) {
        setPeopleChannel(null);
      }
      await loadChannels();
      notify({
        title: "Channel deleted",
        message: "The channel has been removed from the portal.",
      });
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="portal-page">
      <header className="portal-page__header">
        <div>
          <p className="page-kicker">
            <Megaphone size={14} strokeWidth={2} aria-hidden="true" />
            Communication
          </p>
          <h1>Channels</h1>
          <p>
            Create channels, track who created them, and add people to empty
            groups.
          </p>
        </div>
        {canManageChannels ? (
          <button type="button" className="btn-primary" onClick={openCreate}>
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
            Add channel
          </button>
        ) : null}
      </header>

      <div className="filter-bar">
        <div className="filter-bar__search">
          <input
            type="search"
            placeholder="Search channel name, code, or creator"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadChannels(search);
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => loadChannels(search)}
          >
            Search
          </button>
        </div>
      </div>

      {error ? <p className="portal-alert">{error}</p> : null}

      {showForm ? (
        <form className="entity-form" onSubmit={handleSubmit}>
          <div className="entity-form__header">
            <h2>{editingId ? "Edit channel" : "New channel"}</h2>
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
              <label htmlFor="channelName">Name</label>
              <input
                id="channelName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Announcements"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="channelCode">Code</label>
              <input
                id="channelCode"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="auto from name if empty"
              />
            </div>
            <div className="field">
              <label htmlFor="channelStatus">Status</label>
              <select
                id="channelStatus"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div className="field">
              <label>Access</label>
              <input value="Admin only (send messages)" disabled />
            </div>
            <div className="field field-span">
              <label htmlFor="channelDescription">Description</label>
              <textarea
                id="channelDescription"
                rows={3}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="What this channel is used for"
              />
            </div>
          </div>

          <div className="entity-form__actions">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? "Saving…"
                : editingId
                  ? "Update channel"
                  : "Create channel"}
            </button>
          </div>
        </form>
      ) : null}

      {splitGroups ? (
        <>
          <ChannelTable
            title="your channels"
            hint="Channels you are an admin of"
            channels={myChannels}
            loading={loading}
            emptyTitle="You are not in any channel yet"
            emptyHint="Ask a channel admin to add you, or open one below."
            canManageChannels={canManageChannels}
            onOpenChannel={openChannel}
            onPeople={openPeople}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
          <ChannelTable
            title="other channels"
            hint="Channels you are not part of"
            channels={otherChannels}
            loading={loading}
            emptyTitle="No other channels"
            emptyHint="You are already an admin of every channel."
            canManageChannels={canManageChannels}
            onOpenChannel={openChannel}
            onPeople={openPeople}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        </>
      ) : (
        <ChannelTable
          title="channels"
          channels={channels}
          loading={loading}
          emptyTitle="No channels yet"
          emptyHint={
            canManageChannels
              ? "Create your first admin channel to get started."
              : "You have not been added to any channel yet."
          }
          canManageChannels={canManageChannels}
          onOpenChannel={openChannel}
          onPeople={openPeople}
          onEdit={openEdit}
          onDelete={handleDelete}
        />
      )}

      {peopleChannel ? (
        <AddPeopleModal
          channel={peopleChannel}
          onClose={() => setPeopleChannel(null)}
          onChanged={() => loadChannels()}
        />
      ) : null}
    </div>
  );
}

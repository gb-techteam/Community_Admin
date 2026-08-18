import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Shield, Users, X } from "lucide-react";
import { api } from "../lib/api";

function initials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function fullName(row) {
  if (row.kind === "admin") {
    return row.admin_name || "Admin";
  }
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || "—";
}

function formatWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mediaLabel(type) {
  if (type === "image") return "Photo";
  if (type === "video") return "Video";
  if (type === "audio") return "Voice message";
  return null;
}

function viewerKey(row) {
  return `${row.kind || "student"}-${row.viewer_id || row.student_id}`;
}

export default function MessageInfoModal({ channelId, messageId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const result = await api(
          `/api/channels/${channelId}/messages/${messageId}`
        );
        if (alive) setData(result);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [channelId, messageId]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const message = data?.message;
  const seenBy = data?.seenBy || [];
  const seenCount = data?.seenCount ?? message?.seen_count ?? 0;
  const studentSeenCount =
    data?.studentSeenCount ?? message?.student_seen_count ?? 0;
  const adminSeenCount =
    data?.adminSeenCount ?? message?.admin_seen_count ?? 0;
  const memberCount = data?.memberCount ?? 0;
  const unseenCount =
    data?.unseenCount ?? Math.max(0, memberCount - studentSeenCount);
  const sender = message?.sender_name || message?.sent_by || "Unknown sender";
  const kind = mediaLabel(message?.media_type);

  return createPortal(
    <div
      className="people-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="people-modal msg-info-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="msg-info-title"
      >
        <div className="people-modal__head">
          <span className="msg-modal__badge" aria-hidden="true">
            <Eye size={18} strokeWidth={2} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="msg-info-title">Message info</h2>
            <p>Who has seen this broadcast</p>
          </div>
          <button
            type="button"
            className="people-modal__icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {error ? <p className="people-modal__error">{error}</p> : null}

        <div className="msg-info-modal__body">
          {loading ? (
            <p className="msg-thread__empty">Loading message…</p>
          ) : message ? (
            <>
              <section className="msg-info-preview">
                <div className="msg-info-preview__meta">
                  <strong>{sender}</strong>
                  <span>{formatWhen(message.created_at)}</span>
                </div>
                {message.title ? (
                  <p className="msg-info-preview__title">{message.title}</p>
                ) : null}
                {kind ? (
                  <p className="msg-info-preview__kind">{kind}</p>
                ) : null}
                {message.media_type === "image" && message.media_url ? (
                  <img
                    className="msg-info-preview__media"
                    src={message.media_url}
                    alt={message.media_name || "Image"}
                  />
                ) : null}
                {message.media_type === "video" && message.media_url ? (
                  <video
                    className="msg-info-preview__media"
                    src={message.media_url}
                    controls
                    preload="metadata"
                  />
                ) : null}
                {message.media_type === "audio" && message.media_url ? (
                  <audio
                    className="msg-info-preview__audio"
                    src={message.media_url}
                    controls
                    preload="metadata"
                  />
                ) : null}
                {message.body &&
                message.body !== "Voice message" &&
                message.body !== "Attachment" ? (
                  <p className="msg-info-preview__body">{message.body}</p>
                ) : null}
              </section>

              <div className="msg-info-stats">
                <div>
                  <Eye size={15} strokeWidth={2} aria-hidden="true" />
                  <div>
                    <strong>{seenCount}</strong>
                    <span>seen</span>
                  </div>
                </div>
                <div>
                  <Users size={15} strokeWidth={2} aria-hidden="true" />
                  <div>
                    <strong>{memberCount}</strong>
                    <span>members</span>
                  </div>
                </div>
                <div>
                  <strong>{unseenCount}</strong>
                  <span>members left</span>
                </div>
              </div>

              <p className="msg-info-seen__split">
                {studentSeenCount} member{studentSeenCount === 1 ? "" : "s"}
                {" · "}
                {adminSeenCount} admin{adminSeenCount === 1 ? "" : "s"}
              </p>

              <section className="msg-info-seen">
                <div className="msg-info-seen__head">
                  <h3>Seen by</h3>
                  <span>{seenCount}</span>
                </div>

                {seenBy.length === 0 ? (
                  <p className="msg-info-seen__empty">
                    Nobody has opened this message yet. When another admin opens
                    this chat, they appear here.
                  </p>
                ) : (
                  <ul className="msg-info-seen__list">
                    {seenBy.map((row) => {
                      const name = fullName(row);
                      const isAdmin = row.kind === "admin";
                      return (
                        <li key={viewerKey(row)}>
                          <span className="msg-avatar" aria-hidden="true">
                            {initials(name)}
                          </span>
                          <div className="msg-info-seen__person">
                            <strong>
                              {name}
                              {isAdmin ? (
                                <em className="msg-info-seen__badge">
                                  <Shield size={11} strokeWidth={2.4} />
                                  {row.admin_role || "Admin"}
                                </em>
                              ) : null}
                            </strong>
                            <span>
                              {isAdmin
                                ? "Opened in admin portal"
                                : [row.email, row.phone]
                                    .filter(Boolean)
                                    .join(" · ") || "Member"}
                            </span>
                          </div>
                          <time dateTime={row.seen_at}>
                            {formatWhen(row.seen_at)}
                          </time>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <p className="msg-thread__empty">Message not found.</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

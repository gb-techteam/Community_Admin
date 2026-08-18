export function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function EntityCell({
  title,
  subtitle,
  tone = "forest",
  onOpen,
  openLabel,
  badge,
}) {
  const interactive = typeof onOpen === "function";
  const unread = Number(badge) || 0;

  return (
    <div
      className={`entity-cell ${interactive ? "entity-cell--link" : ""}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onOpen : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      title={openLabel || undefined}
    >
      <span className={`entity-avatar tone-${tone}`} aria-hidden="true">
        {initials(title)}
      </span>
      <div className="entity-cell__text">
        <strong className="entity-cell__title">
          <span>{title || "—"}</span>
          {unread > 0 ? (
            <span className="unread-badge" aria-label={`${unread} unread`}>
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
    </div>
  );
}

export function MetricCell({ value, label }) {
  return (
    <div className="metric-cell">
      <strong>{value ?? 0}</strong>
      {label ? <span>{label}</span> : null}
    </div>
  );
}

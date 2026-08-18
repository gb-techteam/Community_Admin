import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  BookOpen,
  Layers,
  Megaphone,
  Shield,
  ArrowUpRight,
  UserCog,
  CandlestickChart,
  Rocket,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import { api } from "../lib/api";
import {
  getAdmin,
  hasAnyPower,
  hasPower,
  isSuperAdmin,
  powerLabel,
} from "../lib/auth";

function fullName(first, last) {
  return [first, last].filter(Boolean).join(" ").trim() || "—";
}

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

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function initials(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!parts.length) return "—";
  return parts
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <article className="ov-stat">
      <div className="ov-stat__top">
        <span className="ov-stat__label">{label}</span>
        <span className="ov-stat__icon" aria-hidden="true">
          <Icon size={16} strokeWidth={2} />
        </span>
      </div>
      <strong className="ov-stat__value">{value}</strong>
      {hint ? <p className="ov-stat__hint">{hint}</p> : null}
    </article>
  );
}

function Breakdown({ title, rows, loading }) {
  const total = (rows || []).reduce((sum, row) => sum + (row.count || 0), 0);
  return (
    <div className="ov-breakdown">
      <h3>{title}</h3>
      {loading ? (
        <p className="ov-list__empty">Loading…</p>
      ) : rows?.length ? (
        <ul>
          {rows.map((row) => {
            const pct = total ? Math.round((row.count / total) * 100) : 0;
            return (
              <li key={`${title}-${row.label}`}>
                <div className="ov-breakdown__row">
                  <span>{row.label}</span>
                  <strong>
                    {row.count} · {pct}%
                  </strong>
                </div>
                <div className="ov-breakdown__bar" aria-hidden="true">
                  <i style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ov-list__empty">No data yet.</p>
      )}
    </div>
  );
}

export default function Overview() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const admin = getAdmin();
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const canStudents = hasAnyPower(["manage_students"]);
  const canCourses = hasAnyPower(["manage_courses"]);
  const canBatches = hasAnyPower(["manage_batches"]);
  const canChannels = hasAnyPower([
    "manage_channels",
    "message_channels",
    "view_channel_people",
  ]);
  const canManageChannels = hasPower("manage_channels");
  const canAdmins = hasAnyPower(["create_admins"]);
  const canSuperkandle = hasPower("manage_superkandle");
  const canMomentum = hasPower("manage_momentum");

  const shortcuts = [
    {
      to: "/dashboard/admins",
      label: "Admins",
      icon: Shield,
      show: canAdmins,
    },
    {
      to: "/dashboard/channels",
      label: "Channels",
      icon: Megaphone,
      show: canChannels,
    },
    {
      to: "/dashboard/superkandle",
      label: "Superkandle",
      icon: CandlestickChart,
      show: canSuperkandle,
    },
    {
      to: "/dashboard/momentum",
      label: "Momentum",
      icon: Rocket,
      show: canMomentum,
    },
    {
      to: "/dashboard/batches",
      label: "Batches",
      icon: Layers,
      show: canBatches,
    },
    {
      to: "/dashboard/students",
      label: "Students",
      icon: Users,
      show: canStudents,
    },
    {
      to: "/dashboard/courses",
      label: "Courses",
      icon: BookOpen,
      show: canCourses,
    },
  ].filter((item) => item.show);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const result = await api("/api/dashboard/stats");
        if (alive) {
          setData(result);
          if (result.dbUnavailable) {
            setError(
              result.dbError
                ? `Database unavailable (${result.dbError}). Momentum may still load.`
                : "Database unavailable. Momentum may still load."
            );
          } else {
            setError("");
          }
        }
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
  }, []);

  const stats = data?.stats;
  const momentum = data?.momentum;
  const n = (value) => (loading ? "—" : (value ?? 0));

  const yourPowers = isSuperAdmin(admin)
    ? ["Full access"]
    : Array.isArray(admin?.powers) && admin.powers.length
      ? admin.powers.map(powerLabel)
      : ["No powers assigned"];

  return (
    <div className="portal-page overview-page">
      <header className="ov-top">
        <div className="ov-top__copy">
          <p className="ov-top__date">{today}</p>
          <h1>
            Welcome back,{" "}
            <span>{admin?.name || admin?.id || "Admin"}</span>
          </h1>
          <p className="ov-top__sub">
            Full community control center — CRM data, channels, admins, and
            product memberships.
          </p>
        </div>

        <div className="ov-top__actions">
          {canChannels ? (
            <Link to="/dashboard/channels" className="btn-primary">
              <Megaphone size={16} strokeWidth={2} aria-hidden="true" />
              Channels
            </Link>
          ) : null}
          {canAdmins ? (
            <Link
              to="/dashboard/admins"
              className={canChannels ? "btn-secondary" : "btn-primary"}
            >
              <Shield size={16} strokeWidth={2} aria-hidden="true" />
              Admins
            </Link>
          ) : null}
          {canSuperkandle ? (
            <Link to="/dashboard/superkandle" className="btn-secondary">
              <CandlestickChart size={16} strokeWidth={2} aria-hidden="true" />
              Superkandle
            </Link>
          ) : null}
        </div>
      </header>

      {error ? <p className="portal-alert">{error}</p> : null}

      <section className="ov-kpis ov-kpis--wide" aria-label="Key metrics">
        <StatCard
          icon={Megaphone}
          label="Channels"
          value={n(stats?.channels)}
          hint={`${n(stats?.activeChannels)} active`}
        />
        <StatCard
          icon={MessageSquare}
          label="Members"
          value={n(stats?.channelMembers)}
          hint="Across all channels"
        />
        <StatCard
          icon={Users}
          label="Students"
          value={n(stats?.students)}
          hint={`${n(stats?.enrollments)} enrollments`}
        />
        <StatCard
          icon={Layers}
          label="Batches"
          value={n(stats?.batches)}
          hint={`${n(stats?.openBatches)} open · ${n(stats?.activeBatches)} active`}
        />
        <StatCard
          icon={BookOpen}
          label="Courses"
          value={n(stats?.courses)}
          hint={`${n(stats?.activeCourses)} active`}
        />
        <StatCard
          icon={UserCog}
          label="Admins"
          value={n(stats?.portalAdmins)}
          hint={`${n(stats?.activePortalAdmins)} active · ${n(stats?.signalGivers)} signal`}
        />
      </section>

      <section className="ov-workspace ov-workspace--equal">
        <article
          className="ov-card ov-card--primary ov-card--equal"
          aria-label="Channels"
        >
          <div className="ov-card__head">
            <div className="ov-card__title">
              <span className="ov-card__icon" aria-hidden="true">
                <Megaphone size={17} strokeWidth={2} />
              </span>
              <div>
                <h2>Channels</h2>
                <p>Broadcast spaces managed in this portal</p>
              </div>
            </div>
            {canChannels ? (
              <Link to="/dashboard/channels" className="ov-card__link">
                Open
                <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden="true" />
              </Link>
            ) : null}
          </div>

          <ul className="ov-list">
            {loading ? (
              <li className="ov-list__empty">Loading channels…</li>
            ) : data?.recentChannels?.length ? (
              data.recentChannels.map((channel) => (
                <li key={channel.id}>
                  {canChannels ? (
                    <Link
                      to={`/dashboard/channels/${channel.id}`}
                      className="ov-channel-open"
                      title="Open messages"
                    >
                      <span className="ov-avatar" aria-hidden="true">
                        {initials(channel.name)}
                      </span>
                      <div className="ov-list__main">
                        <strong title={channel.name}>{channel.name}</strong>
                        <span className="ov-code">{channel.code}</span>
                      </div>
                    </Link>
                  ) : (
                    <>
                      <span className="ov-avatar" aria-hidden="true">
                        {initials(channel.name)}
                      </span>
                      <div className="ov-list__main">
                        <strong title={channel.name}>{channel.name}</strong>
                        <span className="ov-code">{channel.code}</span>
                      </div>
                    </>
                  )}
                  <div className="ov-list__meta">
                    <span>{channel.member_count} members</span>
                    <span
                      className={`status-pill status-${String(channel.status || "").toLowerCase()}`}
                    >
                      {channel.status || "—"}
                    </span>
                    {canManageChannels ? (
                      <Link
                        to="/dashboard/channels"
                        state={{ addPeopleChannelId: channel.id }}
                        className="ov-list__action"
                      >
                        <UserPlus size={14} strokeWidth={2} aria-hidden="true" />
                        Add people
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))
            ) : (
              <li className="ov-list__empty">No channels created yet.</li>
            )}
          </ul>
        </article>

        <article className="ov-card ov-card--equal" aria-label="Recent batches">
          <div className="ov-card__head">
            <div className="ov-card__title">
              <span className="ov-card__icon" aria-hidden="true">
                <Layers size={17} strokeWidth={2} />
              </span>
              <div>
                <h2>Recent batches</h2>
                <p>CRM-linked training groups</p>
              </div>
            </div>
            {canBatches ? (
              <Link to="/dashboard/batches" className="ov-card__link">
                Open
                <ArrowUpRight size={14} strokeWidth={2.2} />
              </Link>
            ) : null}
          </div>
          <ul className="ov-list">
            {loading ? (
              <li className="ov-list__empty">Loading batches…</li>
            ) : data?.recentBatches?.length ? (
              data.recentBatches.map((batch) => (
                <li key={batch.id}>
                  <span className="ov-avatar" aria-hidden="true">
                    {initials(batch.name)}
                  </span>
                  <div className="ov-list__main">
                    <strong>{batch.name}</strong>
                    <span className="ov-code">
                      {batch.course_title || "No course"}
                    </span>
                  </div>
                  <div className="ov-list__meta">
                    <span>{batch.student_count ?? 0} students</span>
                    <span>{batch.is_open ? "Open" : "Closed"}</span>
                    <span
                      className={`status-pill status-${String(batch.status || "").toLowerCase()}`}
                    >
                      {batch.status || "—"}
                    </span>
                  </div>
                </li>
              ))
            ) : (
              <li className="ov-list__empty">No batches found.</li>
            )}
          </ul>
        </article>
      </section>

      {(canSuperkandle || canMomentum) && (
        <section className="ov-products" aria-label="Products">
          <div className="ov-section-head">
            <h2>Membership products</h2>
          </div>

          <div className="ov-products__grid">
            {canSuperkandle ? (
              <article className="ov-product-card ov-product-card--sk">
                <div className="ov-product-card__head">
                  <div>
                    <span className="ov-product-card__badge">Superkandle</span>
                    <h3>Tool membership</h3>
                    <p>Plans, payments, and expiry tracking</p>
                  </div>
                  <Link to="/dashboard/superkandle" className="ov-card__link">
                    Open
                    <ArrowUpRight size={14} strokeWidth={2.2} />
                  </Link>
                </div>
                <div className="ov-product-card__metrics">
                  <div>
                    <strong>{n(stats?.superkandleMembers)}</strong>
                    <span>Members</span>
                  </div>
                  <div>
                    <strong>{n(stats?.superkandleActive)}</strong>
                    <span>Active</span>
                  </div>
                  <div>
                    <strong>{n(stats?.superkandleExpiring)}</strong>
                    <span>Expiring</span>
                  </div>
                  <div>
                    <strong>{n(stats?.superkandlePending)}</strong>
                    <span>Pending pay</span>
                  </div>
                </div>
                <p className="ov-product-card__foot">
                  {n(stats?.superkandleActivePlans)}/{n(stats?.superkandlePlans)}{" "}
                  plans active · {n(stats?.superkandleExpired)} expired
                </p>
              </article>
            ) : null}

            {canMomentum ? (
              <article className="ov-product-card ov-product-card--mm">
                <div className="ov-product-card__head">
                  <div>
                    <span className="ov-product-card__badge">Momentum</span>
                    <h3>TraderConnect</h3>
                    <p>Live Momentum students, mentors, and batches</p>
                  </div>
                  <Link to="/dashboard/momentum" className="ov-card__link">
                    Open
                    <ArrowUpRight size={14} strokeWidth={2.2} />
                  </Link>
                </div>
                {momentum ? (
                  <>
                    <div className="ov-product-card__metrics">
                      <div>
                        <strong>{n(momentum.totalMomentumStudents)}</strong>
                        <span>Students</span>
                      </div>
                      <div>
                        <strong>{n(momentum.activeMomentumStudents)}</strong>
                        <span>Active</span>
                      </div>
                      <div>
                        <strong>
                          {loading
                            ? "—"
                            : `${momentum.activeMentors}/${momentum.totalMentors}`}
                        </strong>
                        <span>Mentors</span>
                      </div>
                      <div>
                        <strong>
                          {loading
                            ? "—"
                            : `${momentum.activeBatches}/${momentum.totalBatches}`}
                        </strong>
                        <span>Batches</span>
                      </div>
                    </div>
                    {momentum.topTraders?.length ? (
                      <ul className="ov-list ov-list--compact">
                        {momentum.topTraders.slice(0, 3).map((trader, i) => (
                          <li key={trader._id || trader.email || i}>
                            <div className="ov-list__main">
                              <strong>{trader.name || "—"}</strong>
                              <span className="ov-code">
                                {money(trader.totalProfit)}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="ov-list__empty">
                    {loading
                      ? "Loading Momentum…"
                      : "Momentum stats unavailable. Check API key config."}
                  </p>
                )}
              </article>
            ) : null}
          </div>
        </section>
      )}

      <div className="ov-section-head">
        <h2>Team &amp; catalogue</h2>
      </div>

      <section className="ov-workspace">
        <article className="ov-card">
          <div className="ov-card__head">
            <div className="ov-card__title">
              <span className="ov-card__icon" aria-hidden="true">
                <UserCog size={17} strokeWidth={2} />
              </span>
              <div>
                <h2>Portal admins</h2>
                <p>
                  {n(stats?.staffAdmins)} staff · {n(stats?.signalGivers)}{" "}
                  signal · {n(stats?.adminTypes)} types
                </p>
              </div>
            </div>
            {canAdmins ? (
              <Link to="/dashboard/admins" className="ov-card__link">
                Manage
                <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden="true" />
              </Link>
            ) : null}
          </div>

          <div className="ov-access">
            <span className="ov-access__label">Your access</span>
            <div className="ov-access__tags">
              {yourPowers.map((power) => (
                <span key={power}>{power}</span>
              ))}
            </div>
          </div>

          <ul className="ov-list">
            {loading ? (
              <li className="ov-list__empty">Loading admins…</li>
            ) : data?.recentAdmins?.length ? (
              data.recentAdmins.map((row) => (
                <li key={row.id}>
                  <span className="ov-avatar" aria-hidden="true">
                    {initials(row.name)}
                  </span>
                  <div className="ov-list__main">
                    <strong>{row.name}</strong>
                    <span className="ov-code">{row.admin_id}</span>
                  </div>
                  <div className="ov-list__meta">
                    <span
                      className={`status-pill ${
                        row.is_signal_only || row.admin_type === "signal_giver"
                          ? "status-partial"
                          : "status-active"
                      }`}
                    >
                      {row.type_name ||
                        (row.is_signal_only || row.admin_type === "signal_giver"
                          ? "Signal giver"
                          : "Portal staff")}
                    </span>
                    <span>
                      {(row.powers || []).length
                        ? `${row.powers.length} powers`
                        : "No powers"}
                    </span>
                    <span
                      className={`status-pill ${row.is_active ? "status-active" : "status-inactive"}`}
                    >
                      {row.is_active ? "Active" : "Off"}
                    </span>
                  </div>
                </li>
              ))
            ) : (
              <li className="ov-list__empty">No portal admins yet.</li>
            )}
          </ul>
        </article>

        <article className="ov-card">
          <div className="ov-card__head">
            <div className="ov-card__title">
              <span className="ov-card__icon" aria-hidden="true">
                <BookOpen size={17} strokeWidth={2} />
              </span>
              <div>
                <h2>Top courses</h2>
                <p>By enrollment count</p>
              </div>
            </div>
            {canCourses ? (
              <Link to="/dashboard/courses" className="ov-card__link">
                Open
                <ArrowUpRight size={14} strokeWidth={2.2} />
              </Link>
            ) : null}
          </div>
          <ul className="ov-list">
            {loading ? (
              <li className="ov-list__empty">Loading courses…</li>
            ) : data?.courseBreakdown?.length ? (
              data.courseBreakdown.map((course) => (
                <li key={course.id}>
                  <span className="ov-avatar" aria-hidden="true">
                    {initials(course.title)}
                  </span>
                  <div className="ov-list__main">
                    <strong>{course.title}</strong>
                    <span className="ov-code">
                      {course.duration || "No duration"}
                    </span>
                  </div>
                  <div className="ov-list__meta">
                    <span>{course.student_count} students</span>
                    <span>{course.price != null ? `$${course.price}` : "—"}</span>
                    <span
                      className={`status-pill status-${String(course.status || "").toLowerCase()}`}
                    >
                      {course.status || "—"}
                    </span>
                  </div>
                </li>
              ))
            ) : (
              <li className="ov-list__empty">No courses found.</li>
            )}
          </ul>
        </article>
      </section>

      <section className="ov-crm">
        <div className="ov-crm__head">
          <div>
            <p className="ov-crm__eyebrow">CRM linked</p>
            <h2>Students & enrollments</h2>
          </div>
          <p>View and update only — create or delete in the CRM portal.</p>
        </div>

        <div className="ov-crm__metrics">
          <div>
            <strong>{n(stats?.students)}</strong>
            <span>Students</span>
          </div>
          <div>
            <strong>{n(stats?.courses)}</strong>
            <span>Courses</span>
          </div>
          <div>
            <strong>{n(stats?.enrollments)}</strong>
            <span>Enrollments</span>
          </div>
          <div>
            <strong>{n(stats?.activeCourses)}</strong>
            <span>Active courses</span>
          </div>
          <div>
            <strong>{n(stats?.studentsWithPhone)}</strong>
            <span>With phone</span>
          </div>
          <div>
            <strong>{n(stats?.studentsWithTelegram)}</strong>
            <span>With Telegram</span>
          </div>
        </div>

        <div className="ov-crm__grid ov-crm__grid--3">
          <div className="ov-crm__block">
            <div className="ov-crm__block-head">
              <h3>Recent students</h3>
              {canStudents ? (
                <Link to="/dashboard/students">View all</Link>
              ) : null}
            </div>
            <table className="ov-mini-table">
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={2}>Loading…</td>
                  </tr>
                ) : data?.recentStudents?.length ? (
                  data.recentStudents.map((student) => (
                    <tr key={student.id}>
                      <td>
                        <strong>
                          {fullName(student.first_name, student.last_name)}
                        </strong>
                        <span>{student.email || "No email"}</span>
                      </td>
                      <td>{formatDate(student.created_at)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2}>No students found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="ov-crm__block">
            <div className="ov-crm__block-head">
              <h3>Recent enrollments</h3>
              {canCourses ? <Link to="/dashboard/courses">Courses</Link> : null}
            </div>
            <table className="ov-mini-table">
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={2}>Loading…</td>
                  </tr>
                ) : data?.recentEnrollments?.length ? (
                  data.recentEnrollments.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>
                          {fullName(row.first_name, row.last_name)}
                        </strong>
                        <span>{row.course_title || "—"}</span>
                      </td>
                      <td>
                        <span
                          className={`status-pill status-${String(row.payment_status || "").toLowerCase()}`}
                        >
                          {row.payment_status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={2}>No enrollments found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="ov-crm__block ov-crm__block--charts">
            <Breakdown
              title="Payment status"
              rows={data?.paymentBreakdown}
              loading={loading}
            />
            <Breakdown
              title="Enrollment status"
              rows={data?.enrollmentStatus}
              loading={loading}
            />
            <Breakdown
              title="Admin types"
              rows={data?.adminTypeBreakdown}
              loading={loading}
            />
          </div>
        </div>
      </section>

      {shortcuts.length ? (
        <nav className="ov-shortcuts" aria-label="Quick navigation">
          {shortcuts.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className="ov-shortcut">
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                <span>{item.label}</span>
                <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" />
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

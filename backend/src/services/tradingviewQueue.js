import pool from "../config/db.js";
import { notifyTradingviewIdUpdated } from "./superkandleMails.js";

export function normalizeTvHandle(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .trim();
}

export function tvHandleKey(value) {
  return normalizeTvHandle(value).toLowerCase();
}

export async function queueTradingviewRemoval({
  studentId = null,
  username,
  replacedWith = null,
  reason = "updated",
  accessWasShared = null,
} = {}) {
  const handle = normalizeTvHandle(username);
  const key = tvHandleKey(handle);
  if (!key) return null;

  const nextHandle = normalizeTvHandle(replacedWith) || null;
  if (key === tvHandleKey(nextHandle)) return null;

  let shared = accessWasShared;
  if (shared == null && studentId) {
    const member = await pool.query(
      `
      SELECT access_shared
      FROM superkandle_members
      WHERE student_id = $1
      `,
      [studentId]
    );
    shared = Boolean(member.rows[0]?.access_shared);
  }

  const result = await pool.query(
    `
    INSERT INTO tradingview_removals (
      student_id,
      username,
      username_key,
      replaced_with,
      reason,
      access_was_shared,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'pending')
    ON CONFLICT (username_key) WHERE status = 'pending'
    DO UPDATE SET
      student_id = COALESCE(EXCLUDED.student_id, tradingview_removals.student_id),
      username = EXCLUDED.username,
      replaced_with = EXCLUDED.replaced_with,
      reason = EXCLUDED.reason,
      access_was_shared =
        tradingview_removals.access_was_shared OR EXCLUDED.access_was_shared,
      created_at = NOW()
    RETURNING *
    `,
    [studentId || null, handle, key, nextHandle, reason, Boolean(shared)]
  );
  return result.rows[0] || null;
}

export async function cancelTradingviewRemoval(username) {
  const key = tvHandleKey(username);
  if (!key) return 0;
  const result = await pool.query(
    `
    UPDATE tradingview_removals
    SET status = 'skipped', processed_at = NOW()
    WHERE username_key = $1
      AND status = 'pending'
    `,
    [key]
  );
  return result.rowCount || 0;
}

/** Active paid SuperKandle membership that has not expired (trial included if still in date). */
export const VALID_SK_PLAN_SQL = `
  m.is_active = TRUE
  AND LOWER(COALESCE(m.payment_status, '')) = 'paid'
  AND (m.expires_at IS NULL OR m.expires_at >= CURRENT_DATE)
`;

export async function resetMemberInvite(studentId) {
  await pool.query(
    `
    UPDATE superkandle_members
    SET
      access_shared = FALSE,
      access_shared_at = NULL,
      access_error = FALSE,
      access_error_message = '',
      updated_at = NOW()
    WHERE student_id = $1
    `,
    [studentId]
  );
}

export async function applyTradingviewUsername(studentId, nextUsername) {
  const current = await pool.query(
    `
    SELECT
      s.tradingview_username,
      m.access_shared,
      (
        m.id IS NOT NULL
        AND ${VALID_SK_PLAN_SQL}
      ) AS has_valid_plan
    FROM students s
    LEFT JOIN superkandle_members m ON m.student_id = s.id
    WHERE s.id = $1
    `,
    [studentId]
  );
  if (!current.rows[0]) return { changed: false };

  const previous = normalizeTvHandle(current.rows[0].tradingview_username);
  const next = normalizeTvHandle(nextUsername);
  const changed = tvHandleKey(previous) !== tvHandleKey(next);

  if (changed && previous) {
    await queueTradingviewRemoval({
      studentId,
      username: previous,
      replacedWith: next || null,
      reason: next ? "updated" : "cleared",
      accessWasShared: Boolean(current.rows[0].access_shared),
    });
  }
  if (changed && next) {
    await cancelTradingviewRemoval(next);
  }
  if (changed && next && current.rows[0].has_valid_plan) {
    await resetMemberInvite(studentId);
  }

  await pool.query(
    `
    UPDATE students
    SET tradingview_username = $1, updated_at = NOW()
    WHERE id = $2
    `,
    [next || null, studentId]
  );

  if (changed) {
    await notifyTradingviewIdUpdated({
      studentId,
      previousUsername: previous,
      nextUsername: next,
    });
  }

  return { changed, previous: previous || null, next: next || null };
}

function registeredStudentShape(row, { tradingviewUsername } = {}) {
  return {
    id: row.id,
    studentId: row.student_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    tradingviewUsername:
      tradingviewUsername || row.tradingview_username || null,
    planId: row.plan_id,
    planName: row.plan_name,
    isTrial: Boolean(row.plan_is_trial),
    amount: row.amount != null ? Number(row.amount) : null,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    paymentDate: row.payment_date,
    expiresAt: row.expires_at,
    expiryState: row.expiry_state,
    isActive: row.is_active,
    accessShared: Boolean(row.access_shared),
    accessSharedAt: row.access_shared_at,
    error: Boolean(row.access_error),
    errorMessage: row.access_error_message || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const inviteSelect = `
  SELECT
    m.id,
    m.student_id,
    m.plan_id,
    m.amount,
    m.payment_status,
    m.payment_date,
    m.payment_method,
    m.payment_note,
    m.expires_at,
    m.is_active,
    m.access_shared,
    m.access_shared_at,
    m.access_error,
    m.access_error_message,
    m.created_at,
    m.updated_at,
    s.first_name,
    s.last_name,
    s.email,
    s.phone,
    s.tradingview_username,
    p.name AS plan_name,
    p.is_trial AS plan_is_trial,
    CASE
      WHEN m.expires_at IS NULL THEN 'unknown'
      WHEN m.expires_at < CURRENT_DATE THEN 'expired'
      WHEN m.expires_at <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring'
      ELSE 'active'
    END AS expiry_state
  FROM superkandle_members m
  JOIN students s ON s.id = m.student_id
  LEFT JOIN superkandle_plans p ON p.id = m.plan_id
`;

export async function listInviteStudents() {
  const result = await pool.query(
    `
    ${inviteSelect}
    WHERE m.access_shared = FALSE
      AND m.access_error = FALSE
      AND ${VALID_SK_PLAN_SQL}
      AND COALESCE(TRIM(s.tradingview_username), '') <> ''
    ORDER BY m.created_at DESC, m.id DESC
    `
  );
  return result.rows.map((row) => registeredStudentShape(row));
}

export async function listRemoveStudents() {
  const result = await pool.query(
    `
    SELECT
      r.id AS removal_id,
      r.username,
      r.created_at AS removal_created_at,
      m.id,
      m.student_id,
      m.plan_id,
      m.amount,
      m.payment_status,
      m.payment_date,
      m.payment_method,
      m.expires_at,
      m.is_active,
      m.access_shared,
      m.access_shared_at,
      m.access_error,
      m.access_error_message,
      m.created_at,
      m.updated_at,
      s.first_name,
      s.last_name,
      s.email,
      s.phone,
      p.name AS plan_name,
      p.is_trial AS plan_is_trial,
      CASE
        WHEN m.expires_at IS NULL THEN 'unknown'
        WHEN m.expires_at < CURRENT_DATE THEN 'expired'
        WHEN m.expires_at <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring'
        ELSE 'active'
      END AS expiry_state
    FROM tradingview_removals r
    LEFT JOIN students s ON s.id = r.student_id
    LEFT JOIN superkandle_members m ON m.student_id = r.student_id
    LEFT JOIN superkandle_plans p ON p.id = m.plan_id
    WHERE r.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM students live
        WHERE LOWER(TRIM(BOTH FROM REPLACE(COALESCE(live.tradingview_username, ''), '@', '')))
          = r.username_key
      )
    ORDER BY r.created_at DESC, r.id DESC
    `
  );

  const seen = new Set();
  const students = [];
  for (const row of result.rows) {
    const handle = normalizeTvHandle(row.username);
    const key = tvHandleKey(handle);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    students.push(
      registeredStudentShape(
        {
          ...row,
          id: row.id || row.removal_id,
          student_id: row.student_id,
          tradingview_username: handle,
          created_at: row.created_at || row.removal_created_at,
        },
        { tradingviewUsername: handle }
      )
    );
  }
  return students;
}

export async function markRemovalsDone(usernames) {
  const keys = [
    ...new Set(
      (Array.isArray(usernames) ? usernames : [usernames])
        .map((value) => tvHandleKey(value))
        .filter(Boolean)
    ),
  ];
  if (!keys.length) return 0;
  const result = await pool.query(
    `
    UPDATE tradingview_removals
    SET status = 'done', processed_at = NOW()
    WHERE status = 'pending'
      AND username_key = ANY($1::text[])
    `,
    [keys]
  );
  return result.rowCount || 0;
}

import pool from "../config/db.js";
import { broadcastSuperkandleAccess } from "../realtime/channels.js";

export const DEFAULT_AMOUNT = 8;

export function effectivePlanPrice(plan) {
  if (!plan) return DEFAULT_AMOUNT;
  if (plan.is_trial) return 0;
  if (plan.offer_price != null && Number(plan.offer_price) >= 0) {
    return Number(plan.offer_price);
  }
  return Number(plan.amount);
}

export function calcExpiresAt(paymentDate, plan) {
  if (!paymentDate || !plan) return null;
  const base = String(paymentDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return null;

  const value = Number(plan.duration_value || plan.duration_months || 1);
  const unit = String(plan.duration_unit || "month").toLowerCase();
  if (!Number.isFinite(value) || value < 1) return null;

  const date = new Date(`${base}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;

  if (unit === "day") date.setDate(date.getDate() + value);
  else if (unit === "week") date.setDate(date.getDate() + value * 7);
  else date.setMonth(date.getMonth() + value);

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayIsoDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function hasUsedTrial(studentId) {
  const result = await pool.query(
    "SELECT 1 FROM superkandle_trial_claims WHERE student_id = $1",
    [studentId]
  );
  return Boolean(result.rows[0]);
}

export async function markTrialClaimed(studentId) {
  await pool.query(
    `
    INSERT INTO superkandle_trial_claims (student_id)
    VALUES ($1)
    ON CONFLICT (student_id) DO NOTHING
    `,
    [studentId]
  );
}

export async function resetAllTrialClaims() {
  const result = await pool.query("DELETE FROM superkandle_trial_claims");
  return result.rowCount || 0;
}

export async function resetTrialClaim(studentId) {
  const result = await pool.query(
    "DELETE FROM superkandle_trial_claims WHERE student_id = $1 RETURNING student_id",
    [studentId]
  );
  return Boolean(result.rows[0]);
}

export async function markTrialClaimedMany(studentIds) {
  if (!studentIds?.length) return;
  await pool.query(
    `
    INSERT INTO superkandle_trial_claims (student_id)
    SELECT UNNEST($1::int[])
    ON CONFLICT (student_id) DO NOTHING
    `,
    [studentIds]
  );
}

export async function activateMembership({
  studentId,
  plan,
  amount,
  paymentStatus = "paid",
  paymentMethod,
  paymentNote,
}) {
  const paymentDate = todayIsoDate();
  const expiresAt = calcExpiresAt(paymentDate, plan);
  const result = await pool.query(
    `
    INSERT INTO superkandle_members (
      student_id,
      plan_id,
      amount,
      payment_status,
      payment_date,
      payment_method,
      payment_note,
      expires_at,
      is_active,
      access_shared,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, FALSE, NOW())
    ON CONFLICT (student_id) DO UPDATE SET
      plan_id = EXCLUDED.plan_id,
      amount = EXCLUDED.amount,
      payment_status = EXCLUDED.payment_status,
      payment_date = EXCLUDED.payment_date,
      payment_method = EXCLUDED.payment_method,
      payment_note = EXCLUDED.payment_note,
      expires_at = EXCLUDED.expires_at,
      is_active = TRUE,
      updated_at = NOW()
    RETURNING id, expires_at
    `,
    [
      studentId,
      plan.id,
      amount,
      paymentStatus,
      paymentDate,
      paymentMethod,
      paymentNote,
      expiresAt,
    ]
  );
  return result.rows[0];
}

export function isUnknownBatchName(name) {
  return /i\s*don'?t\s*know/i.test(String(name || ""));
}

export async function listSelectableBatches() {
  const result = await pool.query(
    `
    SELECT id, name, course_id
    FROM batches
    ORDER BY name ASC
    `
  );
  return result.rows.filter((row) => !isUnknownBatchName(row.name));
}

export async function loadStudentBatches(studentId) {
  const result = await pool.query(
    `
    SELECT b.id, b.name, b.course_id
    FROM enrollments e
    JOIN batches b ON b.id = e.batch_id
    WHERE e.student_id = $1
    ORDER BY b.name ASC
    `,
    [studentId]
  );
  return result.rows;
}

export function studentNeedsBatch(batches) {
  return !batches.some((row) => !isUnknownBatchName(row.name));
}

export async function loadPublicStudent(studentId) {
  const result = await pool.query(
    `
    SELECT id, first_name, last_name, email, phone, tradingview_username
    FROM students
    WHERE id = $1
    `,
    [studentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const batches = await loadStudentBatches(studentId);
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone || "",
    tradingviewUsername: row.tradingview_username || "",
    batches: batches.map((batch) => ({ id: batch.id, name: batch.name })),
    needsBatch: studentNeedsBatch(batches),
  };
}

export async function requireKnownBatch(studentId) {
  const batches = await loadStudentBatches(studentId);
  if (!studentNeedsBatch(batches)) return;
  const error = new Error("Select your batch before continuing");
  error.status = 400;
  error.code = "BATCH_REQUIRED";
  throw error;
}

export async function assignStudentBatch(studentId, batchId, { force = false } = {}) {
  const selectable = await listSelectableBatches();
  const batch = selectable.find((row) => Number(row.id) === Number(batchId));
  if (!batch?.course_id) {
    const error = new Error("Select a valid batch");
    error.status = 400;
    error.code = "BATCH_REQUIRED";
    throw error;
  }

  const current = await loadStudentBatches(studentId);
  if (!studentNeedsBatch(current) && !force) {
    return loadPublicStudent(studentId);
  }

  if (!studentNeedsBatch(current) && force) {
    await pool.query(
      `
      UPDATE enrollments
      SET batch_id = $1, course_id = $2, updated_at = NOW()
      WHERE id = (
        SELECT id
        FROM enrollments
        WHERE student_id = $3
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1
      )
      `,
      [batch.id, batch.course_id, studentId]
    );
    return loadPublicStudent(studentId);
  }

  const updated = await pool.query(
    `
    UPDATE enrollments
    SET
      batch_id = $1,
      course_id = $2,
      updated_at = NOW()
    WHERE student_id = $3
      AND (
        batch_id IS NULL
        OR batch_id IN (
          SELECT id
          FROM batches
          WHERE name ILIKE '%dont know%'
             OR name ILIKE '%don''t know%'
        )
      )
    `,
    [batch.id, batch.course_id, studentId]
  );

  if (!updated.rowCount) {
    await pool.query(
      `
      INSERT INTO enrollments (
        student_id,
        course_id,
        batch_id,
        status,
        payment_status
      )
      VALUES ($1, $2, $3, 'active', 'pending')
      `,
      [studentId, batch.course_id, batch.id]
    );
  }

  return loadPublicStudent(studentId);
}

export async function clearMemberAccessError(studentId) {
  const result = await pool.query(
    `
    UPDATE superkandle_members
    SET
      access_error = FALSE,
      access_error_message = '',
      updated_at = NOW()
    WHERE student_id = $1
      AND access_error = TRUE
    RETURNING id, student_id
    `,
    [studentId]
  );

  for (const row of result.rows) {
    broadcastSuperkandleAccess({
      id: row.id,
      student_id: row.student_id,
      access_error: false,
      access_error_message: "",
      error: false,
      errorMessage: "",
    });
  }

  return result.rowCount || 0;
}

export async function saveTradingviewUsername(studentId, username) {
  const value = String(username || "").trim();
  if (!value) {
    const error = new Error("TradingView ID is required");
    error.status = 400;
    throw error;
  }
  await pool.query(
    `
    UPDATE students
    SET tradingview_username = $1, updated_at = NOW()
    WHERE id = $2
    `,
    [value, studentId]
  );
  await clearMemberAccessError(studentId);
  return loadPublicStudent(studentId);
}

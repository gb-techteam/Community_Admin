import pool from "../config/db.js";

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
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())
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

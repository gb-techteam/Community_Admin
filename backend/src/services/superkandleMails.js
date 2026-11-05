import pool from "../config/db.js";
import {
  sendMembershipActivated,
  sendMembershipExpiring,
  sendMembershipMailSafe,
  smtpReady,
} from "./studentMail.js";
import { loadSettings } from "./portalSettings.js";

async function studentById(studentId) {
  const result = await pool.query(
    `
    SELECT id, first_name, last_name, email, tradingview_username
    FROM students
    WHERE id = $1
    `,
    [studentId]
  );
  return result.rows[0] || null;
}

function durationLabel(value, unit = "month") {
  const n = Number(value) || 1;
  const u = String(unit || "month").toLowerCase();
  if (u === "day") return n === 1 ? "1 day" : `${n} days`;
  if (u === "week") return n === 1 ? "1 week" : `${n} weeks`;
  return n === 1 ? "1 month" : `${n} months`;
}

export async function notifyMembershipActivated({
  studentId,
  planName,
  expiresAt,
  kind,
  amount,
  durationValue,
  durationUnit,
  paymentMethod,
}) {
  const student = await studentById(studentId);
  if (!student?.email) return;
  await sendMembershipMailSafe(() =>
    sendMembershipActivated({
      student,
      planName,
      expiresAt,
      kind,
      amount,
      durationLabel: durationLabel(durationValue, durationUnit),
      paymentMethod,
    })
  );
}

export async function sendDueExpiryNotices() {
  if (!(await smtpReady())) return { sent: 0, skipped: "smtp" };

  const settings = await loadSettings();
  const windowDays = settings.expiryNoticeDays || 7;

  const result = await pool.query(
    `
    SELECT
      m.id,
      m.student_id,
      m.expires_at,
      p.name AS plan_name,
      s.first_name,
      s.last_name,
      s.email,
      (m.expires_at - CURRENT_DATE)::int AS days_left
    FROM superkandle_members m
    JOIN students s ON s.id = m.student_id
    LEFT JOIN superkandle_plans p ON p.id = m.plan_id
    WHERE m.is_active = TRUE
      AND m.expires_at IS NOT NULL
      AND s.email IS NOT NULL
      AND TRIM(s.email) <> ''
      AND m.expires_at > CURRENT_DATE
      AND m.expires_at <= CURRENT_DATE + ($1::int * INTERVAL '1 day')
    `,
    [windowDays]
  );

  let sent = 0;
  for (const row of result.rows) {
    const daysLeft = Number(row.days_left);
    const noticeType = daysLeft <= 1 ? "day" : "week";
    if (daysLeft > 1 && daysLeft < 7 && noticeType === "week") {
      // If we missed the exact 7-day mark, still send one weekly reminder
      // the first time we see them inside the 7-day window.
    }

    const claimed = await pool.query(
      `
      INSERT INTO superkandle_expiry_notices (member_id, expires_at, notice_type)
      VALUES ($1, $2, $3)
      ON CONFLICT (member_id, expires_at, notice_type) DO NOTHING
      RETURNING id
      `,
      [row.id, row.expires_at, noticeType]
    );
    if (!claimed.rows[0]) continue;

    try {
      await sendMembershipExpiring({
        student: row,
        planName: row.plan_name,
        expiresAt: row.expires_at,
        daysLeft,
      });
      sent += 1;
    } catch (error) {
      console.error("Expiry mail failed:", error.message);
      await pool.query(
        "DELETE FROM superkandle_expiry_notices WHERE id = $1",
        [claimed.rows[0].id]
      );
    }
  }

  return { sent };
}

export function startExpiryMailJob() {
  const run = async () => {
    try {
      const result = await sendDueExpiryNotices();
      if (result.sent) {
        console.log(`SuperKandle expiry mails sent: ${result.sent}`);
      }
    } catch (error) {
      console.error("Expiry mail job failed:", error.message);
    }
  };

  run();
  const sixHours = 6 * 60 * 60 * 1000;
  setInterval(run, sixHours);
}

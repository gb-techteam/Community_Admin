import pool from "../config/db.js";
import {
  buildPlansUpdatedMail,
  sendInvitationFailed,
  sendInvitationShared,
  sendMembershipActivated,
  sendTradingviewIdUpdated,
  sendMembershipExpiring,
  sendMembershipMailSafe,
  sendPlansUpdatedMail,
  smtpReady,
} from "./studentMail.js";
import { loadSettings } from "./portalSettings.js";
import { sendWhatsAppSafe, whatsappReady } from "./whatsapp.js";

async function studentById(studentId) {
  const result = await pool.query(
    `
    SELECT id, first_name, last_name, email, phone, tradingview_username
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

function firstName(student) {
  return student?.first_name || student?.firstName || "there";
}

function accessUntil(expiresAt) {
  return expiresAt ? String(expiresAt).slice(0, 10) : "the plan end date";
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
  if (!student) return;
  if (student.email) {
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
  const trial = kind === "trial";
  const plan = planName || "SuperKandle";
  await sendWhatsAppSafe({
    phone: student.phone,
    text: `Hi ${firstName(student)}, your SuperKandle ${
      trial ? "free trial" : "payment"
    } is complete.

Plan: ${plan}
Access until: ${accessUntil(expiresAt)}

You will get the TradingView invitation within 1–2 hours.`,
  });
}

export async function notifyMembershipActivatedOnce(studentId) {
  const claimed = await pool.query(
    `
    UPDATE superkandle_members
    SET activation_mail_sent_at = NOW(), updated_at = NOW()
    WHERE student_id = $1
      AND activation_mail_sent_at IS NULL
    RETURNING id, plan_id, amount, expires_at, payment_method
    `,
    [studentId]
  );
  const member = claimed.rows[0];
  if (!member) return false;

  const plan = member.plan_id
    ? (
        await pool.query(
          `
          SELECT
            name,
            is_trial,
            COALESCE(duration_value, duration_months, 1) AS duration_value,
            COALESCE(NULLIF(duration_unit, ''), 'month') AS duration_unit
          FROM superkandle_plans
          WHERE id = $1
          `,
          [member.plan_id]
        )
      ).rows[0]
    : null;

  await notifyMembershipActivated({
    studentId,
    planName: plan?.name,
    expiresAt: member.expires_at,
    kind: plan?.is_trial ? "trial" : "paid",
    amount: member.amount,
    durationValue: plan?.duration_value,
    durationUnit: plan?.duration_unit,
    paymentMethod: member.payment_method,
  });
  return true;
}

async function studentForMail(studentId, studentRow) {
  const loaded = await studentById(studentId);
  return {
    ...loaded,
    first_name:
      studentRow?.first_name || studentRow?.firstName || loaded?.first_name,
    last_name:
      studentRow?.last_name || studentRow?.lastName || loaded?.last_name,
    email: String(studentRow?.email || loaded?.email || "").trim(),
    phone: studentRow?.phone || loaded?.phone || "",
    tradingview_username:
      studentRow?.tradingview_username ||
      studentRow?.tradingviewUsername ||
      loaded?.tradingview_username ||
      "",
  };
}

export async function notifyTradingviewIdUpdated({
  studentId,
  previousUsername,
  nextUsername,
}) {
  const student = await studentById(studentId);
  if (!student) return { sent: false };
  const fromId = String(previousUsername || "").trim() || "(none)";
  const toId = String(nextUsername || "").trim() || "(removed)";
  let sent = false;
  if (student.email) {
    await sendMembershipMailSafe(() =>
      sendTradingviewIdUpdated({
        student,
        previousUsername: fromId,
        nextUsername: toId,
      })
    );
    sent = true;
  }
  await sendWhatsAppSafe({
    phone: student.phone,
    text: `Hi ${firstName(student)}, your SuperKandle TradingView ID was updated.

From: ${fromId}
To: ${toId}`,
  });
  return { sent };
}

export async function notifyInvitationShared(studentId, studentRow = null) {
  const student = await studentForMail(studentId, studentRow);
  const email = String(student?.email || "").trim();
  const tvUser = String(student?.tradingview_username || "").trim();
  let mail = { sent: false, error: email ? "" : "Student has no email" };
  if (email) {
    try {
      await sendInvitationShared({ student: { ...student, email } });
      console.log("Invitation shared mail sent to", email);
      mail = { sent: true };
    } catch (error) {
      console.error("Invitation shared mail failed:", error.message);
      mail = { sent: false, error: error.message };
    }
  } else {
    console.error("Invitation shared mail skipped:", mail.error, studentId);
  }
  await sendWhatsAppSafe({
    phone: student?.phone,
    text: `Hi ${firstName(student)}, your SuperKandle TradingView invitation has been shared${
      tvUser ? ` to ${tvUser}` : ""
    }.

On TradingView: Indicators → Invite-only scripts. SuperKandle will show there once you are logged in with that ID.`,
  });
  return mail;
}

export async function notifyInvitationFailed(studentId, errorMessage, studentRow = null) {
  const student = await studentForMail(studentId, studentRow);
  const email = String(student?.email || "").trim();
  const tvUser = String(student?.tradingview_username || "").trim();
  const detail =
    String(errorMessage || "").trim() ||
    "TradingView could not share the invite.";
  let mail = { sent: false, error: email ? "" : "Student has no email" };
  if (email) {
    try {
      await sendInvitationFailed({
        student: { ...student, email },
        errorMessage,
      });
      console.log("Invitation error mail sent to", email);
      mail = { sent: true };
    } catch (error) {
      console.error("Invitation error mail failed:", error.message);
      mail = { sent: false, error: error.message };
    }
  } else {
    console.error("Invitation error mail skipped:", mail.error, studentId);
  }
  const settings = await loadSettings();
  const updateLink = `${String(settings.publicAppUrl || "").replace(/\/$/, "")}/update-tradingview`;
  await sendWhatsAppSafe({
    phone: student?.phone,
    text: `Hi ${firstName(student)}, we could not share the SuperKandle TradingView invitation.

Error: ${detail}
${tvUser ? `TradingView ID on file: ${tvUser}\n` : ""}Update the ID here: ${updateLink}`,
  });
  return mail;
}

export async function sendDueExpiryNotices() {
  const canMail = await smtpReady();
  const canWhatsApp = whatsappReady();
  if (!canMail && !canWhatsApp) return { sent: 0, skipped: "smtp" };

  const settings = await loadSettings();
  const windowDays = settings.expiryNoticeDays || 7;
  const renewLink = String(settings.publicAppUrl || "").replace(/\/$/, "");

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
      s.phone,
      (m.expires_at - CURRENT_DATE)::int AS days_left
    FROM superkandle_members m
    JOIN students s ON s.id = m.student_id
    LEFT JOIN superkandle_plans p ON p.id = m.plan_id
    WHERE m.is_active = TRUE
      AND m.expires_at IS NOT NULL
      AND (
        (s.email IS NOT NULL AND TRIM(s.email) <> '')
        OR (s.phone IS NOT NULL AND TRIM(s.phone) <> '')
      )
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
      if (canMail && String(row.email || "").trim()) {
        await sendMembershipExpiring({
          student: row,
          planName: row.plan_name,
          expiresAt: row.expires_at,
          daysLeft,
        });
      }
      const when = accessUntil(row.expires_at);
      await sendWhatsAppSafe({
        phone: row.phone,
        text: `Hi ${firstName(row)}, your SuperKandle plan (${
          row.plan_name || "SuperKandle"
        }) expires on ${when}.

Renew here to keep access: ${renewLink}`,
      });
      sent += 1;
    } catch (error) {
      console.error("Expiry notice failed:", error.message);
      await pool.query(
        "DELETE FROM superkandle_expiry_notices WHERE id = $1",
        [claimed.rows[0].id]
      );
    }
  }

  return { sent };
}

async function loadActivePlans() {
  const result = await pool.query(
    `
    SELECT
      name,
      amount,
      offer_price,
      is_trial,
      COALESCE(duration_value, duration_months, 1) AS duration_value,
      COALESCE(NULLIF(duration_unit, ''), 'month') AS duration_unit
    FROM superkandle_plans
    WHERE is_active = TRUE
    ORDER BY is_trial DESC, amount ASC, id ASC
    `
  );
  return result.rows;
}

async function loadPlanMailRecipients() {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (LOWER(TRIM(email)))
      id,
      first_name,
      last_name,
      email
    FROM students
    WHERE email IS NOT NULL
      AND TRIM(email) <> ''
      AND email LIKE '%@%'
    ORDER BY LOWER(TRIM(email)), id
    `
  );
  return result.rows;
}

export async function previewPlansUpdatedMail() {
  const plans = await loadActivePlans();
  const recipients = await loadPlanMailRecipients();
  const mail = await buildPlansUpdatedMail({
    student: { first_name: "there" },
    displayPricedPlans: true,
    plans,
  });
  return {
    ...mail,
    recipientCount: recipients.length,
    smtpReady: await smtpReady(),
  };
}

export async function sendPlansUpdatedBroadcast() {
  if (!(await smtpReady())) {
    const error = new Error("SMTP is not configured, so the email cannot be sent.");
    error.status = 503;
    throw error;
  }
  const plans = await loadActivePlans();
  const recipients = await loadPlanMailRecipients();
  let sent = 0;
  let failed = 0;
  for (const student of recipients) {
    try {
      await sendPlansUpdatedMail({
        student,
        displayPricedPlans: true,
        plans,
      });
      sent += 1;
      await new Promise((resolve) => setTimeout(resolve, 80));
    } catch (error) {
      failed += 1;
      console.error("Plans update mail failed:", student.email, error.message);
      if (error.code === "EMAIL_DAILY_LIMIT" || error.status === 503) {
        return {
          sent,
          failed,
          remaining: Math.max(0, recipients.length - sent - failed),
          stopped: true,
          message: error.message,
        };
      }
    }
  }
  return {
    sent,
    failed,
    remaining: 0,
    stopped: false,
    message: `Sent ${sent} of ${recipients.length} emails.`,
  };
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

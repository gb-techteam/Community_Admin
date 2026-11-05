import nodemailer from "nodemailer";
import { loadSettings } from "./portalSettings.js";

export async function smtpReady() {
  const settings = await loadSettings();
  return Boolean(settings.smtpHost && settings.smtpUser && settings.smtpPass);
}

async function subscribeUrl() {
  const settings = await loadSettings();
  return String(settings.publicAppUrl || "http://localhost:5174").replace(
    /\/$/,
    ""
  );
}

async function sendMail({ to, subject, text, html }) {
  const settings = await loadSettings();
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    throw new Error("Email is not configured");
  }
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: Number(settings.smtpPort || 587),
    secure: String(settings.smtpPort || "587") === "465",
    auth: {
      user: settings.smtpUser,
      pass: settings.smtpPass,
    },
  });
  await transporter.sendMail({
    from: settings.smtpFrom || settings.smtpUser,
    to,
    subject,
    text,
    html,
  });
}

function layout(title, bodyHtml) {
  return `<div style="font-family:Inter,Arial,sans-serif;background:#f4f7fb;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7edf3;border-radius:16px;padding:24px 28px;color:#1b2430">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b97a3">SuperKandle</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600">${title}</h1>
    ${bodyHtml}
  </div>
</div>`;
}

function firstName(student) {
  return student?.first_name || student?.firstName || "there";
}

export async function sendStudentOtp(email, code) {
  await sendMail({
    to: email,
    subject: "Your SuperKandle verification code",
    text: `Your SuperKandle verification code is ${code}. It expires in 10 minutes.`,
    html: layout(
      "Verification code",
      `<p>Your SuperKandle verification code is <strong>${code}</strong>.</p><p style="color:#667482">It expires in 10 minutes.</p>`
    ),
  });
}

function moneyLine(amount, trial) {
  if (trial || Number(amount) === 0) return "Free";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "Paid";
  return `${n.toFixed(2)} USDT (BEP20)`;
}

function paymentLabel(method, trial) {
  if (trial || method === "free_trial") return "Free trial";
  if (method === "USDT-BEP20") return "USDT on BNB Smart Chain (BEP20)";
  return method || "Completed";
}

export async function sendMembershipActivated({
  student,
  planName,
  expiresAt,
  kind,
  amount,
  durationLabel,
  paymentMethod,
}) {
  const name = firstName(student);
  const when = expiresAt ? String(expiresAt).slice(0, 10) : "the plan end date";
  const trial = kind === "trial";
  const tvUser = String(student.tradingview_username || "").trim();
  const plan = planName || "SuperKandle";
  const duration = durationLabel || "as per plan";
  const paid = moneyLine(amount, trial);
  const payHow = paymentLabel(paymentMethod, trial);
  const subject = trial
    ? "Your SuperKandle free trial is ready"
    : "Payment complete — SuperKandle subscription is active";

  const text = `Hi ${name},

Your SuperKandle ${trial ? "free trial" : "payment"} is complete.

Plan: ${plan}
Duration: ${duration}
Amount: ${paid}
Payment: ${payHow}
Access until: ${when}
${tvUser ? `TradingView ID: ${tvUser}` : ""}

Find your invite on TradingView:
1. Log in to TradingView with the same username on your student profile.
2. Open any chart.
3. Click Indicators.
4. Open the Invite-only scripts section.
5. SuperKandle will appear there after the invite is sent.

If you do not see it yet, wait a few minutes and refresh, or confirm your TradingView username with the academy.`;

  await sendMail({
    to: student.email,
    subject,
    text,
    html: layout(
      trial ? "Free trial is ready" : "Payment complete",
      `<p>Hi ${name},</p>
       <p>Your SuperKandle ${trial ? "free trial" : "subscription payment"} is complete and access is now active.</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
         <tr><td style="padding:8px 0;color:#667482;width:140px">Plan</td><td style="padding:8px 0"><strong>${plan}</strong></td></tr>
         <tr><td style="padding:8px 0;color:#667482">Duration</td><td style="padding:8px 0">${duration}</td></tr>
         <tr><td style="padding:8px 0;color:#667482">Amount</td><td style="padding:8px 0">${paid}</td></tr>
         <tr><td style="padding:8px 0;color:#667482">Payment</td><td style="padding:8px 0">${payHow}</td></tr>
         <tr><td style="padding:8px 0;color:#667482">Access until</td><td style="padding:8px 0">${when}</td></tr>
         ${
           tvUser
             ? `<tr><td style="padding:8px 0;color:#667482">TradingView ID</td><td style="padding:8px 0">${tvUser}</td></tr>`
             : ""
         }
       </table>
       <div style="margin:18px 0;padding:14px 16px;border-radius:12px;background:#f6f8fb;border:1px solid #e7edf3">
         <p style="margin:0 0 8px;font-weight:600">Where to find your TradingView invite</p>
         <ol style="margin:0;padding-left:18px;color:#35557a;line-height:1.55">
           <li>Log in to TradingView with the username on your student profile${tvUser ? ` (<strong>${tvUser}</strong>)` : ""}.</li>
           <li>Open any chart.</li>
           <li>Click <strong>Indicators</strong>.</li>
           <li>Open the <strong>Invite-only</strong> scripts section.</li>
           <li>SuperKandle will show there after we send the invite.</li>
         </ol>
       </div>
       <p style="color:#667482;font-size:13px">If it is not listed yet, wait a few minutes and refresh. Make sure the TradingView username on your student profile is correct.</p>`
    ),
  });
}

export async function sendMembershipExpiring({
  student,
  planName,
  expiresAt,
  daysLeft,
}) {
  const name = firstName(student);
  const when = expiresAt ? String(expiresAt).slice(0, 10) : "soon";
  const link = await subscribeUrl();
  const subject =
    daysLeft <= 1
      ? "Your SuperKandle access expires tomorrow"
      : `Your SuperKandle access expires in ${daysLeft} days`;

  await sendMail({
    to: student.email,
    subject,
    text: `Hi ${name}, your SuperKandle plan (${planName}) expires on ${when}. Renew here: ${link}`,
    html: layout(
      "Access expiring soon",
      `<p>Hi ${name},</p>
       <p>Your SuperKandle plan <strong>${planName || "SuperKandle"}</strong> expires on <strong>${when}</strong>.</p>
       <p>Renew with USDT (BEP20) to keep access:</p>
       <p><a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1a4a3f;color:#fff;text-decoration:none;font-weight:600">Renew membership</a></p>`
    ),
  });
}

export async function sendMembershipMailSafe(fn) {
  try {
    await fn();
  } catch (error) {
    console.error("SuperKandle mail failed:", error.message);
  }
}

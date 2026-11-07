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

function mailFrom(settings) {
  const raw = String(settings.smtpFrom || settings.smtpUser || "").trim();
  const bracket = raw.match(/^(.*)<([^>]+)>\s*$/);
  if (bracket) {
    return {
      name:
        bracket[1].replace(/^["']|["']$/g, "").trim() ||
        "GREENBONDS GROWTH ACADEMY",
      address: bracket[2].trim(),
    };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  if (last.includes("@") && parts.length > 1) {
    return {
      name: parts.slice(0, -1).join(" ").replace(/^["']|["']$/g, ""),
      address: last,
    };
  }
  return {
    name: "GREENBONDS GROWTH ACADEMY",
    address: raw.includes("@") ? raw : settings.smtpUser,
  };
}

export const EMAIL_DAILY_LIMIT_MESSAGE =
  "Daily limit reached. Please try again after some time.";

export class StudentMailError extends Error {
  constructor(message, { status = 503, cause, code } = {}) {
    super(message);
    this.status = status;
    this.cause = cause;
    this.code = code;
  }
}

function errorBlob(error) {
  return `${error?.message || ""} ${error?.response || ""} ${error?.code || ""} ${error?.responseCode || ""}`.toLowerCase();
}

function isDailyLimitError(error) {
  const blob = errorBlob(error);
  return (
    blob.includes("quota") ||
    blob.includes("daily sending") ||
    blob.includes("daily user sending") ||
    blob.includes("sending quota exceeded") ||
    blob.includes("5.4.5") ||
    blob.includes("user sending") ||
    blob.includes("too many messages") ||
    blob.includes("rate limit") ||
    blob.includes("try again later") && blob.includes("4.7.0")
  );
}

function dailyLimitError() {
  return new StudentMailError(EMAIL_DAILY_LIMIT_MESSAGE, {
    status: 503,
    code: "EMAIL_DAILY_LIMIT",
  });
}

function studentMailMessage(error) {
  if (isDailyLimitError(error)) return EMAIL_DAILY_LIMIT_MESSAGE;
  const blob = errorBlob(error);
  if (
    blob.includes("eauth") ||
    blob.includes("invalid login") ||
    blob.includes("username and password") ||
    blob.includes("bad credentials")
  ) {
    return "The academy email sender is not accepting login. Please contact the academy.";
  }
  if (
    blob.includes("etimedout") ||
    blob.includes("econnection") ||
    blob.includes("esocket") ||
    blob.includes("timeout")
  ) {
    return "Could not send the verification email. Try again in a minute.";
  }
  return "Could not send the verification email. Check spam, or try again in a minute.";
}

let quotaBlockedUntil = 0;

let cachedTransport = null;
let cachedTransportKey = "";

function getTransport(settings) {
  const port = Number(settings.smtpPort || 587);
  const key = `${settings.smtpHost}|${port}|${settings.smtpUser}|${settings.smtpPass}`;
  if (cachedTransport && cachedTransportKey === key) return cachedTransport;
  if (cachedTransport) {
    cachedTransport.close();
    cachedTransport = null;
  }
  cachedTransportKey = key;
  cachedTransport = nodemailer.createTransport({
    host: settings.smtpHost,
    port,
    secure: String(port) === "465",
    requireTLS: port === 587,
    pool: true,
    maxConnections: 2,
    maxMessages: 40,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 20_000,
    auth: {
      user: settings.smtpUser,
      pass: String(settings.smtpPass || "").trim(),
    },
  });
  return cachedTransport;
}

async function sendMail({ to, subject, text, html }) {
  const settings = await loadSettings();
  if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
    throw new StudentMailError(
      "Email OTP is not configured yet. Ask the academy to set SMTP so a code can be sent to your email."
    );
  }
  if (Date.now() < quotaBlockedUntil) {
    throw dailyLimitError();
  }
  const from = mailFrom(settings);
  try {
    await getTransport(settings).sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
  } catch (error) {
    console.error("SMTP send error:", error.message, error.code || "", error.response || "");
    if (isDailyLimitError(error)) {
      quotaBlockedUntil = Date.now() + 6 * 60 * 60 * 1000;
      throw dailyLimitError();
    }
    throw new StudentMailError(studentMailMessage(error), { cause: error });
  }
}

function layout(title, bodyHtml, brand = "SuperKandle") {
  return `<div style="font-family:Inter,Arial,sans-serif;background:#f4f7fb;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e7edf3;border-radius:16px;padding:24px 28px;color:#1b2430">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8b97a3">${brand}</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:600">${title}</h1>
    ${bodyHtml}
  </div>
</div>`;
}

function firstName(student) {
  return student?.first_name || student?.firstName || "there";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendStudentRequestApproved({ student }) {
  const name = firstName(student);
  const email = String(student?.email || "").trim();
  if (!email) throw new Error("Student has no email");
  const link = await subscribeUrl();

  const text = `Hi ${name},

Academy management has approved your student request.

You can now access all Wealth Club products.

You can also take SuperKandle plans here:
${link}`;

  await sendMail({
    to: email,
    subject: "Your Greenbonds student request is approved",
    text,
    html: layout(
      "Student request approved",
      `<p>Hi ${escapeHtml(name)},</p>
       <p>Academy management has approved your student request.</p>
       <p>You can now access all Wealth Club products.</p>
       <p>You can also take SuperKandle plans from the subscribe page:</p>
       <p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1a4a3f;color:#fff;text-decoration:none;font-weight:600">View SuperKandle plans</a></p>
       <p style="color:#667482;font-size:13px">${escapeHtml(link)}</p>`,
      "Greenbonds"
    ),
  });
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

function invitationGuide(tvUser) {
  const userLine = tvUser
    ? `Log in to TradingView with the username on your student profile (${tvUser}).`
    : "Log in to TradingView with the username on your student profile.";
  return {
    text: `How to find the SuperKandle invite on TradingView:
1. ${userLine}
2. Open any chart.
3. Click Indicators.
4. Open the Invite-only scripts section.
5. SuperKandle will appear there once the invite is on your account.`,
    html: `<div style="margin:18px 0;padding:14px 16px;border-radius:12px;background:#f6f8fb;border:1px solid #e7edf3">
         <p style="margin:0 0 8px;font-weight:600">Where to find your TradingView invite</p>
         <ol style="margin:0;padding-left:18px;color:#35557a;line-height:1.55">
           <li>Log in to TradingView with the username on your student profile${tvUser ? ` (<strong>${escapeHtml(tvUser)}</strong>)` : ""}.</li>
           <li>Open any chart.</li>
           <li>Click <strong>Indicators</strong>.</li>
           <li>Open the <strong>Invite-only</strong> scripts section.</li>
           <li>SuperKandle will show there once the invite is on your account.</li>
         </ol>
       </div>`,
  };
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
  const guide = invitationGuide(tvUser);
  const subject = trial
    ? "Your SuperKandle free trial is ready"
    : "Payment complete — SuperKandle subscription";

  const text = `Hi ${name},

Your SuperKandle ${trial ? "free trial" : "payment"} is complete.

Plan: ${plan}
Duration: ${duration}
Amount: ${paid}
Payment: ${payHow}
Access until: ${when}
${tvUser ? `TradingView ID: ${tvUser}` : ""}

You will get the TradingView invitation within 1-2 hours.

${guide.text}`;

  await sendMail({
    to: student.email,
    subject,
    text,
    html: layout(
      trial ? "Free trial is ready" : "Payment complete",
      `<p>Hi ${name},</p>
       <p>Your SuperKandle ${trial ? "free trial" : "subscription payment"} is complete.</p>
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
       <p><strong>You will get the TradingView invitation within 1–2 hours.</strong></p>
       ${guide.html}`
    ),
  });
}

export async function sendInvitationShared({ student }) {
  const name = firstName(student);
  const tvUser = String(student.tradingview_username || "").trim();
  const guide = invitationGuide(tvUser);

  const text = `Hi ${name},

Your SuperKandle TradingView invitation has been shared${tvUser ? ` to ${tvUser}` : ""}.

${guide.text}

If it is not listed yet, refresh TradingView and confirm you are logged in with the same username.`;

  await sendMail({
    to: student.email,
    subject: "Your SuperKandle invitation has been shared",
    text,
    html: layout(
      "Invitation shared",
      `<p>Hi ${escapeHtml(name)},</p>
       <p>Your SuperKandle TradingView invitation has been shared${
         tvUser ? " to the username on your student profile." : "."
       }</p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
         <tr><td style="padding:8px 0;color:#667482;width:140px">Status</td><td style="padding:8px 0"><strong>Shared</strong></td></tr>
         ${
           tvUser
             ? `<tr><td style="padding:8px 0;color:#667482">TradingView ID</td><td style="padding:8px 0">${escapeHtml(tvUser)}</td></tr>`
             : ""
         }
       </table>
       ${guide.html}
       <p style="color:#667482;font-size:13px">If it is not listed yet, refresh TradingView and confirm you are logged in with the same username.</p>`
    ),
  });
}

export async function sendInvitationFailed({ student, errorMessage }) {
  const name = firstName(student);
  const tvUser = String(student.tradingview_username || "").trim();
  const detail =
    String(errorMessage || "").trim() ||
    "TradingView could not share the invite.";
  const updateLink = `${await subscribeUrl()}/update-tradingview`;

  const text = `Hi ${name},

Alert: we could not share the SuperKandle TradingView invitation.

Error: ${detail}
${tvUser ? `TradingView ID on file: ${tvUser}` : ""}

If this username is wrong, verify your student email and update it here:
${updateLink}

The academy can share the invite again after you save the correct TradingView ID.`;

  await sendMail({
    to: student.email,
    subject: "Alert: SuperKandle invitation failed",
    text,
    html: layout(
      "Alert: invitation failed",
      `<p>Hi ${escapeHtml(name)},</p>
       <p><strong>We could not share the SuperKandle TradingView invitation.</strong></p>
       <div style="margin:16px 0;padding:14px 16px;border-radius:12px;background:#fff6f4;border:1px solid #f3d4ce;color:#8a2f24">
         <p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase">Error</p>
         <p style="margin:0;font-weight:600">${escapeHtml(detail)}</p>
       </div>
       ${
         tvUser
           ? `<p>TradingView ID on file: <strong>${escapeHtml(tvUser)}</strong></p>`
           : ""
       }
       <p>If this username is invalid, verify your student email and update the TradingView ID so the invite can be shared again.</p>
       <p><a href="${escapeHtml(updateLink)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#1a4a3f;color:#fff;text-decoration:none;font-weight:600">Update TradingView ID</a></p>
       <p style="color:#667482;font-size:13px">${escapeHtml(updateLink)}</p>`
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

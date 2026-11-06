import crypto from "crypto";
import express from "express";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { requireStudent } from "../middleware/studentAuth.js";
import { sendStudentOtp, smtpReady } from "../services/studentMail.js";
import {
  isTxHash,
  receiveWallet,
  verifyUsdtBep20Transfer,
} from "../services/bscUsdt.js";
import {
  activateMembership,
  assignStudentBatch,
  effectivePlanPrice,
  hasUsedTrial,
  listSelectableBatches,
  loadPublicStudent,
  markTrialClaimed,
  requireKnownBatch,
  saveTradingviewUsername,
} from "../services/superkandleAccess.js";
import { notifyMembershipActivatedOnce } from "../services/superkandleMails.js";
import { loadSettings } from "../services/portalSettings.js";

const router = express.Router();

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function hashCode(code) {
  return crypto
    .createHash("sha256")
    .update(`${code}:${process.env.JWT_SECRET || "sk"}`)
    .digest("hex");
}

async function findStudentByEmail(email) {
  const result = await pool.query(
    `
    SELECT id, first_name, last_name, email, phone
    FROM students
    WHERE LOWER(TRIM(email)) = $1
    LIMIT 1
    `,
    [email]
  );
  return result.rows[0] || null;
}

async function getActivePlan(planId) {
  const result = await pool.query(
    `
    SELECT
      p.*,
      COALESCE(p.duration_value, p.duration_months, 1) AS duration_value,
      COALESCE(NULLIF(p.duration_unit, ''), 'month') AS duration_unit
    FROM superkandle_plans p
    WHERE p.id = $1 AND p.is_active = TRUE
    `,
    [planId]
  );
  return result.rows[0] || null;
}

async function membershipFor(studentId) {
  const result = await pool.query(
    `
    SELECT
      m.id,
      m.plan_id,
      m.amount,
      m.payment_status,
      m.payment_method,
      m.expires_at,
      m.is_active,
      p.name AS plan_name,
      p.is_trial AS plan_is_trial,
      CASE
        WHEN m.expires_at IS NULL THEN 'unknown'
        WHEN m.expires_at < CURRENT_DATE THEN 'expired'
        WHEN m.expires_at <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring'
        ELSE 'active'
      END AS expiry_state
    FROM superkandle_members m
    LEFT JOIN superkandle_plans p ON p.id = m.plan_id
    WHERE m.student_id = $1
    `,
    [studentId]
  );
  return result.rows[0] || null;
}

function httpError(res, error, fallback) {
  if (error.status) {
    return res.status(error.status).json({
      success: false,
      code: error.code,
      message: error.message,
    });
  }
  console.error(fallback, error.message);
  return res.status(500).json({ success: false, message: fallback });
}

router.post("/request-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Enter the email on your student profile",
      });
    }

    const student = await findStudentByEmail(email);
    if (!student) {
      return res.status(404).json({
        success: false,
        code: "EMAIL_NOT_FOUND",
        message:
          "This email is not in the students list. Please confirm you entered the exact academy email, or fill the request form.",
      });
    }

    if (!(await smtpReady())) {
      return res.status(503).json({
        success: false,
        message:
          "Email OTP is not configured yet. Ask the academy to set SMTP so a code can be sent to your email.",
      });
    }

    const recent = await pool.query(
      `
      SELECT created_at
      FROM superkandle_student_otps
      WHERE student_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [student.id]
    );
    if (recent.rows[0]) {
      const ageMs = Date.now() - new Date(recent.rows[0].created_at).getTime();
      if (ageMs < 60_000) {
        return res.status(429).json({
          success: false,
          message: "Wait a minute before requesting another code",
        });
      }
    }

    const code = String(crypto.randomInt(100000, 1000000));
    await pool.query(
      `
      INSERT INTO superkandle_student_otps (student_id, email, code_hash, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')
      `,
      [student.id, email, hashCode(code)]
    );

    await sendStudentOtp(email, code);

    res.json({
      success: true,
      method: "otp",
      message: "We sent a 6-digit code to your student email.",
    });
  } catch (error) {
    console.error("Subscribe request OTP error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not start verification",
    });
  }
});

router.post("/verify", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const code = String(req.body.code || "").trim();
    const student = await findStudentByEmail(email);

    if (!student) {
      return res.status(403).json({
        success: false,
        message: "This link is only for enrolled students.",
      });
    }

    const otp = await pool.query(
      `
      SELECT id, code_hash, attempts, expires_at
      FROM superkandle_student_otps
      WHERE student_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [student.id]
    );
    const row = otp.rows[0];
    if (!row || new Date(row.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Code expired. Request a new one.",
      });
    }
    if (row.attempts >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Request a new code.",
      });
    }
    await pool.query(
      "UPDATE superkandle_student_otps SET attempts = attempts + 1 WHERE id = $1",
      [row.id]
    );

    if (row.code_hash !== hashCode(code)) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    const token = jwt.sign(
      {
        role: "student",
        studentId: student.id,
        email: student.email,
        name: [student.first_name, student.last_name].filter(Boolean).join(" "),
      },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );

    res.json({
      success: true,
      token,
      student: await loadPublicStudent(student.id),
    });
  } catch (error) {
    console.error("Subscribe verify error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not verify student",
    });
  }
});

router.get("/batches", async (_req, res) => {
  try {
    const batches = await listSelectableBatches();
    res.json({
      success: true,
      batches: batches.map((batch) => ({ id: batch.id, name: batch.name })),
    });
  } catch (error) {
    console.error("Subscribe batches error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load batches" });
  }
});

router.get("/session", requireStudent, async (req, res) => {
  try {
    const student = await loadPublicStudent(req.student.studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const trialUsed = await hasUsedTrial(req.student.studentId);
    const membership = await membershipFor(req.student.studentId);

    res.json({
      success: true,
      student,
      trialUsed,
      membership,
      payment: {
        token: "USDT",
        network: "BEP20",
        networkName: "BNB Smart Chain",
        wallet: await receiveWallet(),
      },
    });
  } catch (error) {
    console.error("Subscribe session error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load session" });
  }
});

function positiveId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function activateSelectedPlan(studentId, { planId, paymentId }) {
  const payId = positiveId(paymentId);
  if (payId) {
    const order = await loadCheckoutOrder(payId, studentId);
    if (!order || order.status !== "confirmed") {
      const error = new Error(
        "Payment is not confirmed yet. Complete payment first."
      );
      error.status = 400;
      throw error;
    }
    await activateMembership({
      studentId,
      plan: {
        id: order.plan_id,
        duration_value: order.duration_value,
        duration_months: order.duration_months,
        duration_unit: order.duration_unit,
      },
      amount: Number(order.amount),
      paymentStatus: "paid",
      paymentMethod: "USDT-BEP20",
      paymentNote: order.tx_hash ? `tx ${order.tx_hash}` : `payment ${order.id}`,
    });
    return;
  }

  const selectedPlanId = positiveId(planId);
  const plan = await getActivePlan(selectedPlanId);
  if (!plan?.is_trial) {
    const error = new Error("Select a plan again");
    error.status = 400;
    throw error;
  }
  if (await hasUsedTrial(studentId)) {
    const error = new Error("You already used your free trial");
    error.status = 409;
    throw error;
  }
  await markTrialClaimed(studentId);
  await activateMembership({
    studentId,
    plan,
    amount: 0,
    paymentStatus: "paid",
    paymentMethod: "free_trial",
    paymentNote: "Student self-serve free trial",
  });
}

router.patch("/profile", requireStudent, async (req, res) => {
  try {
    const studentId = req.student.studentId;
    if (req.body.batchId != null && req.body.batchId !== "") {
      await assignStudentBatch(studentId, req.body.batchId, {
        force: Boolean(req.body.confirmBatch),
      });
    }
    if (req.body.tradingviewUsername != null) {
      await saveTradingviewUsername(studentId, req.body.tradingviewUsername);
    }
    if (req.body.confirmBatch) {
      const current = await membershipFor(studentId);
      if (!current?.plan_id) {
        await activateSelectedPlan(studentId, {
          planId: req.body.planId,
          paymentId: req.body.paymentId,
        });
      }
      await notifyMembershipActivatedOnce(studentId);
    }
    const student = await loadPublicStudent(studentId);
    res.json({
      success: true,
      student,
      membership: await membershipFor(studentId),
    });
  } catch (error) {
    httpError(res, error, "Could not save details");
  }
});

router.get("/plans", requireStudent, async (req, res) => {
  try {
    await requireKnownBatch(req.student.studentId);
    const trialUsed = await hasUsedTrial(req.student.studentId);
    const settings = await loadSettings();
    const displayPricedPlans = settings.displayPricedPlans !== false;
    const result = await pool.query(
      `
      SELECT
        p.id,
        p.name,
        p.amount,
        p.offer_price,
        p.is_trial,
        p.is_default,
        COALESCE(p.duration_value, p.duration_months, 1) AS duration_value,
        COALESCE(NULLIF(p.duration_unit, ''), 'month') AS duration_unit
      FROM superkandle_plans p
      WHERE p.is_active = TRUE
        AND (
          p.is_trial = FALSE
          OR $1 = FALSE
        )
        AND (
          $2 = TRUE
          OR p.is_trial = TRUE
        )
      ORDER BY
        p.is_trial DESC,
        p.is_default DESC,
        CASE COALESCE(NULLIF(p.duration_unit, ''), 'month')
          WHEN 'day' THEN 1
          WHEN 'week' THEN 2
          ELSE 3
        END ASC,
        COALESCE(p.duration_value, p.duration_months, 1) ASC,
        p.id ASC
      `,
      [trialUsed, displayPricedPlans]
    );

    const plans = result.rows.map((plan) => ({
      ...plan,
      price: effectivePlanPrice(plan),
    }));

    res.json({
      success: true,
      trialUsed,
      displayPricedPlans,
      hasOffer: plans.length > 0,
      plans,
    });
  } catch (error) {
    if (error.status) return httpError(res, error, "Failed to load plans");
    console.error("Subscribe plans error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load plans" });
  }
});

router.post("/start", requireStudent, async (req, res) => {
  try {
    const plan = await getActivePlan(Number(req.body.planId));
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "Select a valid plan",
      });
    }

    const studentId = req.student.studentId;
    await requireKnownBatch(studentId);
    const settings = await loadSettings();
    if (!plan.is_trial && settings.displayPricedPlans === false) {
      return res.status(403).json({
        success: false,
        message: "You don't have any offer for taking SuperKandle",
      });
    }
    const trialUsed = await hasUsedTrial(studentId);

    if (plan.is_trial) {
      if (trialUsed) {
        return res.status(409).json({
          success: false,
          message: "You already used your free trial",
        });
      }

      return res.json({
        success: true,
        kind: "trial",
        plan: {
          id: plan.id,
          name: plan.name,
          durationValue: plan.duration_value,
          durationUnit: plan.duration_unit,
        },
        message: "Confirm your TradingView ID and batch to start the trial",
      });
    }

    const amount = effectivePlanPrice(plan);
    const wallet = await receiveWallet();
    if (!wallet) {
      return res.status(503).json({
        success: false,
        message: "USDT payments are not configured yet. Contact the academy.",
      });
    }

    await pool.query(
      `
      UPDATE superkandle_payments
      SET status = 'cancelled'
      WHERE student_id = $1 AND status = 'pending'
      `,
      [studentId]
    );

    const created = await pool.query(
      `
      INSERT INTO superkandle_payments (
        student_id, plan_id, amount, network, token, wallet_to, status
      )
      VALUES ($1, $2, $3, 'BEP20', 'USDT', $4, 'pending')
      RETURNING id, amount, wallet_to, created_at
      `,
      [studentId, plan.id, amount, wallet]
    );

    res.json({
      success: true,
      kind: "usdt",
      payment: {
        id: created.rows[0].id,
        amount: Number(created.rows[0].amount),
        token: "USDT",
        network: "BEP20",
        networkName: "BNB Smart Chain (BEP20)",
        wallet,
        contract: "0x55d398326f99059fF775485246999027B3197955",
      },
      plan: {
        id: plan.id,
        name: plan.name,
        durationValue: plan.duration_value,
        durationUnit: plan.duration_unit,
      },
    });
  } catch (error) {
    if (error.status) return httpError(res, error, "Could not start checkout");
    console.error("Subscribe start error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not start checkout",
    });
  }
});

async function loadCheckoutOrder(paymentId, studentId) {
  const pending = await pool.query(
    `
    SELECT
      p.id,
      p.student_id,
      p.plan_id,
      p.amount,
      p.status,
      p.tx_hash,
      p.created_at,
      sp.name AS plan_name,
      sp.is_trial,
      COALESCE(sp.duration_value, sp.duration_months, 1) AS duration_value,
      COALESCE(sp.duration_months, 1) AS duration_months,
      COALESCE(NULLIF(sp.duration_unit, ''), 'month') AS duration_unit
    FROM superkandle_payments p
    JOIN superkandle_plans sp ON sp.id = p.plan_id
    WHERE p.id = $1 AND p.student_id = $2
    `,
    [paymentId, studentId]
  );
  return pending.rows[0] || null;
}

router.post("/confirm", requireStudent, async (req, res) => {
  try {
    const paymentId = Number(req.body.paymentId);
    const txHash = String(req.body.txHash || "").trim();
    const studentId = req.student.studentId;
    await requireKnownBatch(studentId);
    const settings = await loadSettings();
    if (settings.displayPricedPlans === false) {
      return res.status(403).json({
        success: false,
        message: "You don't have any offer for taking SuperKandle",
      });
    }

    if (!Number.isFinite(paymentId)) {
      return res.status(400).json({
        success: false,
        message: "Payment session is missing. Select a plan again.",
      });
    }

    const order = await loadCheckoutOrder(paymentId, studentId);
    if (!order || order.status === "cancelled") {
      return res.status(404).json({
        success: false,
        message: "Payment session not found. Select a plan again.",
      });
    }
    if (order.status === "confirmed") {
      return res.json({
        success: true,
        membership: await membershipFor(studentId),
        message: "This payment is already confirmed",
      });
    }

    if (!isTxHash(txHash)) {
      return res.status(400).json({
        success: false,
        message: "Paste the BEP20 transaction hash (starts with 0x)",
      });
    }

    const used = await pool.query(
      "SELECT id FROM superkandle_payments WHERE LOWER(tx_hash) = LOWER($1)",
      [txHash]
    );
    if (used.rows[0] && used.rows[0].id !== order.id) {
      return res.status(409).json({
        success: false,
        message: "This transaction was already used",
      });
    }

    const check = await verifyUsdtBep20Transfer({
      txHash,
      expectedAmount: order.amount,
    });
    if (!check.ok) {
      return res.status(400).json({ success: false, message: check.message });
    }

    await pool.query(
      `
      UPDATE superkandle_payments
      SET tx_hash = $1, status = 'confirmed', confirmed_at = NOW()
      WHERE id = $2
      `,
      [txHash, order.id]
    );

    res.json({
      success: true,
      paymentId: order.id,
      planId: order.plan_id,
      membership: null,
      message: "Payment confirmed. Confirm your details to activate SuperKandle.",
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "This transaction was already used",
      });
    }
    if (error.status) {
      return httpError(res, error, "Could not confirm payment. Try again in a minute.");
    }
    console.error("Subscribe confirm error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not confirm payment. Try again in a minute.",
    });
  }
});

router.post("/access-request", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const phone = String(req.body.phone || "").trim();
    const address = String(req.body.address || "").trim();
    const dateOfBirth = String(req.body.dateOfBirth || "").trim();
    const telegramUser = String(req.body.telegramUser || "").trim();
    const tradingviewUsername = String(req.body.tradingviewUsername || "").trim();
    const note = String(req.body.note || "").trim();
    const batchId = Number(req.body.batchId);

    if (
      !email ||
      !firstName ||
      !lastName ||
      !phone ||
      !address ||
      !dateOfBirth ||
      !telegramUser ||
      !tradingviewUsername ||
      !note ||
      !Number.isFinite(batchId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Every field is required, including batch",
      });
    }

    const selectable = await listSelectableBatches();
    const batch = selectable.find((row) => Number(row.id) === batchId);
    if (!batch) {
      return res.status(400).json({
        success: false,
        message: "Select a valid batch",
      });
    }

    const existingStudent = await findStudentByEmail(email);
    if (existingStudent) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_STUDENT",
        message:
          "This email is already in the students list. Go back and request the OTP.",
      });
    }

    const pending = await pool.query(
      `
      SELECT id
      FROM superkandle_access_requests
      WHERE LOWER(TRIM(email)) = $1 AND status = 'pending'
      LIMIT 1
      `,
      [email]
    );
    if (pending.rows[0]) {
      return res.json({
        success: true,
        alreadySubmitted: true,
        message:
          "A request for this email is already waiting for academy review.",
      });
    }

    const created = await pool.query(
      `
      INSERT INTO superkandle_access_requests (
        email,
        first_name,
        last_name,
        phone,
        address,
        date_of_birth,
        telegram_user,
        tradingview_username,
        note,
        batch_id,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
      RETURNING id
      `,
      [
        email,
        firstName,
        lastName,
        phone,
        address,
        dateOfBirth,
        telegramUser,
        tradingviewUsername,
        note,
        batch.id,
      ]
    );

    res.status(201).json({
      success: true,
      requestId: created.rows[0].id,
      message:
        "Request submitted. The academy will review it and you can use this email after approval.",
    });
  } catch (error) {
    console.error("Subscribe access request error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not submit the request. Try again.",
    });
  }
});

export default router;

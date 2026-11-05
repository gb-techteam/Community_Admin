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
  effectivePlanPrice,
  hasUsedTrial,
  markTrialClaimed,
} from "../services/superkandleAccess.js";
import { notifyMembershipActivated } from "../services/superkandleMails.js";

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

function publicStudent(row) {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
  };
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
      return res.status(403).json({
        success: false,
        message: "This link is only for enrolled students. Email not found.",
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
      student: publicStudent(student),
    });
  } catch (error) {
    console.error("Subscribe verify error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not verify student",
    });
  }
});

router.get("/session", requireStudent, async (req, res) => {
  try {
    const student = await pool.query(
      "SELECT id, first_name, last_name, email, phone FROM students WHERE id = $1",
      [req.student.studentId]
    );
    if (!student.rows[0]) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const trialUsed = await hasUsedTrial(req.student.studentId);
    const membership = await membershipFor(req.student.studentId);

    res.json({
      success: true,
      student: publicStudent(student.rows[0]),
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

router.get("/plans", requireStudent, async (req, res) => {
  try {
    const trialUsed = await hasUsedTrial(req.student.studentId);
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
      [trialUsed]
    );

    res.json({
      success: true,
      trialUsed,
      plans: result.rows.map((plan) => ({
        ...plan,
        price: effectivePlanPrice(plan),
      })),
    });
  } catch (error) {
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
    const trialUsed = await hasUsedTrial(studentId);

    if (plan.is_trial) {
      if (trialUsed) {
        return res.status(409).json({
          success: false,
          message: "You already used your free trial",
        });
      }

      await markTrialClaimed(studentId);
      const membership = await activateMembership({
        studentId,
        plan,
        amount: 0,
        paymentStatus: "paid",
        paymentMethod: "free_trial",
        paymentNote: "Student self-serve free trial",
      });
      await notifyMembershipActivated({
        studentId,
        planName: plan.name,
        expiresAt: membership?.expires_at,
        kind: "trial",
        amount: 0,
        durationValue: plan.duration_value,
        durationUnit: plan.duration_unit,
        paymentMethod: "free_trial",
      });

      return res.json({
        success: true,
        kind: "trial",
        membership: await membershipFor(studentId),
        message: "Free trial is now active",
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

    const membership = await activateMembership({
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
      paymentNote: `tx ${txHash}`,
    });
    await notifyMembershipActivated({
      studentId,
      planName: order.plan_name,
      expiresAt: membership?.expires_at,
      kind: "paid",
      amount: Number(order.amount),
      durationValue: order.duration_value,
      durationUnit: order.duration_unit,
      paymentMethod: "USDT-BEP20",
    });

    res.json({
      success: true,
      membership: await membershipFor(studentId),
      message: "Payment confirmed. SuperKandle access is active.",
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "This transaction was already used",
      });
    }
    console.error("Subscribe confirm error:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not confirm payment. Try again in a minute.",
    });
  }
});

export default router;

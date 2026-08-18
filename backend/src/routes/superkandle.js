import express from "express";
import pool from "../config/db.js";
import { requireAuth, requirePower } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);
router.use(requirePower("manage_superkandle"));

const DEFAULT_AMOUNT = 8;
const PAYMENT_STATUSES = new Set(["paid", "pending", "overdue"]);
const DURATION_UNITS = new Set(["day", "week", "month"]);
const DURATION_SUGGESTIONS = {
  day: [1, 3, 7, 14, 30],
  week: [1, 2, 4, 8],
  month: [1, 3, 6, 12],
};

function approxDurationMonths(value, unit) {
  if (unit === "day") return Math.max(1, Math.ceil(value / 30));
  if (unit === "week") return Math.max(1, Math.ceil(value / 4));
  return value;
}

function effectivePlanPrice(plan) {
  if (!plan) return DEFAULT_AMOUNT;
  if (plan.offer_price != null && Number(plan.offer_price) >= 0) {
    return Number(plan.offer_price);
  }
  return Number(plan.amount);
}

/** YYYY-MM-DD = paymentDate + plan duration */
function calcExpiresAt(paymentDate, plan) {
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

function resolveExpiresAt(payload, plan) {
  if (payload.expiresAt) return payload.expiresAt;
  return calcExpiresAt(payload.paymentDate, plan);
}

function memberSelect(where = "", order = "m.created_at DESC, m.id DESC") {
  return `
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
      m.created_at,
      m.updated_at,
      s.first_name,
      s.last_name,
      s.email,
      s.phone,
      p.name AS plan_name,
      p.amount AS plan_amount,
      p.offer_price AS plan_offer_price,
      COALESCE(p.duration_value, p.duration_months, 1) AS plan_duration_value,
      COALESCE(NULLIF(p.duration_unit, ''), 'month') AS plan_duration_unit,
      p.duration_months AS plan_duration_months,
      CASE
        WHEN m.expires_at IS NULL THEN 'unknown'
        WHEN m.expires_at < CURRENT_DATE THEN 'expired'
        WHEN m.expires_at <= CURRENT_DATE + INTERVAL '7 days' THEN 'expiring'
        ELSE 'active'
      END AS expiry_state
    FROM superkandle_members m
    JOIN students s ON s.id = m.student_id
    LEFT JOIN superkandle_plans p ON p.id = m.plan_id
    ${where}
    ORDER BY ${order}
  `;
}

async function getMember(id) {
  const result = await pool.query(memberSelect("WHERE m.id = $1"), [id]);
  return result.rows[0] || null;
}

async function getPlan(id) {
  const result = await pool.query(
    `
    SELECT
      p.*,
      (
        SELECT COUNT(*)::int
        FROM superkandle_members m
        WHERE m.plan_id = p.id
      ) AS member_count
    FROM superkandle_plans p
    WHERE p.id = $1
    `,
    [id]
  );
  return result.rows[0] || null;
}

function normalizeMemberPayload(body) {
  const studentId = Number(body.studentId);
  const planId = Number(body.planId);
  const amountRaw = body.amount;
  const amount =
    amountRaw === "" || amountRaw == null ? null : Number(amountRaw);
  const paymentStatus = String(body.paymentStatus || "pending").toLowerCase();

  return {
    studentId,
    planId,
    amount,
    paymentStatus,
    paymentDate: body.paymentDate || null,
    paymentMethod: body.paymentMethod?.trim() || null,
    paymentNote: body.paymentNote?.trim() || null,
    expiresAt: body.expiresAt || null,
    isActive: body.isActive !== false && body.isActive !== "false",
  };
}

function validateMemberPayload(payload, { requireStudent = true } = {}) {
  if (requireStudent && (!Number.isFinite(payload.studentId) || payload.studentId <= 0)) {
    return "Student is required";
  }
  if (!Number.isFinite(payload.planId) || payload.planId <= 0) {
    return "Plan is required";
  }
  if (payload.amount != null && (!Number.isFinite(payload.amount) || payload.amount < 0)) {
    return "Amount must be a valid number";
  }
  if (!PAYMENT_STATUSES.has(payload.paymentStatus)) {
    return "Payment status must be paid, pending, or overdue";
  }
  return null;
}

function normalizePlanPayload(body) {
  const amount = Number(body.amount);
  const offerRaw = body.offerPrice;
  const offerPrice =
    offerRaw === "" || offerRaw == null ? null : Number(offerRaw);
  const durationUnit = String(
    body.durationUnit || body.duration_unit || "month"
  )
    .trim()
    .toLowerCase();
  const durationValue = Number(
    body.durationValue ?? body.durationMonths ?? body.duration_months ?? 1
  );

  return {
    name: body.name?.trim() || "",
    amount,
    offerPrice:
      offerPrice == null || Number.isNaN(offerPrice) ? null : offerPrice,
    durationValue,
    durationUnit,
    durationMonths: approxDurationMonths(durationValue, durationUnit),
    isActive: body.isActive !== false && body.isActive !== "false",
    isDefault: Boolean(body.isDefault),
    isTrial: Boolean(body.isTrial),
  };
}

function validatePlanPayload(payload) {
  if (!payload.name) return "Plan name is required";
  if (!Number.isFinite(payload.amount) || payload.amount < 0) {
    return "Amount must be a valid number";
  }
  if (
    payload.offerPrice != null &&
    (!Number.isFinite(payload.offerPrice) || payload.offerPrice < 0)
  ) {
    return "Offer price must be a valid number";
  }
  if (!DURATION_UNITS.has(payload.durationUnit)) {
    return "Duration unit must be day, week, or month";
  }
  if (
    !Number.isFinite(payload.durationValue) ||
    payload.durationValue < 1 ||
    !Number.isInteger(payload.durationValue)
  ) {
    return "Duration must be a whole number of 1 or more";
  }
  return null;
}

router.get("/plans", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        p.*,
        COALESCE(p.duration_value, p.duration_months, 1) AS duration_value,
        COALESCE(NULLIF(p.duration_unit, ''), 'month') AS duration_unit,
        (
          SELECT COUNT(*)::int
          FROM superkandle_members m
          WHERE m.plan_id = p.id
        ) AS member_count
      FROM superkandle_plans p
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
    `);

    res.json({
      success: true,
      plans: result.rows,
      durationUnits: ["day", "week", "month"],
      durationSuggestions: DURATION_SUGGESTIONS,
    });
  } catch (error) {
    console.error("List superkandle plans error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load plans",
    });
  }
});

router.post("/plans", async (req, res) => {
  try {
    const payload = normalizePlanPayload(req.body);
    const validationError = validatePlanPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    if (payload.isDefault) {
      await pool.query("UPDATE superkandle_plans SET is_default = FALSE");
    }

    if (payload.isTrial) {
      await pool.query("UPDATE superkandle_plans SET is_trial = FALSE");
    }

    const created = await pool.query(
      `
      INSERT INTO superkandle_plans
        (name, amount, offer_price, duration_value, duration_unit, duration_months, is_active, is_default, is_trial)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
      `,
      [
        payload.name,
        payload.isTrial ? 0 : payload.amount,
        payload.offerPrice,
        payload.durationValue,
        payload.durationUnit,
        payload.durationMonths,
        payload.isActive,
        payload.isDefault,
        payload.isTrial,
      ]
    );

    const plan = await getPlan(created.rows[0].id);
    res.status(201).json({ success: true, plan });
  } catch (error) {
    console.error("Create superkandle plan error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create plan",
    });
  }
});

router.put("/plans/:id", async (req, res) => {
  try {
    const existing = await getPlan(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }

    const payload = normalizePlanPayload(req.body);
    const validationError = validatePlanPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    if (payload.isDefault) {
      await pool.query(
        "UPDATE superkandle_plans SET is_default = FALSE WHERE id <> $1",
        [req.params.id]
      );
    }

    if (payload.isTrial) {
      await pool.query(
        "UPDATE superkandle_plans SET is_trial = FALSE WHERE id <> $1",
        [req.params.id]
      );
    }

    await pool.query(
      `
      UPDATE superkandle_plans
      SET
        name = $1,
        amount = $2,
        offer_price = $3,
        duration_value = $4,
        duration_unit = $5,
        duration_months = $6,
        is_active = $7,
        is_default = $8,
        is_trial = $9,
        updated_at = NOW()
      WHERE id = $10
      `,
      [
        payload.name,
        payload.isTrial ? 0 : payload.amount,
        payload.offerPrice,
        payload.durationValue,
        payload.durationUnit,
        payload.durationMonths,
        payload.isActive,
        payload.isDefault,
        payload.isTrial,
        req.params.id,
      ]
    );

    // Keep at least one default
    if (!payload.isDefault && existing.is_default) {
      const defaults = await pool.query(
        "SELECT id FROM superkandle_plans WHERE is_default = TRUE LIMIT 1"
      );
      if (!defaults.rows[0]) {
        await pool.query(
          "UPDATE superkandle_plans SET is_default = TRUE WHERE id = $1",
          [req.params.id]
        );
      }
    }

    const plan = await getPlan(req.params.id);
    res.json({ success: true, plan });
  } catch (error) {
    console.error("Update superkandle plan error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update plan",
    });
  }
});

router.delete("/plans/:id", async (req, res) => {
  try {
    const existing = await getPlan(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }

    if (existing.is_default) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete the default plan. Set another plan as default first.",
      });
    }

    if (existing.member_count > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a plan assigned to members",
      });
    }

    await pool.query("DELETE FROM superkandle_plans WHERE id = $1", [
      req.params.id,
    ]);

    res.json({ success: true, message: "Plan deleted" });
  } catch (error) {
    console.error("Delete superkandle plan error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete plan",
    });
  }
});

router.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const status = (req.query.status || "all").trim();
    const expiry = (req.query.expiry || "all").trim();
    const params = [];
    const filters = [];

    if (search) {
      params.push(`%${search}%`);
      filters.push(`
        (
          s.first_name ILIKE $${params.length}
          OR s.last_name ILIKE $${params.length}
          OR s.email ILIKE $${params.length}
          OR s.phone ILIKE $${params.length}
          OR CONCAT(s.first_name, ' ', s.last_name) ILIKE $${params.length}
          OR p.name ILIKE $${params.length}
        )
      `);
    }

    if (status === "active") {
      filters.push("m.is_active = TRUE");
    } else if (status === "inactive") {
      filters.push("m.is_active = FALSE");
    }

    if (expiry === "expired") {
      filters.push("m.expires_at IS NOT NULL AND m.expires_at < CURRENT_DATE");
    } else if (expiry === "expiring") {
      filters.push(`
        m.expires_at IS NOT NULL
        AND m.expires_at >= CURRENT_DATE
        AND m.expires_at <= CURRENT_DATE + INTERVAL '7 days'
      `);
    } else if (expiry === "valid") {
      filters.push(`
        m.expires_at IS NOT NULL
        AND m.expires_at > CURRENT_DATE + INTERVAL '7 days'
      `);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await pool.query(memberSelect(where), params);

    const stats = await pool.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active,
        COUNT(*) FILTER (
          WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE
        )::int AS expired,
        COUNT(*) FILTER (
          WHERE expires_at IS NOT NULL
            AND expires_at >= CURRENT_DATE
            AND expires_at <= CURRENT_DATE + INTERVAL '7 days'
        )::int AS expiring,
        COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS pending_payments
      FROM superkandle_members
    `);

    res.json({
      success: true,
      members: result.rows,
      stats: stats.rows[0],
      defaults: { amount: DEFAULT_AMOUNT, currency: "USD" },
    });
  } catch (error) {
    console.error("List superkandle members error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load Superkandle members",
    });
  }
});

router.get("/students-search", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const params = [];
    let where = `
      WHERE NOT EXISTS (
        SELECT 1
        FROM superkandle_members m
        WHERE m.student_id = s.id
      )
    `;

    if (search) {
      params.push(`%${search}%`);
      where += `
        AND (
          s.first_name ILIKE $1
          OR s.last_name ILIKE $1
          OR s.email ILIKE $1
          OR s.phone ILIKE $1
          OR CONCAT(s.first_name, ' ', s.last_name) ILIKE $1
        )
      `;
    }

    const result = await pool.query(
      `
      SELECT s.id, s.first_name, s.last_name, s.email, s.phone
      FROM students s
      ${where}
      ORDER BY s.first_name ASC NULLS LAST, s.last_name ASC NULLS LAST, s.id DESC
      LIMIT 30
      `,
      params
    );

    res.json({ success: true, students: result.rows });
  } catch (error) {
    console.error("Superkandle student search error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to search students",
    });
  }
});

router.get("/batches", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const params = [];
    let where = "";

    if (search) {
      params.push(`%${search}%`);
      where = `
        WHERE b.name ILIKE $1
          OR c.title ILIKE $1
      `;
    }

    const result = await pool.query(
      `
      SELECT
        b.id,
        b.name,
        b.status,
        c.title AS course_title,
        COUNT(DISTINCT e.student_id)::int AS student_count,
        COUNT(DISTINCT e.student_id) FILTER (
          WHERE e.student_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM superkandle_members m
              WHERE m.student_id = e.student_id
            )
        )::int AS eligible_count
      FROM batches b
      LEFT JOIN courses c ON c.id = b.course_id
      LEFT JOIN enrollments e ON e.batch_id = b.id
      ${where}
      GROUP BY b.id, c.title
      ORDER BY b.name ASC NULLS LAST, b.id DESC
      `,
      params
    );

    res.json({ success: true, batches: result.rows });
  } catch (error) {
    console.error("Superkandle batches error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load batches",
    });
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const payload = normalizeMemberPayload(req.body);
    const validationError = validateMemberPayload(payload, {
      requireStudent: false,
    });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const batchIds = (Array.isArray(req.body.batchIds) ? req.body.batchIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (!batchIds.length) {
      return res.status(400).json({
        success: false,
        message: "Select at least one batch",
      });
    }

    const plan = await getPlan(payload.planId);
    if (!plan || !plan.is_active) {
      return res.status(400).json({
        success: false,
        message: "Selected plan is invalid or inactive",
      });
    }

    const amount =
      payload.amount != null ? payload.amount : effectivePlanPrice(plan);
    const expiresAt = resolveExpiresAt(payload, plan);

    const candidates = await pool.query(
      `
      SELECT DISTINCT e.student_id
      FROM enrollments e
      WHERE e.batch_id = ANY($1::int[])
        AND e.student_id IS NOT NULL
      `,
      [batchIds]
    );

    const studentIds = candidates.rows.map((row) => Number(row.student_id));
    if (!studentIds.length) {
      return res.status(400).json({
        success: false,
        message: "Selected batches have no enrolled students",
      });
    }

    const inserted = await pool.query(
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
        is_active
      )
      SELECT
        s.id,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8
      FROM students s
      WHERE s.id = ANY($9::int[])
        AND NOT EXISTS (
          SELECT 1
          FROM superkandle_members m
          WHERE m.student_id = s.id
        )
      ON CONFLICT (student_id) DO NOTHING
      RETURNING id
      `,
      [
        payload.planId,
        amount,
        payload.paymentStatus,
        payload.paymentDate,
        payload.paymentMethod,
        payload.paymentNote,
        expiresAt,
        payload.isActive,
        studentIds,
      ]
    );

    const added = inserted.rowCount || 0;
    const skipped = studentIds.length - added;

    res.status(201).json({
      success: true,
      added,
      skipped,
      total: studentIds.length,
      planId: payload.planId,
    });
  } catch (error) {
    console.error("Bulk add superkandle members error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to add members in bulk",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const payload = normalizeMemberPayload(req.body);
    const validationError = validateMemberPayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const student = await pool.query("SELECT id FROM students WHERE id = $1", [
      payload.studentId,
    ]);
    if (!student.rows[0]) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const plan = await getPlan(payload.planId);
    if (!plan || !plan.is_active) {
      return res.status(400).json({
        success: false,
        message: "Selected plan is invalid or inactive",
      });
    }

    const amount =
      payload.amount != null ? payload.amount : effectivePlanPrice(plan);
    const expiresAt = resolveExpiresAt(payload, plan);

    const created = await pool.query(
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
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
      `,
      [
        payload.studentId,
        payload.planId,
        amount,
        payload.paymentStatus,
        payload.paymentDate,
        payload.paymentMethod,
        payload.paymentNote,
        expiresAt,
        payload.isActive,
      ]
    );

    const member = await getMember(created.rows[0].id);
    res.status(201).json({ success: true, member });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "This student is already a Superkandle member",
      });
    }
    console.error("Create superkandle member error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to add Superkandle member",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const existing = await getMember(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Superkandle member not found",
      });
    }

    const payload = normalizeMemberPayload({
      ...req.body,
      studentId: existing.student_id,
    });
    const validationError = validateMemberPayload(payload, {
      requireStudent: false,
    });
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    const plan = await getPlan(payload.planId);
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "Selected plan is invalid",
      });
    }

    const amount =
      payload.amount != null ? payload.amount : effectivePlanPrice(plan);
    const expiresAt = resolveExpiresAt(payload, plan);

    await pool.query(
      `
      UPDATE superkandle_members
      SET
        plan_id = $1,
        amount = $2,
        payment_status = $3,
        payment_date = $4,
        payment_method = $5,
        payment_note = $6,
        expires_at = $7,
        is_active = $8,
        updated_at = NOW()
      WHERE id = $9
      `,
      [
        payload.planId,
        amount,
        payload.paymentStatus,
        payload.paymentDate,
        payload.paymentMethod,
        payload.paymentNote,
        expiresAt,
        payload.isActive,
        req.params.id,
      ]
    );

    const member = await getMember(req.params.id);
    res.json({ success: true, member });
  } catch (error) {
    console.error("Update superkandle member error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update Superkandle member",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM superkandle_members WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Superkandle member not found",
      });
    }

    res.json({ success: true, message: "Superkandle member removed" });
  } catch (error) {
    console.error("Delete superkandle member error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to remove Superkandle member",
    });
  }
});

export default router;

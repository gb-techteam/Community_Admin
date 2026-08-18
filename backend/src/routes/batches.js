import express from "express";
import pool from "../config/db.js";
import { requireAuth, requireAnyPower, requirePower } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", requireAnyPower("manage_batches", "manage_students"), async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        b.id,
        b.name,
        b.course_id,
        b.start_date,
        b.end_date,
        b.status,
        b.is_open,
        b.created_at,
        b.updated_at,
        c.title AS course_title,
        COUNT(e.id)::int AS student_count
      FROM batches b
      LEFT JOIN courses c ON c.id = b.course_id
      LEFT JOIN enrollments e ON e.batch_id = b.id
      GROUP BY b.id, c.title
      ORDER BY b.created_at DESC NULLS LAST, b.id DESC
    `);

    res.json({ success: true, batches: result.rows });
  } catch (error) {
    console.error("List batches error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load batches" });
  }
});

router.get("/members", requirePower("manage_batches"), async (req, res) => {
  try {
    const batchId = req.query.batchId;
    const search = (req.query.search || "").trim();
    const params = [];
    const filters = [];

    if (batchId && batchId !== "all") {
      params.push(Number(batchId));
      filters.push(`e.batch_id = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      filters.push(`
        (
          s.first_name ILIKE $${params.length}
          OR s.last_name ILIKE $${params.length}
          OR s.email ILIKE $${params.length}
          OR s.phone ILIKE $${params.length}
          OR CONCAT(s.first_name, ' ', s.last_name) ILIKE $${params.length}
          OR b.name ILIKE $${params.length}
        )
      `);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        e.id AS enrollment_id,
        e.status AS enrollment_status,
        e.payment_status,
        e.amount_paid,
        e.fees,
        e.enrolled_at,
        e.batch_id,
        s.id AS student_id,
        s.first_name,
        s.last_name,
        s.email,
        s.phone,
        s.telegram_user,
        b.name AS batch_name,
        c.title AS course_title
      FROM enrollments e
      LEFT JOIN students s ON s.id = e.student_id
      LEFT JOIN batches b ON b.id = e.batch_id
      LEFT JOIN courses c ON c.id = e.course_id
      ${where}
      ORDER BY e.enrolled_at DESC NULLS LAST, e.id DESC
      `,
      params
    );

    res.json({ success: true, members: result.rows });
  } catch (error) {
    console.error("List batch members error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load batch members",
    });
  }
});

router.post("/", requirePower("manage_batches"), (_req, res) => {
  res.status(403).json({
    success: false,
    message: "Create and delete for batches is done in CRM",
  });
});

router.put("/:id", requirePower("manage_batches"), async (req, res) => {
  try {
    const { name, courseId, startDate, endDate, status, isOpen } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Batch name is required",
      });
    }

    const result = await pool.query(
      `
      UPDATE batches
      SET
        name = $1,
        course_id = $2,
        start_date = $3,
        end_date = $4,
        status = $5,
        is_open = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
      `,
      [
        name.trim(),
        courseId || null,
        startDate || null,
        endDate || null,
        status || "active",
        Boolean(isOpen),
        req.params.id,
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    res.json({ success: true, batch: result.rows[0] });
  } catch (error) {
    console.error("Update batch error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update batch" });
  }
});

router.delete("/:id", requirePower("manage_batches"), (_req, res) => {
  res.status(403).json({
    success: false,
    message: "Create and delete for batches is done in CRM",
  });
});

export default router;

import express from "express";
import pool from "../config/db.js";
import { requireAuth, requirePower } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);
router.use(requirePower("manage_students"));

router.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const batchId = req.query.batchId;
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
        )
      `);
    }

    if (batchId && batchId !== "all") {
      params.push(Number(batchId));
      filters.push(`
        EXISTS (
          SELECT 1
          FROM enrollments e2
          WHERE e2.student_id = s.id
            AND e2.batch_id = $${params.length}
        )
      `);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.email,
        s.phone,
        s.address,
        s.date_of_birth,
        s.telegram_user,
        s.created_at,
        s.updated_at,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM enrollments e
            WHERE e.student_id = s.id
          ),
          0
        ) AS course_count,
        COALESCE(
          (
            SELECT STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name)
            FROM enrollments e
            JOIN batches b ON b.id = e.batch_id
            WHERE e.student_id = s.id
          ),
          ''
        ) AS batch_names,
        COALESCE(
          (
            SELECT ARRAY_AGG(DISTINCT b.id ORDER BY b.id)
            FROM enrollments e
            JOIN batches b ON b.id = e.batch_id
            WHERE e.student_id = s.id
          ),
          ARRAY[]::int[]
        ) AS batch_ids
      FROM students s
      ${where}
      ORDER BY s.created_at DESC NULLS LAST, s.id DESC
      `,
      params
    );

    res.json({ success: true, students: result.rows });
  } catch (error) {
    console.error("List students error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load students" });
  }
});

router.post("/", (_req, res) => {
  res.status(403).json({
    success: false,
    message: "Create and delete for students is done in CRM",
  });
});

router.put("/:id", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, address, dateOfBirth, telegramUser } =
      req.body;

    if (!firstName?.trim() || !email?.trim()) {
      return res.status(400).json({
        success: false,
        message: "First name and email are required",
      });
    }

    const result = await pool.query(
      `
      UPDATE students
      SET
        first_name = $1,
        last_name = $2,
        email = $3,
        phone = $4,
        address = $5,
        date_of_birth = $6,
        telegram_user = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
      `,
      [
        firstName.trim(),
        lastName?.trim() || null,
        email.trim().toLowerCase(),
        phone?.trim() || null,
        address?.trim() || null,
        dateOfBirth || null,
        telegramUser?.trim() || null,
        req.params.id,
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    res.json({ success: true, student: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "A student with this email already exists",
      });
    }
    console.error("Update student error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update student" });
  }
});

router.delete("/:id", (_req, res) => {
  res.status(403).json({
    success: false,
    message: "Create and delete for students is done in CRM",
  });
});

export default router;

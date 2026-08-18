import express from "express";
import pool from "../config/db.js";
import { requireAuth, requireAnyPower, requirePower } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", requireAnyPower("manage_courses", "manage_batches"), async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const params = [];
    let where = "";

    if (search) {
      params.push(`%${search}%`);
      where = `WHERE title ILIKE $1 OR description ILIKE $1 OR status ILIKE $1`;
    }

    const result = await pool.query(
      `
      SELECT
        c.id,
        c.title,
        c.description,
        c.duration,
        c.price,
        c.status,
        c.active_enrollments,
        c.created_at,
        c.updated_at,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM enrollments e
            WHERE e.course_id = c.id
          ),
          0
        ) AS student_count
      FROM courses c
      ${where}
      ORDER BY c.created_at DESC NULLS LAST, c.id DESC
      `,
      params
    );

    res.json({ success: true, courses: result.rows });
  } catch (error) {
    console.error("List courses error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load courses" });
  }
});

router.post("/", requirePower("manage_courses"), (_req, res) => {
  res.status(403).json({
    success: false,
    message: "Create and delete for courses is done in CRM",
  });
});

router.put("/:id", requirePower("manage_courses"), async (req, res) => {
  try {
    const { title, description, duration, price, status } = req.body;

    if (!title?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Course title is required",
      });
    }

    const result = await pool.query(
      `
      UPDATE courses
      SET
        title = $1,
        description = $2,
        duration = $3,
        price = $4,
        status = $5,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
      `,
      [
        title.trim(),
        description?.trim() || null,
        duration?.trim() || null,
        price === "" || price == null ? null : Number(price),
        status || "active",
        req.params.id,
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    res.json({ success: true, course: result.rows[0] });
  } catch (error) {
    console.error("Update course error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update course" });
  }
});

router.delete("/:id", requirePower("manage_courses"), (_req, res) => {
  res.status(403).json({
    success: false,
    message: "Create and delete for courses is done in CRM",
  });
});

export default router;

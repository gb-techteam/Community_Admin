import express from "express";
import pool from "../config/db.js";
import { requireAuth, requireAnyPower } from "../middleware/auth.js";
import { assignStudentBatch } from "../services/superkandleAccess.js";
import {
  sendMembershipMailSafe,
  sendStudentRequestApproved,
} from "../services/studentMail.js";

const router = express.Router();

router.use(requireAuth);
router.use(requireAnyPower("manage_students", "manage_superkandle"));

async function loadAccessRequest(id) {
  const result = await pool.query(
    `
    SELECT r.*, b.name AS batch_name
    FROM superkandle_access_requests r
    LEFT JOIN batches b ON b.id = r.batch_id
    WHERE r.id = $1
    `,
    [id]
  );
  return result.rows[0] || null;
}

router.get("/", async (req, res) => {
  try {
    const status = String(req.query.status || "pending").toLowerCase();
    const search = String(req.query.search || "").trim();
    const params = [];
    const filters = [];
    if (["pending", "approved", "rejected"].includes(status)) {
      params.push(status);
      filters.push(`r.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(`
        (
          r.first_name ILIKE $${params.length}
          OR r.last_name ILIKE $${params.length}
          OR CONCAT(r.first_name, ' ', r.last_name) ILIKE $${params.length}
          OR r.email ILIKE $${params.length}
          OR r.phone ILIKE $${params.length}
          OR r.telegram_user ILIKE $${params.length}
          OR r.tradingview_username ILIKE $${params.length}
          OR b.name ILIKE $${params.length}
        )
      `);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT r.*, b.name AS batch_name
      FROM superkandle_access_requests r
      LEFT JOIN batches b ON b.id = r.batch_id
      ${where}
      ORDER BY r.created_at DESC, r.id DESC
      `,
      params
    );

    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
      FROM superkandle_access_requests
    `);

    res.json({
      success: true,
      requests: result.rows,
      stats: stats.rows[0],
    });
  } catch (error) {
    console.error("List student requests error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load student requests",
    });
  }
});

router.patch("/:id/approve", async (req, res) => {
  try {
    const existing = await loadAccessRequest(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }
    if (existing.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: "This request was already reviewed",
      });
    }

    let studentId = null;
    const found = await pool.query(
      `
      SELECT id FROM students
      WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
      LIMIT 1
      `,
      [existing.email]
    );
    if (found.rows[0]) {
      studentId = found.rows[0].id;
    } else {
      const created = await pool.query(
        `
        INSERT INTO students (
          first_name,
          last_name,
          email,
          phone,
          address,
          date_of_birth,
          telegram_user,
          tradingview_username
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
        `,
        [
          existing.first_name,
          existing.last_name,
          existing.email,
          existing.phone,
          existing.address,
          existing.date_of_birth,
          existing.telegram_user,
          existing.tradingview_username,
        ]
      );
      studentId = created.rows[0].id;
    }

    if (existing.batch_id) {
      await assignStudentBatch(studentId, existing.batch_id);
    }

    const reviewer =
      req.admin?.name || req.admin?.adminId || req.admin?.role || "admin";
    await pool.query(
      `
      UPDATE superkandle_access_requests
      SET
        status = 'approved',
        student_id = $1,
        reviewed_at = NOW(),
        reviewed_by = $2,
        updated_at = NOW()
      WHERE id = $3
      `,
      [studentId, reviewer, existing.id]
    );

    await sendMembershipMailSafe(() =>
      sendStudentRequestApproved({
        student: {
          first_name: existing.first_name,
          email: existing.email,
        },
      })
    );

    res.json({
      success: true,
      request: await loadAccessRequest(existing.id),
      studentId,
    });
  } catch (error) {
    console.error("Approve student request error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to approve request",
    });
  }
});

router.patch("/:id/reject", async (req, res) => {
  try {
    const existing = await loadAccessRequest(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }
    if (existing.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: "This request was already reviewed",
      });
    }

    const reviewer =
      req.admin?.name || req.admin?.adminId || req.admin?.role || "admin";
    const reviewNote = String(req.body?.reviewNote || "").trim() || null;

    await pool.query(
      `
      UPDATE superkandle_access_requests
      SET
        status = 'rejected',
        reviewed_at = NOW(),
        reviewed_by = $1,
        review_note = $2,
        updated_at = NOW()
      WHERE id = $3
      `,
      [reviewer, reviewNote, existing.id]
    );

    res.json({
      success: true,
      request: await loadAccessRequest(existing.id),
    });
  } catch (error) {
    console.error("Reject student request error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to reject request",
    });
  }
});

export default router;

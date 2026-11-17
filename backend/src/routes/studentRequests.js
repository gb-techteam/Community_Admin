import express from "express";
import pool from "../config/db.js";
import { requireAuth, requireAnyPower } from "../middleware/auth.js";
import { assignStudentBatch } from "../services/superkandleAccess.js";
import {
  sendMembershipMailSafe,
  sendStudentRequestApproved,
  sendStudentRequestRejected,
} from "../services/studentMail.js";

const REJECT_REASONS = {
  cannot_identify:
    "The academy could not identify you as a student. Please recheck your phone number, email, and batch, then submit a new request.",
  not_student: "You are not a student of the academy.",
  duplicate: "We identified a duplicate request with the same details.",
};

const router = express.Router();

router.use(requireAuth);
router.use(requireAnyPower("manage_students", "manage_superkandle"));

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneKey(value) {
  const d = digits(value);
  if (d.length >= 10) return d.slice(-10);
  return d;
}

function handleKey(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

function textKey(value) {
  return String(value || "").trim().toLowerCase();
}

function dateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function matchFields(request, other) {
  const hits = [];
  if (textKey(request.email) && textKey(request.email) === textKey(other.email)) {
    hits.push("email");
  }
  if (phoneKey(request.phone) && phoneKey(request.phone) === phoneKey(other.phone)) {
    hits.push("phone");
  }
  if (
    handleKey(request.telegram_user) &&
    handleKey(request.telegram_user) === handleKey(other.telegram_user)
  ) {
    hits.push("telegram");
  }
  if (
    handleKey(request.tradingview_username) &&
    handleKey(request.tradingview_username) ===
      handleKey(other.tradingview_username)
  ) {
    hits.push("tradingview");
  }
  if (
    textKey(request.first_name) &&
    textKey(request.last_name) &&
    textKey(request.first_name) === textKey(other.first_name) &&
    textKey(request.last_name) === textKey(other.last_name)
  ) {
    hits.push("name");
  }
  if (
    dateKey(request.date_of_birth) &&
    dateKey(request.date_of_birth) === dateKey(other.date_of_birth)
  ) {
    hits.push("date of birth");
  }
  return hits;
}

function withMatches(request, rows) {
  return rows
    .map((row) => ({
      ...row,
      matched: matchFields(request, row),
    }))
    .filter((row) => row.matched.length)
    .sort((a, b) => b.matched.length - a.matched.length);
}

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
    if (["pending", "on_hold", "approved", "rejected"].includes(status)) {
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
        COUNT(*) FILTER (WHERE status = 'on_hold')::int AS on_hold,
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

function excelEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excelCell(value) {
  return `<Cell><Data ss:Type="String">${excelEscape(value)}</Data></Cell>`;
}

function formatExportDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

router.get("/export", async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT r.*, b.name AS batch_name
      FROM superkandle_access_requests r
      LEFT JOIN batches b ON b.id = r.batch_id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC, r.id DESC
      `
    );

    const headers = [
      "First name",
      "Last name",
      "Email",
      "Phone",
      "Date of birth",
      "Telegram",
      "TradingView",
      "Batch",
      "Address",
      "Note",
      "Submitted",
    ];
    const rows = result.rows.map((row) =>
      [
        row.first_name,
        row.last_name,
        row.email,
        row.phone,
        formatExportDate(row.date_of_birth),
        row.telegram_user,
        row.tradingview_username,
        row.batch_name,
        row.address,
        row.note,
        formatExportDate(row.created_at),
      ]
        .map(excelCell)
        .join("")
    );

    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Pending requests">
  <Table>
   <Row>${headers.map(excelCell).join("")}</Row>
   ${rows.map((row) => `<Row>${row}</Row>`).join("\n   ")}
  </Table>
 </Worksheet>
</Workbook>`;

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      "Content-Type",
      "application/vnd.ms-excel; charset=utf-8"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="pending-student-requests-${stamp}.xls"`
    );
    res.send(xml);
  } catch (error) {
    console.error("Export student requests error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to export pending requests",
    });
  }
});

router.get("/:id/matches", async (req, res) => {
  try {
    const request = await loadAccessRequest(req.params.id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    const email = textKey(request.email);
    const phone = phoneKey(request.phone);
    const telegram = handleKey(request.telegram_user);
    const tradingview = handleKey(request.tradingview_username);
    const first = textKey(request.first_name);
    const last = textKey(request.last_name);

    const students = await pool.query(
      `
      SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.email,
        s.phone,
        s.date_of_birth,
        s.telegram_user,
        s.tradingview_username,
        s.address,
        COALESCE(
          (
            SELECT STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name)
            FROM enrollments e
            JOIN batches b ON b.id = e.batch_id
            WHERE e.student_id = s.id
          ),
          ''
        ) AS batch_names
      FROM students s
      WHERE
        ($1 <> '' AND LOWER(TRIM(COALESCE(s.email, ''))) = $1)
        OR (
          $2 <> ''
          AND RIGHT(REGEXP_REPLACE(COALESCE(s.phone, ''), '[^0-9]', '', 'g'), 10) = $2
        )
        OR (
          $3 <> ''
          AND LOWER(REGEXP_REPLACE(TRIM(COALESCE(s.telegram_user, '')), '^@', '')) = $3
        )
        OR (
          $4 <> ''
          AND LOWER(TRIM(COALESCE(s.tradingview_username, ''))) = $4
        )
        OR (
          $5 <> '' AND $6 <> ''
          AND LOWER(TRIM(COALESCE(s.first_name, ''))) = $5
          AND LOWER(TRIM(COALESCE(s.last_name, ''))) = $6
        )
      LIMIT 20
      `,
      [email, phone, telegram, tradingview, first, last]
    );

    const requests = await pool.query(
      `
      SELECT r.id, r.first_name, r.last_name, r.email, r.phone, r.date_of_birth,
        r.telegram_user, r.tradingview_username, r.address, r.status, r.created_at,
        b.name AS batch_name
      FROM superkandle_access_requests r
      LEFT JOIN batches b ON b.id = r.batch_id
      WHERE r.id <> $1
        AND (
          ($2 <> '' AND LOWER(TRIM(COALESCE(r.email, ''))) = $2)
          OR (
            $3 <> ''
            AND RIGHT(REGEXP_REPLACE(COALESCE(r.phone, ''), '[^0-9]', '', 'g'), 10) = $3
          )
          OR (
            $4 <> ''
            AND LOWER(REGEXP_REPLACE(TRIM(COALESCE(r.telegram_user, '')), '^@', '')) = $4
          )
          OR (
            $5 <> ''
            AND LOWER(TRIM(COALESCE(r.tradingview_username, ''))) = $5
          )
          OR (
            $6 <> '' AND $7 <> ''
            AND LOWER(TRIM(COALESCE(r.first_name, ''))) = $6
            AND LOWER(TRIM(COALESCE(r.last_name, ''))) = $7
          )
        )
      ORDER BY r.created_at DESC
      LIMIT 20
      `,
      [request.id, email, phone, telegram, tradingview, first, last]
    );

    res.json({
      success: true,
      students: withMatches(request, students.rows),
      requests: withMatches(request, requests.rows),
    });
  } catch (error) {
    console.error("Match student request error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to compare with students",
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
    if (!["pending", "on_hold"].includes(existing.status)) {
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
    if (!["pending", "on_hold"].includes(existing.status)) {
      return res.status(409).json({
        success: false,
        message: "This request was already reviewed",
      });
    }

    const reviewer =
      req.admin?.name || req.admin?.adminId || req.admin?.role || "admin";
    const reasonKey = String(req.body?.reason || "").trim();
    const customReason = String(req.body?.customReason || "").trim();
    const reviewNote =
      reasonKey === "custom"
        ? customReason.slice(0, 500)
        : REJECT_REASONS[reasonKey];
    if (!reviewNote) {
      return res.status(400).json({
        success: false,
        message:
          reasonKey === "custom"
            ? "Enter a custom rejection reason"
            : "Select a rejection reason",
      });
    }

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

    await sendMembershipMailSafe(() =>
      sendStudentRequestRejected({
        student: {
          first_name: existing.first_name,
          email: existing.email,
        },
        reason: reviewNote,
      })
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

router.patch("/:id/hold", async (req, res) => {
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
        message:
          existing.status === "on_hold"
            ? "This request is already on hold"
            : "This request was already reviewed",
      });
    }

    const reviewer =
      req.admin?.name || req.admin?.adminId || req.admin?.role || "admin";
    await pool.query(
      `
      UPDATE superkandle_access_requests
      SET
        status = 'on_hold',
        reviewed_by = $1,
        updated_at = NOW()
      WHERE id = $2
      `,
      [reviewer, existing.id]
    );

    res.json({
      success: true,
      request: await loadAccessRequest(existing.id),
    });
  } catch (error) {
    console.error("Hold student request error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to put request on hold",
    });
  }
});

router.patch("/:id/resume", async (req, res) => {
  try {
    const existing = await loadAccessRequest(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }
    if (!["on_hold", "approved", "rejected"].includes(existing.status)) {
      return res.status(409).json({
        success: false,
        message: "This request is already pending",
      });
    }

    await pool.query(
      `
      UPDATE superkandle_access_requests
      SET
        status = 'pending',
        reviewed_at = NULL,
        reviewed_by = NULL,
        review_note = NULL,
        updated_at = NOW()
      WHERE id = $1
      `,
      [existing.id]
    );

    res.json({
      success: true,
      request: await loadAccessRequest(existing.id),
    });
  } catch (error) {
    console.error("Resume student request error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to move request back to pending",
    });
  }
});

export default router;

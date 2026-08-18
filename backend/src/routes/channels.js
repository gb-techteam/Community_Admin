import express from "express";
import pool from "../config/db.js";
import {
  requireAuth,
  requirePower,
  requireAnyPower,
} from "../middleware/auth.js";
import { isSuperAdmin, hasPower } from "../constants/powers.js";
import {
  channelMediaUpload,
  mediaKindFromMime,
  publicUploadPath,
  unlinkUpload,
} from "../middleware/upload.js";
import { broadcastChannelEvent } from "../realtime/channels.js";

const router = express.Router();

router.use(requireAuth);
router.use(
  requireAnyPower("manage_channels", "message_channels", "view_channel_people")
);

const canManageChannels = requirePower("manage_channels");

function portalAdminIdOf(admin) {
  const id = Number(admin?.portalAdminId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// Admins without manage_channels only reach channels they belong to
async function canReachChannel(admin, channelId) {
  if (hasPower(admin, "manage_channels")) return true;

  const portalAdminId = portalAdminIdOf(admin);
  if (!portalAdminId) return false;

  const result = await pool.query(
    `
    SELECT 1
    FROM channel_admins
    WHERE channel_id = $1 AND portal_admin_id = $2
    `,
    [channelId, portalAdminId]
  );

  return Boolean(result.rows[0]);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function creatorFromAdmin(admin) {
  if (isSuperAdmin(admin)) {
    return {
      role: "super_admin",
      adminId: admin.adminId || "super_admin",
      name: admin.name || "Super Admin",
      portalAdminId: null,
    };
  }

  return {
    role: "portal_admin",
    adminId: admin.adminId,
    name: admin.name || admin.adminId,
    portalAdminId: admin.portalAdminId || null,
  };
}

router.get("/", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const canManage = hasPower(req.admin, "manage_channels");
    const portalAdminId = portalAdminIdOf(req.admin);
    const superAdminId = isSuperAdmin(req.admin)
      ? Number(req.admin.adminId)
      : null;
    const hasSuperViewer =
      Number.isFinite(superAdminId) && superAdminId > 0;

    const params = [portalAdminId];
    const conditions = [];

    const isMineSql = `
      EXISTS (
        SELECT 1
        FROM channel_admins ca
        WHERE ca.channel_id = c.id AND ca.portal_admin_id = $1::int
      )
    `;

    // Unread = others' messages this admin has never opened
    let unreadSql = "0";
    if (portalAdminId) {
      unreadSql = `
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_messages m
            WHERE m.channel_id = c.id
              AND m.deleted_at IS NULL
              AND m.sent_by_portal_admin_id IS DISTINCT FROM $1::int
              AND NOT EXISTS (
                SELECT 1
                FROM channel_message_admin_reads ar
                WHERE ar.message_id = m.id
                  AND ar.portal_admin_id = $1::int
              )
          ),
          0
        )
      `;
    } else if (hasSuperViewer) {
      params.push(superAdminId);
      const superParam = `$${params.length}`;
      unreadSql = `
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_messages m
            WHERE m.channel_id = c.id
              AND m.deleted_at IS NULL
              AND m.sent_by_role IS DISTINCT FROM 'super_admin'
              AND NOT EXISTS (
                SELECT 1
                FROM channel_message_admin_reads ar
                WHERE ar.message_id = m.id
                  AND ar.super_admin_id = ${superParam}::int
              )
          ),
          0
        )
      `;
    }

    if (search) {
      params.push(`%${search}%`);
      const term = `$${params.length}`;
      conditions.push(`
        (
          c.name ILIKE ${term}
          OR c.code ILIKE ${term}
          OR c.description ILIKE ${term}
          OR c.created_by_name ILIKE ${term}
          OR c.created_by_admin_id ILIKE ${term}
        )
      `);
    }

    if (!canManage) {
      conditions.push(isMineSql);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await pool.query(
      `
      SELECT
        c.*,
        ${isMineSql} AS is_mine,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_messages m
            WHERE m.channel_id = c.id AND m.deleted_at IS NULL
          ),
          0
        ) AS message_count,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_members cm
            WHERE cm.channel_id = c.id
          ),
          0
        ) AS member_count,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_admins ca
            WHERE ca.channel_id = c.id
          ),
          0
        ) AS admin_count,
        ${unreadSql} AS unread_count
      FROM channels c
      ${where}
      ORDER BY
        unread_count DESC,
        is_mine DESC,
        c.created_at DESC NULLS LAST,
        c.id DESC
      `,
      params
    );

    res.json({
      success: true,
      channels: result.rows,
      canManage,
    });
  } catch (error) {
    console.error("List channels error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load channels" });
  }
});

router.get("/people-search", canManageChannels, async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    const params = [];
    let studentWhere = "";
    let adminWhere = "WHERE is_active = TRUE";

    if (search) {
      params.push(`%${search}%`);
      studentWhere = `
        WHERE
          first_name ILIKE $1
          OR last_name ILIKE $1
          OR email ILIKE $1
          OR phone ILIKE $1
          OR CONCAT(first_name, ' ', last_name) ILIKE $1
      `;
      adminWhere = `
        WHERE is_active = TRUE
          AND (
            name ILIKE $1
            OR admin_id ILIKE $1
            OR email ILIKE $1
          )
      `;
    }

    const [students, admins] = await Promise.all([
      pool.query(
        `
        SELECT id, first_name, last_name, email, phone
        FROM students
        ${studentWhere}
        ORDER BY first_name ASC NULLS LAST, last_name ASC NULLS LAST, id DESC
        LIMIT 40
        `,
        params
      ),
      pool.query(
        `
        SELECT id, admin_id, name, email, admin_type
        FROM portal_admins
        ${adminWhere}
        ORDER BY name ASC NULLS LAST, admin_id ASC
        LIMIT 40
        `,
        params
      ),
    ]);

    res.json({
      success: true,
      students: students.rows,
      admins: admins.rows,
    });
  } catch (error) {
    console.error("People search error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to search people",
    });
  }
});

router.get("/batches", canManageChannels, async (req, res) => {
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
        COUNT(DISTINCT e.student_id)::int AS student_count
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
    console.error("Channel batches error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load batches",
    });
  }
});

router.post("/", canManageChannels, async (req, res) => {
  const client = await pool.connect();

  try {
    const { name, code, description, status } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Channel name is required",
      });
    }

    const channelCode = code?.trim() ? slugify(code) : slugify(name);

    if (!channelCode) {
      return res.status(400).json({
        success: false,
        message: "Channel code is required",
      });
    }

    const creator = creatorFromAdmin(req.admin);

    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO channels (
        name,
        code,
        description,
        status,
        is_admin_only,
        created_by_role,
        created_by_admin_id,
        created_by_name,
        created_by_portal_admin_id
      )
      VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        name.trim(),
        channelCode,
        description?.trim() || null,
        status || "active",
        creator.role,
        creator.adminId,
        creator.name,
        creator.portalAdminId,
      ]
    );

    const channel = result.rows[0];

    // Portal admin creators join the channel as channel admin
    if (creator.role === "portal_admin" && creator.portalAdminId) {
      await client.query(
        `
        INSERT INTO channel_admins (channel_id, portal_admin_id, role)
        VALUES ($1, $2, 'admin')
        ON CONFLICT (channel_id, portal_admin_id) DO NOTHING
        `,
        [channel.id, creator.portalAdminId]
      );
    }

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      channel: {
        ...channel,
        member_count: 0,
        admin_count: creator.role === "portal_admin" && creator.portalAdminId ? 1 : 0,
        message_count: 0,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "A channel with this code already exists",
      });
    }
    console.error("Create channel error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create channel" });
  } finally {
    client.release();
  }
});

router.put("/:id", canManageChannels, async (req, res) => {
  try {
    const { name, code, description, status } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Channel name is required",
      });
    }

    const channelCode = code?.trim() ? slugify(code) : slugify(name);

    const result = await pool.query(
      `
      UPDATE channels
      SET
        name = $1,
        code = $2,
        description = $3,
        status = $4,
        is_admin_only = TRUE,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
      `,
      [
        name.trim(),
        channelCode,
        description?.trim() || null,
        status || "active",
        req.params.id,
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Channel not found" });
    }

    res.json({ success: true, channel: result.rows[0] });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "A channel with this code already exists",
      });
    }
    console.error("Update channel error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update channel" });
  }
});

router.delete("/:id", canManageChannels, async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM channels WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Channel not found" });
    }

    res.json({ success: true, message: "Channel deleted" });
  } catch (error) {
    console.error("Delete channel error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete channel" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const channelId = Number(req.params.id);

    if (!Number.isFinite(channelId) || channelId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid channel id",
      });
    }

    if (!(await canReachChannel(req.admin, channelId))) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this channel",
      });
    }

    const result = await pool.query(
      `
      SELECT
        c.*,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_messages m
            WHERE m.channel_id = c.id AND m.deleted_at IS NULL
          ),
          0
        ) AS message_count,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_members cm
            WHERE cm.channel_id = c.id
          ),
          0
        ) AS member_count,
        COALESCE(
          (
            SELECT COUNT(*)::int
            FROM channel_admins ca
            WHERE ca.channel_id = c.id
          ),
          0
        ) AS admin_count
      FROM channels c
      WHERE c.id = $1
      `,
      [channelId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Channel not found" });
    }

    res.json({
      success: true,
      channel: result.rows[0],
      canSend: hasPower(req.admin, "message_channels"),
      canManage: hasPower(req.admin, "manage_channels"),
    });
  } catch (error) {
    console.error("Get channel error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load channel" });
  }
});

router.get("/:id/members", async (req, res) => {
  try {
    const channel = await pool.query(
      `
      SELECT
        id,
        name,
        created_by_role,
        created_by_admin_id,
        created_by_name
      FROM channels
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (!channel.rows[0]) {
      return res.status(404).json({ success: false, message: "Channel not found" });
    }

    if (!(await canReachChannel(req.admin, req.params.id))) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this channel",
      });
    }

    const canViewDetails = hasPower(req.admin, "view_channel_people");

    const counts = await pool.query(
      `
      SELECT
        (
          SELECT COUNT(*)::int
          FROM channel_admins ca
          WHERE ca.channel_id = $1
        ) AS admin_count,
        (
          SELECT COUNT(*)::int
          FROM channel_members cm
          WHERE cm.channel_id = $1
        ) AS member_count
      `,
      [req.params.id]
    );

    const adminCount = counts.rows[0]?.admin_count || 0;
    const memberCount = counts.rows[0]?.member_count || 0;

    if (!canViewDetails) {
      return res.json({
        success: true,
        canViewDetails: false,
        channel: channel.rows[0],
        adminCount,
        memberCount,
        admins: [],
        members: [],
      });
    }

    const [admins, members] = await Promise.all([
      pool.query(
        `
        SELECT
          ca.id AS membership_id,
          ca.role,
          ca.joined_at,
          a.id AS portal_admin_id,
          a.admin_id,
          a.name,
          a.email
        FROM channel_admins ca
        JOIN portal_admins a ON a.id = ca.portal_admin_id
        WHERE ca.channel_id = $1
        ORDER BY ca.joined_at ASC, a.name ASC
        `,
        [req.params.id]
      ),
      pool.query(
        `
        SELECT
          cm.id AS membership_id,
          cm.joined_at,
          s.id AS student_id,
          s.first_name,
          s.last_name,
          s.email,
          s.phone
        FROM channel_members cm
        JOIN students s ON s.id = cm.student_id
        WHERE cm.channel_id = $1
        ORDER BY cm.joined_at DESC, s.first_name ASC
        `,
        [req.params.id]
      ),
    ]);

    res.json({
      success: true,
      canViewDetails: true,
      channel: channel.rows[0],
      adminCount,
      memberCount,
      admins: admins.rows,
      members: members.rows,
    });
  } catch (error) {
    console.error("List channel members error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load channel members",
    });
  }
});

router.post("/:id/members", canManageChannels, async (req, res) => {
  try {
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({
        success: false,
        message: "Student ID is required",
      });
    }

    const channel = await pool.query("SELECT id FROM channels WHERE id = $1", [
      req.params.id,
    ]);

    if (!channel.rows[0]) {
      return res.status(404).json({ success: false, message: "Channel not found" });
    }

    const student = await pool.query("SELECT id FROM students WHERE id = $1", [
      studentId,
    ]);

    if (!student.rows[0]) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    const result = await pool.query(
      `
      INSERT INTO channel_members (channel_id, student_id)
      VALUES ($1, $2)
      ON CONFLICT (channel_id, student_id) DO NOTHING
      RETURNING *
      `,
      [req.params.id, studentId]
    );

    if (!result.rows[0]) {
      return res.status(409).json({
        success: false,
        message: "Student is already a member of this channel",
      });
    }

    res.status(201).json({ success: true, member: result.rows[0] });
  } catch (error) {
    console.error("Add channel member error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to add channel member",
    });
  }
});

router.post("/:id/members/bulk", canManageChannels, async (req, res) => {
  try {
    const { studentIds = [], batchIds = [] } = req.body;
    const channelId = Number(req.params.id);

    const channel = await pool.query("SELECT id FROM channels WHERE id = $1", [
      channelId,
    ]);

    if (!channel.rows[0]) {
      return res.status(404).json({ success: false, message: "Channel not found" });
    }

    const ids = new Set(
      (Array.isArray(studentIds) ? studentIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    );

    const validBatchIds = (Array.isArray(batchIds) ? batchIds : [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);

    if (validBatchIds.length) {
      const batchStudents = await pool.query(
        `
        SELECT DISTINCT student_id
        FROM enrollments
        WHERE batch_id = ANY($1::int[])
          AND student_id IS NOT NULL
        `,
        [validBatchIds]
      );

      for (const row of batchStudents.rows) {
        ids.add(Number(row.student_id));
      }
    }

    if (!ids.size) {
      return res.status(400).json({
        success: false,
        message: "Select at least one student or batch",
      });
    }

    const idList = [...ids];
    const inserted = await pool.query(
      `
      INSERT INTO channel_members (channel_id, student_id)
      SELECT $1, student_id
      FROM UNNEST($2::int[]) AS student_id
      ON CONFLICT (channel_id, student_id) DO NOTHING
      RETURNING id
      `,
      [channelId, idList]
    );

    res.status(201).json({
      success: true,
      added: inserted.rowCount,
      skipped: idList.length - inserted.rowCount,
      total: idList.length,
    });
  } catch (error) {
    console.error("Bulk add channel members error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to add members in bulk",
    });
  }
});

router.post("/:id/admins", canManageChannels, async (req, res) => {
  try {
    const { portalAdminId } = req.body;

    if (!portalAdminId) {
      return res.status(400).json({
        success: false,
        message: "Portal admin ID is required",
      });
    }

    const channel = await pool.query("SELECT id FROM channels WHERE id = $1", [
      req.params.id,
    ]);

    if (!channel.rows[0]) {
      return res.status(404).json({ success: false, message: "Channel not found" });
    }

    const admin = await pool.query(
      `
      SELECT id
      FROM portal_admins
      WHERE id = $1 AND is_active = TRUE
      `,
      [portalAdminId]
    );

    if (!admin.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Portal admin not found",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO channel_admins (channel_id, portal_admin_id, role)
      VALUES ($1, $2, 'admin')
      ON CONFLICT (channel_id, portal_admin_id) DO NOTHING
      RETURNING *
      `,
      [req.params.id, portalAdminId]
    );

    if (!result.rows[0]) {
      return res.status(409).json({
        success: false,
        message: "Admin is already in this channel",
      });
    }

    res.status(201).json({ success: true, admin: result.rows[0] });
  } catch (error) {
    console.error("Add channel admin error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to add channel admin",
    });
  }
});

router.delete("/:id/members/:studentId", canManageChannels, async (req, res) => {
  try {
    const result = await pool.query(
      `
      DELETE FROM channel_members
      WHERE channel_id = $1 AND student_id = $2
      RETURNING id
      `,
      [req.params.id, req.params.studentId]
    );

    if (!result.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Channel member not found",
      });
    }

    res.json({ success: true, message: "Member removed" });
  } catch (error) {
    console.error("Remove channel member error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to remove channel member",
    });
  }
});

router.delete(
  "/:id/admins/:portalAdminId",
  canManageChannels,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        DELETE FROM channel_admins
        WHERE channel_id = $1 AND portal_admin_id = $2
        RETURNING id
        `,
        [req.params.id, req.params.portalAdminId]
      );

      if (!result.rows[0]) {
        return res.status(404).json({
          success: false,
          message: "Channel admin not found",
        });
      }

      res.json({ success: true, message: "Admin removed" });
    } catch (error) {
      console.error("Remove channel admin error:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to remove channel admin",
      });
    }
  }
);

const MESSAGE_SELECT = `
  m.id,
  m.channel_id,
  m.title,
  m.body,
  m.sent_by,
  m.sent_by_role,
  m.sent_by_portal_admin_id,
  m.created_at,
  m.edited_at,
  m.media_type,
  m.media_url,
  m.media_mime,
  m.media_size,
  m.media_duration_ms,
  m.media_name,
  a.name AS sender_name,
  a.admin_id AS sender_admin_id,
  (
    SELECT COUNT(*)::int
    FROM channel_message_reads r
    WHERE r.message_id = m.id
  ) AS student_seen_count,
  (
    SELECT COUNT(*)::int
    FROM channel_message_admin_reads ar
    WHERE ar.message_id = m.id
  ) AS admin_seen_count,
  (
    (
      SELECT COUNT(*)::int
      FROM channel_message_reads r
      WHERE r.message_id = m.id
    )
    +
    (
      SELECT COUNT(*)::int
      FROM channel_message_admin_reads ar
      WHERE ar.message_id = m.id
    )
  ) AS seen_count
`;

// Super admin has no portal_admins row, so ownership falls back to the label
function ownsMessage(admin, message) {
  const portalAdminId = portalAdminIdOf(admin);

  if (portalAdminId && message.sent_by_portal_admin_id) {
    return message.sent_by_portal_admin_id === portalAdminId;
  }

  return (
    isSuperAdmin(admin) && message.sent_by_role === "super_admin"
  );
}

async function fetchMessageById(id) {
  const result = await pool.query(
    `
    SELECT ${MESSAGE_SELECT}
    FROM channel_messages m
    LEFT JOIN portal_admins a ON a.id = m.sent_by_portal_admin_id
    WHERE m.id = $1 AND m.deleted_at IS NULL
    `,
    [id]
  );
  return result.rows[0] || null;
}

async function fetchMessageSeenBy(messageId) {
  const [students, admins] = await Promise.all([
    pool.query(
      `
      SELECT
        'student'::text AS kind,
        r.student_id AS viewer_id,
        r.seen_at,
        s.first_name,
        s.last_name,
        s.email,
        s.phone,
        NULL::text AS admin_name,
        NULL::text AS admin_role
      FROM channel_message_reads r
      JOIN students s ON s.id = r.student_id
      WHERE r.message_id = $1
      `,
      [messageId]
    ),
    pool.query(
      `
      SELECT
        'admin'::text AS kind,
        COALESCE(ar.portal_admin_id, ar.super_admin_id) AS viewer_id,
        ar.seen_at,
        NULL::text AS first_name,
        NULL::text AS last_name,
        NULL::text AS email,
        NULL::text AS phone,
        CASE
          WHEN ar.portal_admin_id IS NOT NULL THEN COALESCE(pa.name, 'Admin')
          ELSE 'Super Admin'
        END AS admin_name,
        CASE
          WHEN ar.portal_admin_id IS NOT NULL THEN COALESCE(at.name, 'Admin')
          ELSE 'Super Admin'
        END AS admin_role
      FROM channel_message_admin_reads ar
      LEFT JOIN portal_admins pa ON pa.id = ar.portal_admin_id
      LEFT JOIN portal_admin_types at ON at.id = pa.admin_type_id
      WHERE ar.message_id = $1
      `,
      [messageId]
    ),
  ]);

  return [...students.rows, ...admins.rows].sort((a, b) => {
    const ta = new Date(a.seen_at).getTime();
    const tb = new Date(b.seen_at).getTime();
    return tb - ta;
  });
}

async function memberCountForChannel(channelId) {
  const result = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM channel_members
    WHERE channel_id = $1
    `,
    [channelId]
  );
  return result.rows[0]?.count || 0;
}

async function markAdminSeenMessages(admin, channelId, messageIds = null) {
  const portalAdminId = portalAdminIdOf(admin);
  const superAdminId = isSuperAdmin(admin) ? Number(admin.adminId) : null;

  if (!portalAdminId && !(Number.isFinite(superAdminId) && superAdminId > 0)) {
    return [];
  }

  try {
    const params = [channelId];
    let idFilter = "";
    if (Array.isArray(messageIds) && messageIds.length) {
      params.push(messageIds.map(Number).filter((n) => Number.isFinite(n)));
      idFilter = `AND m.id = ANY($${params.length}::int[])`;
    }

    // Don't count the sender viewing their own message
    let exclude = "";
    if (portalAdminId) {
      params.push(portalAdminId);
      exclude = `AND (m.sent_by_portal_admin_id IS DISTINCT FROM $${params.length})`;
    } else {
      exclude = `AND m.sent_by_role IS DISTINCT FROM 'super_admin'`;
    }

    const candidates = await pool.query(
      `
      SELECT m.id
      FROM channel_messages m
      WHERE m.channel_id = $1
        AND m.deleted_at IS NULL
        ${idFilter}
        ${exclude}
      ORDER BY m.id DESC
      LIMIT 1000
      `,
      params
    );

    if (!candidates.rows.length) return [];

    const ids = candidates.rows.map((row) => Number(row.id));
    let inserted = [];

    if (portalAdminId) {
      const result = await pool.query(
        `
        INSERT INTO channel_message_admin_reads (message_id, portal_admin_id)
        SELECT x.id, $2::int
        FROM unnest($1::int[]) AS x(id)
        ON CONFLICT DO NOTHING
        RETURNING message_id, seen_at
        `,
        [ids, portalAdminId]
      );
      inserted = result.rows;
    } else {
      const result = await pool.query(
        `
        INSERT INTO channel_message_admin_reads (message_id, super_admin_id)
        SELECT x.id, $2::int
        FROM unnest($1::int[]) AS x(id)
        ON CONFLICT DO NOTHING
        RETURNING message_id, seen_at
        `,
        [ids, superAdminId]
      );
      inserted = result.rows;
    }

    return inserted;
  } catch (error) {
    // Seen receipts must never break loading / sending messages
    console.error("Mark admin seen error:", error.message);
    return [];
  }
}

async function totalSeenCount(messageId) {
  const result = await pool.query(
    `
    SELECT
      (
        (SELECT COUNT(*)::int FROM channel_message_reads WHERE message_id = $1)
        +
        (SELECT COUNT(*)::int FROM channel_message_admin_reads WHERE message_id = $1)
      ) AS count
    `,
    [messageId]
  );
  return result.rows[0]?.count || 0;
}

router.get("/:id/messages", async (req, res) => {
  try {
    const channelId = Number(req.params.id);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = Number(req.query.before) || null;

    if (!(await canReachChannel(req.admin, channelId))) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this channel",
      });
    }

    // Newest first for pagination, then flipped so the client renders a thread
    const result = await pool.query(
      `
      SELECT ${MESSAGE_SELECT}
      FROM channel_messages m
      LEFT JOIN portal_admins a ON a.id = m.sent_by_portal_admin_id
      WHERE m.channel_id = $1
        AND m.deleted_at IS NULL
        AND ($2::int IS NULL OR m.id < $2::int)
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3
      `,
      [channelId, before, limit]
    );

    const messages = result.rows.reverse();
    const memberCount = await memberCountForChannel(channelId);

    // Opening the thread marks recent unread messages as seen (clears channel badge)
    const newlySeen = await markAdminSeenMessages(req.admin, channelId, null);

    for (const row of newlySeen) {
      const seenCount = await totalSeenCount(row.message_id);
      broadcastChannelEvent(channelId, "message.seen", {
        messageId: row.message_id,
        seenCount,
        read: {
          kind: "admin",
          seen_at: row.seen_at,
        },
      });
    }

    // Refresh counts after marking so the opener sees updated ticks for others
    const refreshed =
      newlySeen.length === 0
        ? messages
        : (
            await pool.query(
              `
              SELECT ${MESSAGE_SELECT}
              FROM channel_messages m
              LEFT JOIN portal_admins a ON a.id = m.sent_by_portal_admin_id
              WHERE m.id = ANY($1::int[])
              `,
              [messages.map((row) => row.id)]
            )
          ).rows.sort(
            (a, b) =>
              messages.findIndex((m) => m.id === a.id) -
              messages.findIndex((m) => m.id === b.id)
          );

    res.json({
      success: true,
      messages: refreshed,
      memberCount,
      hasMore: result.rows.length === limit,
      canSend: hasPower(req.admin, "message_channels"),
    });
  } catch (error) {
    console.error("List channel messages error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load messages",
    });
  }
});

router.get("/:id/messages/:messageId", async (req, res) => {
  try {
    const channelId = Number(req.params.id);
    const messageId = Number(req.params.messageId);

    if (!(await canReachChannel(req.admin, channelId))) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this channel",
      });
    }

    const message = await fetchMessageById(messageId);

    if (!message || message.channel_id !== channelId) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    // Opening message info also marks this admin as having seen it
    await markAdminSeenMessages(req.admin, channelId, [messageId]);

    const [seenBy, memberCount, messageFresh] = await Promise.all([
      fetchMessageSeenBy(messageId),
      memberCountForChannel(channelId),
      fetchMessageById(messageId),
    ]);

    const studentSeenCount = messageFresh?.student_seen_count ?? 0;

    res.json({
      success: true,
      message: messageFresh,
      seenBy,
      seenCount: seenBy.length,
      studentSeenCount,
      adminSeenCount: messageFresh?.admin_seen_count ?? 0,
      memberCount,
      unseenCount: Math.max(0, memberCount - studentSeenCount),
    });
  } catch (error) {
    console.error("Get channel message error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load message",
    });
  }
});

// Record that a channel member has seen a message (student app will call this later)
router.post("/:id/messages/:messageId/seen", async (req, res) => {
  try {
    const channelId = Number(req.params.id);
    const messageId = Number(req.params.messageId);
    const studentId = Number(req.body?.studentId);

    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({
        success: false,
        message: "studentId is required",
      });
    }

    if (!(await canReachChannel(req.admin, channelId))) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this channel",
      });
    }

    const message = await pool.query(
      `
      SELECT id
      FROM channel_messages
      WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL
      `,
      [messageId, channelId]
    );

    if (!message.rows[0]) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    const membership = await pool.query(
      `
      SELECT 1
      FROM channel_members
      WHERE channel_id = $1 AND student_id = $2
      `,
      [channelId, studentId]
    );

    if (!membership.rows[0]) {
      return res.status(403).json({
        success: false,
        message: "This student is not a member of the channel",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO channel_message_reads (message_id, student_id)
      VALUES ($1, $2)
      ON CONFLICT (message_id, student_id) DO UPDATE
        SET seen_at = channel_message_reads.seen_at
      RETURNING message_id, student_id, seen_at
      `,
      [messageId, studentId]
    );

    const seenCount = await totalSeenCount(messageId);

    res.json({
      success: true,
      read: result.rows[0],
      seenCount,
    });

    broadcastChannelEvent(channelId, "message.seen", {
      messageId,
      seenCount,
      read: { ...result.rows[0], kind: "student" },
    });
  } catch (error) {
    console.error("Mark message seen error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to mark message as seen",
    });
  }
});

router.post(
  "/:id/messages",
  requirePower("message_channels"),
  (req, res, next) => {
    channelMediaUpload.single("media")(req, res, (error) => {
      if (error) {
        return res.status(400).json({
          success: false,
          message: error.message || "Upload failed",
        });
      }
      next();
    });
  },
  async (req, res) => {
    let uploadedName = req.file?.filename || null;

    try {
      const channelId = Number(req.params.id);
      const title = (req.body.title || "").trim() || null;
      const body = (req.body.body || "").trim();
      const durationRaw = Number(req.body.mediaDurationMs);
      const mediaDurationMs =
        Number.isFinite(durationRaw) && durationRaw > 0
          ? Math.round(durationRaw)
          : null;

          const mediaType = req.file
            ? mediaKindFromMime(req.file.mimetype, req.file.originalname)
            : null;

      if (req.file && !mediaType) {
        unlinkUpload(uploadedName);
        uploadedName = null;
        return res.status(400).json({
          success: false,
          message: "Unsupported media type",
        });
      }

      if (!body && !req.file) {
        return res.status(400).json({
          success: false,
          message: "Message text or media is required",
        });
      }

      if (!(await canReachChannel(req.admin, channelId))) {
        unlinkUpload(uploadedName);
        uploadedName = null;
        return res.status(403).json({
          success: false,
          message: "You do not have access to this channel",
        });
      }

      const channel = await pool.query(
        "SELECT id FROM channels WHERE id = $1",
        [channelId]
      );

      if (!channel.rows[0]) {
        unlinkUpload(uploadedName);
        uploadedName = null;
        return res.status(404).json({
          success: false,
          message: "Channel not found",
        });
      }

      const sender = creatorFromAdmin(req.admin);
      const mediaUrl = req.file ? publicUploadPath(req.file.filename) : null;

      const created = await pool.query(
        `
        INSERT INTO channel_messages
          (
            channel_id, title, body, sent_by, sent_by_role, sent_by_portal_admin_id,
            media_type, media_url, media_mime, media_size, media_duration_ms, media_name
          )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
        `,
        [
          channelId,
          title,
          body || (mediaType === "audio" ? "Voice message" : mediaType ? "Attachment" : ""),
          sender.name,
          sender.role,
          sender.portalAdminId,
          mediaType,
          mediaUrl,
          req.file?.mimetype || null,
          req.file?.size || null,
          mediaType === "audio" ? mediaDurationMs : null,
          req.file?.originalname || null,
        ]
      );

      uploadedName = null;
      const message = await fetchMessageById(created.rows[0].id);
      broadcastChannelEvent(channelId, "message.created", { message });
      res.status(201).json({ success: true, message });
    } catch (error) {
      unlinkUpload(uploadedName);
      console.error("Send channel message error:", error.message);
      res.status(500).json({
        success: false,
        message: "Failed to send message",
      });
    }
  }
);

router.put("/:id/messages/:messageId", async (req, res) => {
  try {
    const { title, body } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message body is required",
      });
    }

    const existing = await pool.query(
      `
      SELECT id, channel_id, sent_by_role, sent_by_portal_admin_id, media_type
      FROM channel_messages
      WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL
      `,
      [req.params.messageId, req.params.id]
    );

    const message = existing.rows[0];

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    if (!ownsMessage(req.admin, message) && !hasPower(req.admin, "manage_channels")) {
      return res.status(403).json({
        success: false,
        message: "You can only edit your own messages",
      });
    }

    await pool.query(
      `
      UPDATE channel_messages
      SET title = $1, body = $2, edited_at = NOW()
      WHERE id = $3
      `,
      [title?.trim() || null, body.trim(), message.id]
    );

    const updated = await fetchMessageById(message.id);
    broadcastChannelEvent(message.channel_id, "message.updated", {
      message: updated,
    });
    res.json({ success: true, message: updated });
  } catch (error) {
    console.error("Edit channel message error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update message",
    });
  }
});

router.delete("/:id/messages/:messageId", async (req, res) => {
  try {
    const existing = await pool.query(
      `
      SELECT id, sent_by_role, sent_by_portal_admin_id
      FROM channel_messages
      WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL
      `,
      [req.params.messageId, req.params.id]
    );

    const message = existing.rows[0];

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    if (!ownsMessage(req.admin, message) && !hasPower(req.admin, "manage_channels")) {
      return res.status(403).json({
        success: false,
        message: "You can only delete your own messages",
      });
    }

    await pool.query(
      "UPDATE channel_messages SET deleted_at = NOW() WHERE id = $1",
      [message.id]
    );

    broadcastChannelEvent(req.params.id, "message.deleted", {
      messageId: Number(message.id),
    });

    res.json({ success: true, message: "Message deleted" });
  } catch (error) {
    console.error("Delete channel message error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete message",
    });
  }
});

export default router;

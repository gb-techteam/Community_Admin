import express from "express";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { requireAuth, requirePower } from "../middleware/auth.js";
import { PORTAL_POWERS } from "../constants/powers.js";

const router = express.Router();

router.use(requireAuth);
router.use(requirePower("create_admins"));

async function getAdminWithType(id) {
  const result = await pool.query(
    `
    SELECT
      a.id,
      a.admin_id,
      a.name,
      a.email,
      a.admin_type,
      a.admin_type_id,
      a.is_active,
      a.created_at,
      a.updated_at,
      t.name AS type_name,
      t.is_signal_only,
      COALESCE(
        ARRAY_REMOVE(ARRAY_AGG(p.power ORDER BY p.power), NULL),
        ARRAY[]::varchar[]
      ) AS powers
    FROM portal_admins a
    LEFT JOIN portal_admin_types t ON t.id = a.admin_type_id
    LEFT JOIN portal_admin_type_powers p ON p.admin_type_id = t.id
    WHERE a.id = $1
    GROUP BY a.id, t.id
    `,
    [id]
  );

  return result.rows[0] || null;
}

async function getTypeById(typeId) {
  const result = await pool.query(
    `
    SELECT
      t.id,
      t.name,
      t.is_signal_only,
      t.is_active,
      COALESCE(
        ARRAY_REMOVE(ARRAY_AGG(p.power ORDER BY p.power), NULL),
        ARRAY[]::varchar[]
      ) AS powers
    FROM portal_admin_types t
    LEFT JOIN portal_admin_type_powers p ON p.admin_type_id = t.id
    WHERE t.id = $1
    GROUP BY t.id
    `,
    [typeId]
  );
  return result.rows[0] || null;
}

router.get("/powers", (_req, res) => {
  res.json({
    success: true,
    powers: PORTAL_POWERS,
  });
});

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        a.id,
        a.admin_id,
        a.name,
        a.email,
        a.admin_type,
        a.admin_type_id,
        a.is_active,
        a.created_at,
        a.updated_at,
        t.name AS type_name,
        t.is_signal_only,
        COALESCE(
          ARRAY_REMOVE(ARRAY_AGG(p.power ORDER BY p.power), NULL),
          ARRAY[]::varchar[]
        ) AS powers
      FROM portal_admins a
      LEFT JOIN portal_admin_types t ON t.id = a.admin_type_id
      LEFT JOIN portal_admin_type_powers p ON p.admin_type_id = t.id
      GROUP BY a.id, t.id
      ORDER BY a.created_at DESC, a.id DESC
    `);

    res.json({ success: true, admins: result.rows });
  } catch (error) {
    console.error("List portal admins error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load admins" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      adminId,
      name,
      email,
      password,
      isActive = true,
      adminTypeId,
    } = req.body;

    if (!adminId?.trim() || !name?.trim() || !password) {
      return res.status(400).json({
        success: false,
        message: "Admin ID, name, and password are required",
      });
    }

    if (!adminTypeId) {
      return res.status(400).json({
        success: false,
        message: "Admin type is required",
      });
    }

    if (adminId.trim() === process.env.SUPER_ADMIN_ID) {
      return res.status(400).json({
        success: false,
        message: "This admin ID is reserved for super admin",
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const type = await getTypeById(adminTypeId);
    if (!type || !type.is_active) {
      return res.status(400).json({
        success: false,
        message: "Selected admin type is invalid or inactive",
      });
    }

    const legacyType = type.is_signal_only ? "signal_giver" : "staff";
    const passwordHash = await bcrypt.hash(String(password), 10);

    const created = await pool.query(
      `
      INSERT INTO portal_admins
        (admin_id, name, email, password_hash, admin_type, admin_type_id, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
      `,
      [
        adminId.trim(),
        name.trim(),
        email?.trim() || null,
        passwordHash,
        legacyType,
        type.id,
        Boolean(isActive),
      ]
    );

    const admin = await getAdminWithType(created.rows[0].id);
    res.status(201).json({ success: true, admin });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An admin with this ID already exists",
      });
    }
    console.error("Create portal admin error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create admin" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const {
      adminId,
      name,
      email,
      password,
      isActive = true,
      adminTypeId,
    } = req.body;

    if (!adminId?.trim() || !name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Admin ID and name are required",
      });
    }

    if (!adminTypeId) {
      return res.status(400).json({
        success: false,
        message: "Admin type is required",
      });
    }

    if (adminId.trim() === process.env.SUPER_ADMIN_ID) {
      return res.status(400).json({
        success: false,
        message: "This admin ID is reserved for super admin",
      });
    }

    const existing = await getAdminWithType(req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    const type = await getTypeById(adminTypeId);
    if (!type || !type.is_active) {
      return res.status(400).json({
        success: false,
        message: "Selected admin type is invalid or inactive",
      });
    }

    const legacyType = type.is_signal_only ? "signal_giver" : "staff";

    let updated;
    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters",
        });
      }

      const passwordHash = await bcrypt.hash(String(password), 10);
      updated = await pool.query(
        `
        UPDATE portal_admins
        SET
          admin_id = $1,
          name = $2,
          email = $3,
          password_hash = $4,
          admin_type = $5,
          admin_type_id = $6,
          is_active = $7,
          updated_at = NOW()
        WHERE id = $8
        RETURNING id
        `,
        [
          adminId.trim(),
          name.trim(),
          email?.trim() || null,
          passwordHash,
          legacyType,
          type.id,
          Boolean(isActive),
          req.params.id,
        ]
      );
    } else {
      updated = await pool.query(
        `
        UPDATE portal_admins
        SET
          admin_id = $1,
          name = $2,
          email = $3,
          admin_type = $4,
          admin_type_id = $5,
          is_active = $6,
          updated_at = NOW()
        WHERE id = $7
        RETURNING id
        `,
        [
          adminId.trim(),
          name.trim(),
          email?.trim() || null,
          legacyType,
          type.id,
          Boolean(isActive),
          req.params.id,
        ]
      );
    }

    if (!updated.rows[0]) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    const admin = await getAdminWithType(req.params.id);
    res.json({ success: true, admin });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An admin with this ID already exists",
      });
    }
    console.error("Update portal admin error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update admin" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM portal_admins WHERE id = $1 RETURNING id",
      [req.params.id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }

    res.json({ success: true, message: "Admin deleted" });
  } catch (error) {
    console.error("Delete portal admin error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete admin" });
  }
});

export default router;

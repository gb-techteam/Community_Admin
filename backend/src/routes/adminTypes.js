import express from "express";
import pool from "../config/db.js";
import { requireAuth, requirePower } from "../middleware/auth.js";
import {
  PORTAL_POWERS,
  normalizeTypePowers,
} from "../constants/powers.js";

const router = express.Router();

router.use(requireAuth);
router.use(requirePower("create_admins"));

async function getTypeWithPowers(id) {
  const result = await pool.query(
    `
    SELECT
      t.id,
      t.name,
      t.description,
      t.is_signal_only,
      t.is_active,
      t.created_at,
      t.updated_at,
      COALESCE(
        (
          SELECT ARRAY_AGG(p.power ORDER BY p.power)
          FROM portal_admin_type_powers p
          WHERE p.admin_type_id = t.id
        ),
        ARRAY[]::varchar[]
      ) AS powers,
      (
        SELECT COUNT(*)::int
        FROM portal_admins a
        WHERE a.admin_type_id = t.id
      ) AS admin_count
    FROM portal_admin_types t
    WHERE t.id = $1
    `,
    [id]
  );

  return result.rows[0] || null;
}

router.get("/powers", (_req, res) => {
  res.json({ success: true, powers: PORTAL_POWERS });
});

router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.id,
        t.name,
        t.description,
        t.is_signal_only,
        t.is_active,
        t.created_at,
        t.updated_at,
        COALESCE(
          (
            SELECT ARRAY_AGG(p.power ORDER BY p.power)
            FROM portal_admin_type_powers p
            WHERE p.admin_type_id = t.id
          ),
          ARRAY[]::varchar[]
        ) AS powers,
        (
          SELECT COUNT(*)::int
          FROM portal_admins a
          WHERE a.admin_type_id = t.id
        ) AS admin_count
      FROM portal_admin_types t
      ORDER BY t.is_signal_only ASC, t.name ASC, t.id ASC
    `);

    res.json({ success: true, types: result.rows });
  } catch (error) {
    console.error("List admin types error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load admin types" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      name,
      description,
      isSignalOnly = false,
      isActive = true,
      powers = [],
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Type name is required",
      });
    }

    const signalOnly = Boolean(isSignalOnly);
    const selectedPowers = normalizeTypePowers(powers, signalOnly, req.admin);

    if (!signalOnly && !selectedPowers.length) {
      return res.status(400).json({
        success: false,
        message: "Select at least one power, or mark as signal giving only",
      });
    }

    const created = await pool.query(
      `
      INSERT INTO portal_admin_types (name, description, is_signal_only, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING id
      `,
      [
        name.trim(),
        description?.trim() || null,
        signalOnly,
        Boolean(isActive),
      ]
    );

    const typeId = created.rows[0].id;

    for (const power of selectedPowers) {
      await pool.query(
        `
        INSERT INTO portal_admin_type_powers (admin_type_id, power)
        VALUES ($1, $2)
        `,
        [typeId, power]
      );
    }

    const type = await getTypeWithPowers(typeId);
    res.status(201).json({ success: true, type });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An admin type with this name already exists",
      });
    }
    console.error("Create admin type error:", error.message);
    res.status(500).json({ success: false, message: "Failed to create admin type" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const {
      name,
      description,
      isSignalOnly = false,
      isActive = true,
      powers = [],
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Type name is required",
      });
    }

    const existing = await getTypeWithPowers(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Admin type not found",
      });
    }

    const signalOnly = Boolean(isSignalOnly);
    const selectedPowers = normalizeTypePowers(
      powers,
      signalOnly,
      req.admin,
      existing.powers || []
    );

    if (!signalOnly && !selectedPowers.length) {
      return res.status(400).json({
        success: false,
        message: "Select at least one power, or mark as signal giving only",
      });
    }

    await pool.query(
      `
      UPDATE portal_admin_types
      SET
        name = $1,
        description = $2,
        is_signal_only = $3,
        is_active = $4,
        updated_at = NOW()
      WHERE id = $5
      `,
      [
        name.trim(),
        description?.trim() || null,
        signalOnly,
        Boolean(isActive),
        req.params.id,
      ]
    );

    await pool.query(
      "DELETE FROM portal_admin_type_powers WHERE admin_type_id = $1",
      [req.params.id]
    );

    for (const power of selectedPowers) {
      await pool.query(
        `
        INSERT INTO portal_admin_type_powers (admin_type_id, power)
        VALUES ($1, $2)
        `,
        [req.params.id, power]
      );
    }

    // Keep legacy admin_type column roughly in sync for older queries
    if (signalOnly) {
      await pool.query(
        `
        UPDATE portal_admins
        SET admin_type = 'signal_giver'
        WHERE admin_type_id = $1
        `,
        [req.params.id]
      );
    } else {
      await pool.query(
        `
        UPDATE portal_admins
        SET admin_type = 'staff'
        WHERE admin_type_id = $1
        `,
        [req.params.id]
      );
    }

    const type = await getTypeWithPowers(req.params.id);
    res.json({ success: true, type });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An admin type with this name already exists",
      });
    }
    console.error("Update admin type error:", error.message);
    res.status(500).json({ success: false, message: "Failed to update admin type" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const existing = await getTypeWithPowers(req.params.id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Admin type not found",
      });
    }

    if (existing.admin_count > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete a type that is assigned to admins",
      });
    }

    await pool.query("DELETE FROM portal_admin_types WHERE id = $1", [
      req.params.id,
    ]);

    res.json({ success: true, message: "Admin type deleted" });
  } catch (error) {
    console.error("Delete admin type error:", error.message);
    res.status(500).json({ success: false, message: "Failed to delete admin type" });
  }
});

export default router;

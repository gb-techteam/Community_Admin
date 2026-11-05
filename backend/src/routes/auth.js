import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import pool from "../config/db.js";
import { ALL_POWER_KEYS } from "../constants/powers.js";
import { getAdminTypeAndPowers } from "../services/portalAdmins.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { adminId, password, client } = req.body;
    const loginClient = client === "portal" ? "portal" : "app";

    if (!adminId || !password) {
      return res.status(400).json({
        success: false,
        message: "Admin ID and password are required",
      });
    }

    const superId = process.env.SUPER_ADMIN_ID;
    const superPassword = process.env.SUPER_ADMIN_PASSWORD;

    if (adminId === superId && password === superPassword) {
      const token = jwt.sign(
        {
          role: "super_admin",
          adminId,
          name: "Super Admin",
          adminType: "super",
          powers: ALL_POWER_KEYS,
        },
        process.env.JWT_SECRET,
        { expiresIn: "24h" }
      );

      return res.json({
        success: true,
        message: "Login successful",
        token,
        admin: {
          id: adminId,
          name: "Super Admin",
          role: "super_admin",
          adminType: "super",
          powers: ALL_POWER_KEYS,
        },
      });
    }

    const result = await pool.query(
      `
      SELECT id, password_hash, is_active
      FROM portal_admins
      WHERE admin_id = $1
      LIMIT 1
      `,
      [adminId.trim()]
    );

    const portalAdmin = result.rows[0];

    if (!portalAdmin) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin ID or password",
      });
    }

    if (!portalAdmin.is_active) {
      return res.status(403).json({
        success: false,
        message: "This admin account is disabled",
      });
    }

    const passwordOk = await bcrypt.compare(password, portalAdmin.password_hash);

    if (!passwordOk) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin ID or password",
      });
    }

    const full = await getAdminTypeAndPowers(portalAdmin.id);
    const isSignalOnly =
      Boolean(full?.is_signal_only) || full?.admin_type === "signal_giver";
    const powers = full?.powers || [];

    if (isSignalOnly && loginClient === "portal") {
      return res.status(403).json({
        success: false,
        message:
          "Signal giver accounts are for the app only, not this admin portal",
      });
    }

    const token = jwt.sign(
      {
        role: "portal_admin",
        adminId: full.admin_id,
        portalAdminId: full.id,
        name: full.name,
        adminType: isSignalOnly ? "signal_giver" : "staff",
        adminTypeId: full.admin_type_id,
        adminTypeName: full.type_name,
        isSignalOnly,
        powers,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );

    return res.json({
      success: true,
      message: "Login successful",
      token,
      admin: {
        id: full.admin_id,
        portalAdminId: full.id,
        name: full.name,
        email: full.email,
        role: "portal_admin",
        adminType: isSignalOnly ? "signal_giver" : "staff",
        adminTypeId: full.admin_type_id,
        adminTypeName: full.type_name,
        isSignalOnly,
        powers,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
});

router.get("/me", async (req, res) => {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.role === "super_admin") {
      return res.json({
        success: true,
        admin: {
          id: payload.adminId,
          name: payload.name || "Super Admin",
          role: "super_admin",
          adminType: "super",
          powers: ALL_POWER_KEYS,
        },
      });
    }

    const full = await getAdminTypeAndPowers(payload.portalAdminId);

    if (!full || !full.is_active) {
      return res.status(401).json({
        success: false,
        message: "Admin account not found or disabled",
      });
    }

    const isSignalOnly =
      Boolean(full.is_signal_only) || full.admin_type === "signal_giver";

    return res.json({
      success: true,
      admin: {
        id: full.admin_id,
        portalAdminId: full.id,
        name: full.name,
        email: full.email,
        role: "portal_admin",
        adminType: isSignalOnly ? "signal_giver" : "staff",
        adminTypeId: full.admin_type_id,
        adminTypeName: full.type_name,
        isSignalOnly,
        powers: full.powers || [],
      },
    });
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
});

export default router;

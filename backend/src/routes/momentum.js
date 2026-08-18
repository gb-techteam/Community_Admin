import express from "express";
import { requireAuth, requirePower } from "../middleware/auth.js";
import pool from "../config/db.js";

const router = express.Router();

router.use(requireAuth);
router.use(requirePower("manage_momentum"));

function traderConnectConfig() {
  const base = String(
    process.env.TRADER_CONNECT_API_BASE ||
      "https://traderconnectapi.greenbondsacademy.com/api"
  ).replace(/\/$/, "");
  const apiKey =
    process.env.TRADER_CONNECT_API_KEY ||
    process.env.EXTERNAL_APP_API_KEY ||
    "";
  return { base, apiKey };
}

async function traderConnectFetch(path, { method = "GET", body } = {}) {
  const { base, apiKey } = traderConnectConfig();
  if (!apiKey) {
    const err = new Error(
      "TraderConnect API key is not configured on the server"
    );
    err.status = 503;
    throw err;
  }

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-external-api-key": apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = new Error(
      data?.message ||
        data?.error ||
        `TraderConnect request failed (${response.status})`
    );
    err.status =
      response.status >= 400 && response.status < 600 ? response.status : 502;
    throw err;
  }

  return data || {};
}

async function checkTraderEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    const err = new Error("A valid email is required");
    err.status = 400;
    throw err;
  }

  const data = await traderConnectFetch(
    `/forCommunity/check-trader-email?email=${encodeURIComponent(normalized)}`
  );

  return {
    email: normalized,
    isTrader: Boolean(data?.isTrader ?? data?.is_trader ?? data?.trader),
    raw: data,
  };
}

function normalizeDashboard(data = {}) {
  const totals = data.totals || {
    totalMomentumStudents: data.totalMomentumStudents ?? 0,
    activeMomentumStudents: data.activeMomentumStudents ?? 0,
    totalMentors: data.totalMentors ?? 0,
    activeMentors: data.activeMentors ?? 0,
    totalBatches: data.totalBatches ?? 0,
    activeBatches: data.activeBatches ?? 0,
  };

  return {
    totals: {
      totalMomentumStudents: Number(totals.totalMomentumStudents) || 0,
      activeMomentumStudents: Number(totals.activeMomentumStudents) || 0,
      totalMentors: Number(totals.totalMentors) || 0,
      activeMentors: Number(totals.activeMentors) || 0,
      totalBatches: Number(totals.totalBatches) || 0,
      activeBatches: Number(totals.activeBatches) || 0,
    },
    topProfitableStudents: Array.isArray(data.topProfitableStudents)
      ? data.topProfitableStudents
      : [],
    mentors: Array.isArray(data.mentors) ? data.mentors : [],
    batches: Array.isArray(data.batches) ? data.batches : [],
  };
}

router.get("/dashboard", async (_req, res) => {
  try {
    const data = await traderConnectFetch("/forCommunity/dashboard");
    res.json({
      success: true,
      ...normalizeDashboard(data),
    });
  } catch (error) {
    console.error("Momentum dashboard error:", error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to load Momentum dashboard",
    });
  }
});

router.get("/check-trader", async (req, res) => {
  try {
    const result = await checkTraderEmail(req.query.email);
    res.json({
      success: true,
      email: result.email,
      isTrader: result.isTrader,
    });
  } catch (error) {
    console.error("Momentum trader check error:", error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to check Momentum membership",
    });
  }
});

router.post("/check-trader", async (req, res) => {
  try {
    const result = await checkTraderEmail(req.body?.email);
    res.json({
      success: true,
      email: result.email,
      isTrader: result.isTrader,
    });
  } catch (error) {
    console.error("Momentum trader check error:", error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to check Momentum membership",
    });
  }
});

/** Optional: search local students that also exist in Momentum */
router.get("/members", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    if (search.length < 2) {
      return res.json({
        success: true,
        members: [],
        message: "Enter at least 2 characters to search",
      });
    }

    const students = await pool.query(
      `
      SELECT
        s.id,
        s.first_name,
        s.last_name,
        s.email,
        s.phone
      FROM students s
      WHERE
        s.email ILIKE $1
        OR s.first_name ILIKE $1
        OR s.last_name ILIKE $1
        OR s.phone ILIKE $1
        OR CONCAT(s.first_name, ' ', s.last_name) ILIKE $1
      ORDER BY s.first_name ASC NULLS LAST, s.last_name ASC NULLS LAST
      LIMIT 25
      `,
      [`%${search}%`]
    );

    const withEmail = students.rows.filter((row) => row.email);
    const checks = await Promise.all(
      withEmail.map(async (student) => {
        try {
          const result = await checkTraderEmail(student.email);
          return { student, isTrader: result.isTrader };
        } catch {
          return { student, isTrader: false };
        }
      })
    );

    const members = checks
      .filter((item) => item.isTrader)
      .map((item) => ({
        id: item.student.id,
        first_name: item.student.first_name,
        last_name: item.student.last_name,
        email: item.student.email,
        phone: item.student.phone,
        isTrader: true,
      }));

    res.json({
      success: true,
      members,
      checked: withEmail.length,
      matched: members.length,
    });
  } catch (error) {
    console.error("Momentum members search error:", error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to search Momentum members",
    });
  }
});

export default router;

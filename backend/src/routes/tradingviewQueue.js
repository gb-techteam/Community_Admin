import express from "express";
import jwt from "jsonwebtoken";
import { hasPower } from "../constants/powers.js";
import {
  listInviteStudents,
  listRemoveStudents,
  markRemovalsDone,
} from "../services/tradingviewQueue.js";

const router = express.Router();

function configuredQueueKey() {
  return String(process.env.TRADINGVIEW_QUEUE_KEY || "").trim();
}

function allowQueueAccess(req) {
  const key = configuredQueueKey();
  const headerKey = String(
    req.headers["x-api-key"] || req.headers["x-tradingview-key"] || ""
  ).trim();
  if (key && headerKey && headerKey === key) return true;

  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return false;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (payload.role === "super_admin") return true;
    return hasPower(payload, "manage_superkandle");
  } catch {
    return false;
  }
}

function collectUsernames(body) {
  const fromStudents = Array.isArray(body?.students)
    ? body.students.map((row) => row?.tradingviewUsername)
    : [];
  return [
    ...fromStudents,
    body?.tradingviewUsername,
    ...(Array.isArray(body?.tradingviewUsernames)
      ? body.tradingviewUsernames
      : []),
  ];
}

router.use((req, res, next) => {
  if (!allowQueueAccess(req)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized",
    });
  }
  next();
});

router.get("/invite", async (_req, res) => {
  try {
    const students = await listInviteStudents();
    res.json({ success: true, students });
  } catch (error) {
    console.error("List TradingView invite students error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load registered SuperKandle students",
    });
  }
});

router.get("/remove", async (_req, res) => {
  try {
    const students = await listRemoveStudents();
    res.json({ success: true, students });
  } catch (error) {
    console.error("List TradingView remove students error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load TradingView removals",
    });
  }
});

router.post("/remove/done", async (req, res) => {
  try {
    const updated = await markRemovalsDone(collectUsernames(req.body));
    res.json({ success: true, updated });
  } catch (error) {
    console.error("Mark TradingView removals done error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to mark removals done",
    });
  }
});

export default router;

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import pool from "./config/db.js";
import { ensureAppSchema } from "./config/schema.js";
import { UPLOADS_ROOT } from "./middleware/upload.js";
import { attachChannelRealtime } from "./realtime/channels.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import studentRoutes from "./routes/students.js";
import studentRequestRoutes from "./routes/studentRequests.js";
import courseRoutes from "./routes/courses.js";
import batchRoutes from "./routes/batches.js";
import channelRoutes from "./routes/channels.js";
import portalAdminRoutes from "./routes/portalAdmins.js";
import adminTypeRoutes from "./routes/adminTypes.js";
import superkandleRoutes from "./routes/superkandle.js";
import superkandleSubscribeRoutes from "./routes/superkandleSubscribe.js";
import momentumRoutes from "./routes/momentum.js";
import settingsRoutes from "./routes/settings.js";
import { startExpiryMailJob } from "./services/superkandleMails.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

const EXTRA_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:5174",
  "https://superkandle.greenbondsacademy.com",
  ...EXTRA_ORIGINS,
]);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  const normalized = String(origin).replace(/\/$/, "");
  if (ALLOWED_ORIGINS.has(normalized)) return true;
  try {
    const { hostname } = new URL(normalized);
    return (
      hostname === "greenbondsacademy.com" ||
      hostname.endsWith(".greenbondsacademy.com")
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_ROOT, { maxAge: "7d" }));

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/student-requests", studentRequestRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/portal-admins", portalAdminRoutes);
app.use("/api/admin-types", adminTypeRoutes);
app.use("/api/superkandle/subscribe", superkandleSubscribeRoutes);
app.use("/api/superkandle", superkandleRoutes);
app.use("/api/momentum", momentumRoutes);
app.use("/api/settings", settingsRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/db-check", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS now");
    res.json({
      connected: true,
      serverTime: result.rows[0].now,
    });
  } catch (error) {
    console.error("Database connection failed:", error.message);
    res.status(500).json({
      connected: false,
      error: error.message,
    });
  }
});

async function start() {
  try {
    await ensureAppSchema();
    console.log("App schema ready");
  } catch (error) {
    console.error("Schema init failed:", error.message);
  }

  attachChannelRealtime(server);
  startExpiryMailJob();

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health check:   http://localhost:${PORT}/health`);
    console.log(`WebSocket:      ws://localhost:${PORT}/ws`);
  });
}

start();

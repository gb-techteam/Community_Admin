import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import pool, {
  connectAndVerify,
  logDbError,
  testPostgresConnection,
} from "./config/db.js";
import { ensureAppSchema } from "./config/schema.js";
import { UPLOADS_ROOT } from "./middleware/upload.js";
import { attachChannelRealtime } from "./realtime/channels.js";
import authRoutes from "./routes/auth.js";
import dashboardRoutes from "./routes/dashboard.js";
import studentRoutes from "./routes/students.js";
import courseRoutes from "./routes/courses.js";
import batchRoutes from "./routes/batches.js";
import channelRoutes from "./routes/channels.js";
import portalAdminRoutes from "./routes/portalAdmins.js";
import adminTypeRoutes from "./routes/adminTypes.js";
import superkandleRoutes from "./routes/superkandle.js";
import momentumRoutes from "./routes/momentum.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

/** Set once startup finishes verifying Postgres + schema */
let dbReady = false;
let dbLastError = null;
let dbServerTime = null;

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_ROOT, { maxAge: "7d" }));

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/channels", channelRoutes);
app.use("/api/portal-admins", portalAdminRoutes);
app.use("/api/admin-types", adminTypeRoutes);
app.use("/api/superkandle", superkandleRoutes);
app.use("/api/momentum", momentumRoutes);

app.get("/health", (_req, res) => {
  const payload = {
    status: dbReady ? "ok" : "degraded",
    database: dbReady ? "connected" : "unavailable",
  };
  if (!dbReady && dbLastError) {
    payload.databaseError = dbLastError;
  }
  res.status(dbReady ? 200 : 503).json(payload);
});

app.get("/db-check", async (_req, res) => {
  try {
    const result = await testPostgresConnection();
    if (!result.ok) {
      logDbError("Database connection failed:", result.error);
      return res.status(500).json({
        connected: false,
        host: result.host,
        port: result.port,
        database: result.database,
        error: result.error?.message || "Connection failed",
        code: result.error?.code || null,
        name: result.error?.name || null,
      });
    }

    res.json({
      connected: true,
      serverTime: result.serverTime,
      database: result.database,
      host: result.host,
      port: result.port,
      elapsedMs: result.elapsedMs,
    });
  } catch (error) {
    logDbError("Database connection failed:", error);
    res.status(500).json({
      connected: false,
      error: error.message,
      code: error.code || null,
      name: error.name || null,
    });
  }
});

async function start() {
  try {
    await connectAndVerify();
    console.log("Initializing database schema...");
    await ensureAppSchema();
    console.log("Database schema initialized successfully");
    dbReady = true;
    dbLastError = null;

    try {
      const ping = await pool.query("SELECT NOW() AS now");
      dbServerTime = ping.rows[0]?.now || null;
    } catch {
      /* non-fatal */
    }
  } catch (error) {
    dbReady = false;
    dbLastError = error.message || String(error);
    if (!error.dbTest) {
      logDbError("Schema init / PostgreSQL startup failed", error);
    }
    console.error(
      "Server will start, but database-backed routes will fail until PostgreSQL is reachable."
    );
  }

  attachChannelRealtime(server);

  server.listen(PORT, () => {
    console.log(`WebSocket ready on /ws`);
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Health check:   http://localhost:${PORT}/health`);
    console.log(`WebSocket:      ws://localhost:${PORT}/ws`);
    if (dbReady) {
      console.log(`Database:       connected${dbServerTime ? ` (server time ${dbServerTime})` : ""}`);
    } else {
      console.error(`Database:       UNAVAILABLE (${dbLastError || "unknown error"})`);
    }
  });
}

start();

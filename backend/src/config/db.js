import pg from "pg";
import net from "net";
import dns from "dns/promises";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(
      `Missing PostgreSQL config. Set ${name} (and DB_HOST, DB_NAME, DB_USER, DB_PASSWORD) in .env`
    );
  }
  return value;
}

export const dbConfig = {
  host: requiredEnv("DB_HOST"),
  port: Number(process.env.DB_PORT) || 5432,
  database: requiredEnv("DB_NAME"),
  user: requiredEnv("DB_USER"),
  password: requiredEnv("DB_PASSWORD"),
};

const sslEnabled = String(process.env.DB_SSL || "true").toLowerCase() !== "false";

/**
 * Build pool/client options.
 * family: 4 avoids dual-stack stalls on Windows.
 * rejectUnauthorized: false is required for typical RDS cert chains in Node.
 */
export function createPgConfig(overrides = {}) {
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    // Force IPv4 — Windows/VPN dual-stack can hang the handshake
    family: 4,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 15_000,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30_000,
    max: Number(process.env.DB_POOL_MAX) || 10,
    ssl: sslEnabled
      ? {
          rejectUnauthorized: false,
        }
      : false,
    ...overrides,
  };
}

const pool = new Pool(createPgConfig());

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", {
    name: err.name,
    message: err.message,
    code: err.code,
  });
});

export const query = (text, params) => pool.query(text, params);

export const getClient = () => pool.connect();

export function formatDbTarget() {
  return {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    ssl: sslEnabled,
  };
}

export function logDbError(prefix, error) {
  console.error(prefix);
  console.error(`  Host:     ${dbConfig.host}`);
  console.error(`  Port:     ${dbConfig.port}`);
  console.error(`  Database: ${dbConfig.database}`);
  console.error(`  User:     ${dbConfig.user}`);
  console.error(`  SSL:      ${sslEnabled}`);
  console.error(`  Name:     ${error?.name || "Error"}`);
  console.error(`  Message:  ${error?.message || String(error)}`);
  console.error(`  Code:     ${error?.code || "(none)"}`);
  if (error?.message?.includes("timeout") || error?.code === "ETIMEDOUT") {
    console.error(
      "  Hint:     TCP may succeed while the Postgres handshake fails (VPN/firewall). Check ProTUN/VPN or try DB_SSL=false briefly for diagnosis."
    );
  }
}

/** Low-level TCP check (same class of signal as Test-NetConnection). */
export function testTcpPort({
  host = dbConfig.host,
  port = dbConfig.port,
  timeoutMs = 5_000,
} = {}) {
  return new Promise(async (resolve) => {
    let ip = host;
    try {
      const looked = await dns.lookup(host, { family: 4 });
      ip = looked.address;
    } catch (error) {
      resolve({
        ok: false,
        host,
        ip: null,
        port,
        error: error.message,
        elapsedMs: 0,
      });
      return;
    }

    const started = Date.now();
    const socket = net.connect({ host: ip, port, family: 4 }, () => {
      const elapsedMs = Date.now() - started;
      socket.end();
      resolve({ ok: true, host, ip, port, elapsedMs });
    });

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve({
        ok: false,
        host,
        ip,
        port,
        error: "TCP timeout",
        elapsedMs: Date.now() - started,
      });
    });

    socket.on("error", (error) => {
      resolve({
        ok: false,
        host,
        ip,
        port,
        error: error.message,
        elapsedMs: Date.now() - started,
      });
    });
  });
}

/**
 * Full Postgres auth + query test. Uses a one-off Client (not the pool)
 * so startup failures don't poison pool state.
 */
export async function testPostgresConnection() {
  const client = new pg.Client(createPgConfig());
  const started = Date.now();

  try {
    await client.connect();
    const result = await client.query("SELECT NOW() AS now, current_database() AS db");
    const elapsedMs = Date.now() - started;
    return {
      ok: true,
      elapsedMs,
      serverTime: result.rows[0]?.now,
      database: result.rows[0]?.db,
      ...formatDbTarget(),
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      error,
      ...formatDbTarget(),
    };
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Startup gate: TCP probe + SELECT NOW(), with clear logs.
 */
export async function connectAndVerify() {
  console.log("Connecting to PostgreSQL...");
  console.log(
    `  Target: ${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database} (ssl=${sslEnabled})`
  );

  const tcp = await testTcpPort();
  if (tcp.ok) {
    console.log(
      `  TCP reachability: OK (${tcp.ip}:${tcp.port} in ${tcp.elapsedMs}ms)`
    );
  } else {
    console.error(
      `  TCP reachability: FAILED (${tcp.ip || tcp.host}:${tcp.port}) — ${tcp.error}`
    );
  }

  const result = await testPostgresConnection();
  if (!result.ok) {
    logDbError("PostgreSQL connection failed", result.error);
    if (tcp.ok) {
      console.error(
        "  Diagnosis: TCP port 5432 is reachable, but the Postgres protocol/SSL handshake did not complete."
      );
      console.error(
        "  This is usually a VPN (e.g. ProTUN), TLS middlebox, or path that accepts SYN then drops Postgres bytes — not a missing Security Group rule."
      );
    }
    const err = result.error || new Error("PostgreSQL connection failed");
    err.dbTest = result;
    err.tcpTest = tcp;
    throw err;
  }

  console.log("PostgreSQL connection successful");
  console.log(`PostgreSQL server time: ${result.serverTime}`);
  console.log(`PostgreSQL database:    ${result.database}`);
  console.log(`PostgreSQL handshake:   ${result.elapsedMs}ms`);
  return result;
}

export default pool;

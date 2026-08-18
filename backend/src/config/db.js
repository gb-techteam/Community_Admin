import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

const { DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD } = process.env;

if (!DB_HOST || !DB_NAME || !DB_USER || !DB_PASSWORD) {
  throw new Error(
    "Missing PostgreSQL config. Set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD in .env"
  );
}

const pool = new Pool({
  host: DB_HOST,
  port: Number(DB_PORT) || 5432,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

export const query = (text, params) => pool.query(text, params);

export const getClient = () => pool.connect();

export default pool;

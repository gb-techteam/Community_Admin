import dotenv from "dotenv";
import pool from "../src/config/db.js";

dotenv.config();

try {
  const result = await pool.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY table_schema, table_name
  `);

  console.log("Connected OK");
  console.log("Tables found:", result.rows.length);
  console.log(JSON.stringify(result.rows, null, 2));
} catch (error) {
  console.error("Connection/query failed:", error.message);
} finally {
  await pool.end();
}

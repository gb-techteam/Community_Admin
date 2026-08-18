import pool from "../src/config/db.js";

const tables = [
  ["public", "students"],
  ["public", "courses"],
  ["public", "enrollments"],
  ["studentportal", "Student"],
  ["studentportal", "Course"],
  ["studentportal", "Batch"],
];

try {
  for (const [schema, table] of tables) {
    const cols = await pool.query(
      `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      `,
      [schema, table]
    );

    const count = await pool.query(
      `SELECT COUNT(*)::int AS count FROM "${schema}"."${table}"`
    );

    console.log(`\n=== ${schema}.${table} (${count.rows[0].count} rows) ===`);
    console.log(
      cols.rows
        .map((c) => `${c.column_name} (${c.data_type})`)
        .join("\n")
    );
  }
} catch (error) {
  console.error(error.message);
} finally {
  await pool.end();
}

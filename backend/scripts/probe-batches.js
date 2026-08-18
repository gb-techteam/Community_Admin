import pool from "../src/config/db.js";

try {
  const cols = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'batches'
    ORDER BY ordinal_position
  `);
  console.log("batches columns:", cols.rows);

  const sample = await pool.query(`SELECT * FROM batches ORDER BY id LIMIT 10`);
  console.log("batches sample:", sample.rows);

  const enrollCols = await pool.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enrollments'
    ORDER BY ordinal_position
  `);
  console.log("enrollments columns:", enrollCols.rows);

  const byBatch = await pool.query(`
    SELECT b.id, b.*, COUNT(e.id)::int AS enrollment_count
    FROM batches b
    LEFT JOIN enrollments e ON e.batch_id = b.id
    GROUP BY b.id
    ORDER BY b.id
  `);
  console.log("by batch:", byBatch.rows);

  const nullBatch = await pool.query(`
    SELECT COUNT(*)::int AS c FROM enrollments WHERE batch_id IS NULL
  `);
  console.log("enrollments without batch:", nullBatch.rows[0]);
} catch (e) {
  console.error(e.message);
} finally {
  await pool.end();
}

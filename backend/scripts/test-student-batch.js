import pool from "../src/config/db.js";

const result = await pool.query(`
  SELECT
    s.id,
    s.first_name,
    COALESCE(
      (
        SELECT STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name)
        FROM enrollments e
        JOIN batches b ON b.id = e.batch_id
        WHERE e.student_id = s.id
      ),
      ''
    ) AS batch_names
  FROM students s
  LIMIT 5
`);

console.log(result.rows);
await pool.end();

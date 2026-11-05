import pool from "../src/config/db.js";

const cons = await pool.query(`
  SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
  WHERE conrelid = 'public.enrollments'::regclass
`);
console.log("constraints", cons.rows);

const idx = await pool.query(`
  SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'enrollments'
`);
console.log("indexes", idx.rows);

const counts = await pool.query(`
  SELECT COUNT(*)::int AS students
  FROM students s
  WHERE NOT EXISTS (
    SELECT 1 FROM enrollments e
    JOIN batches b ON b.id = e.batch_id
    WHERE e.student_id = s.id
      AND b.name NOT ILIKE '%dont know%'
      AND b.name NOT ILIKE '%don''t know%'
  )
`);
console.log("students needing batch", counts.rows[0]);

const open = await pool.query(`
  SELECT COUNT(*) FILTER (WHERE is_open) AS open, COUNT(*) AS total FROM batches
`);
console.log("open batches", open.rows[0]);

await pool.end();

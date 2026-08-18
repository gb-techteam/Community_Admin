import pool from "../src/config/db.js";

try {
  const enrollmentStatuses = await pool.query(
    `SELECT status, COUNT(*)::int AS c FROM enrollments GROUP BY status ORDER BY c DESC`
  );
  const payment = await pool.query(
    `SELECT payment_status, COUNT(*)::int AS c FROM enrollments GROUP BY payment_status ORDER BY c DESC`
  );
  const recentStudents = await pool.query(
    `SELECT first_name, last_name, email, phone, created_at
     FROM students ORDER BY created_at DESC NULLS LAST LIMIT 5`
  );
  const recentEnrollments = await pool.query(
    `SELECT e.id, s.first_name, s.last_name, c.title, e.status, e.payment_status, e.enrolled_at, e.amount_paid
     FROM enrollments e
     LEFT JOIN students s ON s.id = e.student_id
     LEFT JOIN courses c ON c.id = e.course_id
     ORDER BY e.enrolled_at DESC NULLS LAST
     LIMIT 5`
  );
  const revenue = await pool.query(
    `SELECT COALESCE(SUM(amount_paid),0)::float AS paid, COALESCE(SUM(fees),0)::float AS fees FROM enrollments`
  );
  const thisMonth = await pool.query(
    `SELECT COUNT(*)::int AS c FROM students WHERE created_at >= date_trunc('month', NOW())`
  );
  const batches = await pool.query(`SELECT COUNT(*)::int AS c FROM batches`);

  console.log({
    enrollmentStatuses: enrollmentStatuses.rows,
    payment: payment.rows,
    recentStudents: recentStudents.rows,
    recentEnrollments: recentEnrollments.rows,
    revenue: revenue.rows[0],
    thisMonthStudents: thisMonth.rows[0],
    batches: batches.rows[0],
  });
} catch (e) {
  console.error(e.message);
} finally {
  await pool.end();
}

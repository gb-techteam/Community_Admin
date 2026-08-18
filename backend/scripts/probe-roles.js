import pool from "../src/config/db.js";

try {
  const tables = await pool.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND (
        table_name ILIKE '%admin%'
        OR table_name ILIKE '%role%'
        OR table_name ILIKE '%permission%'
        OR table_name ILIKE '%power%'
        OR table_name = 'users'
      )
    ORDER BY table_schema, table_name
  `);

  console.log("Related tables:");
  for (const row of tables.rows) {
    const cols = await pool.query(
      `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      `,
      [row.table_schema, row.table_name]
    );
    const count = await pool.query(
      `SELECT COUNT(*)::int AS c FROM "${row.table_schema}"."${row.table_name}"`
    );
    console.log(`\n=== ${row.table_schema}.${row.table_name} (${count.rows[0].c}) ===`);
    console.log(cols.rows.map((c) => `${c.column_name} (${c.data_type})`).join("\n"));
  }

  // sample users/admins if present
  try {
    const users = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users'
    `);
    if (users.rows.length) {
      const sample = await pool.query(`SELECT * FROM users LIMIT 2`);
      console.log("\npublic.users sample keys:", sample.rows[0] ? Object.keys(sample.rows[0]) : []);
      console.log(sample.rows.map((u) => {
        const copy = { ...u };
        for (const k of Object.keys(copy)) {
          if (/pass|token|secret/i.test(k)) copy[k] = "***";
        }
        return copy;
      }));
    }
  } catch (e) {
    console.log("users sample error:", e.message);
  }
} catch (e) {
  console.error(e.message);
} finally {
  await pool.end();
}

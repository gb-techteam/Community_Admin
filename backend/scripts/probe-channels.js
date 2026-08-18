import pool from "../src/config/db.js";

try {
  const tables = await pool.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND (
        table_name ILIKE '%channel%'
        OR table_name ILIKE '%message%'
        OR table_name ILIKE '%chat%'
      )
    ORDER BY table_schema, table_name
  `);
  console.log("related tables:", tables.rows);

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
    console.log(`\n${row.table_schema}.${row.table_name} (${count.rows[0].c})`);
    console.log(cols.rows);
  }
} catch (e) {
  console.error(e.message);
} finally {
  await pool.end();
}

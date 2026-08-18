import pool from "../config/db.js";

export async function getAdminTypeAndPowers(portalAdminId) {
  const result = await pool.query(
    `
    SELECT
      a.id,
      a.admin_id,
      a.name,
      a.email,
      a.is_active,
      a.admin_type,
      a.admin_type_id,
      t.name AS type_name,
      t.is_signal_only,
      COALESCE(
        ARRAY_REMOVE(ARRAY_AGG(p.power ORDER BY p.power), NULL),
        ARRAY[]::varchar[]
      ) AS powers
    FROM portal_admins a
    LEFT JOIN portal_admin_types t ON t.id = a.admin_type_id
    LEFT JOIN portal_admin_type_powers p ON p.admin_type_id = t.id
    WHERE a.id = $1
    GROUP BY a.id, t.id
    `,
    [portalAdminId]
  );

  return result.rows[0] || null;
}

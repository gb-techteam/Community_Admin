import express from "express";
import pool from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = express.Router();

router.use(requireAuth);

async function fetchMomentumTotals() {
  const base = String(
    process.env.TRADER_CONNECT_API_BASE ||
      "https://traderconnectapi.greenbondsacademy.com/api"
  ).replace(/\/$/, "");
  const apiKey =
    process.env.TRADER_CONNECT_API_KEY ||
    process.env.EXTERNAL_APP_API_KEY ||
    "";

  if (!apiKey) return null;

  try {
    const response = await fetch(`${base}/forCommunity/dashboard`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "x-external-api-key": apiKey,
      },
    });

    if (!response.ok) return null;
    const data = await response.json();
    const totals = data.totals || data;
    return {
      totalMomentumStudents: Number(totals.totalMomentumStudents) || 0,
      activeMomentumStudents: Number(totals.activeMomentumStudents) || 0,
      totalMentors: Number(totals.totalMentors) || 0,
      activeMentors: Number(totals.activeMentors) || 0,
      totalBatches: Number(totals.totalBatches) || 0,
      activeBatches: Number(totals.activeBatches) || 0,
      topTraders: Array.isArray(data.topProfitableStudents)
        ? data.topProfitableStudents.slice(0, 5)
        : [],
    };
  } catch (error) {
    console.error("Dashboard Momentum fetch failed:", error.message);
    return null;
  }
}

router.get("/stats", async (_req, res) => {
  try {
    const [
      students,
      courses,
      enrollments,
      activeCourses,
      batches,
      openBatches,
      activeBatches,
      studentsWithPhone,
      studentsWithTelegram,
      channels,
      activeChannels,
      channelMessages,
      channelMembers,
      channelAdmins,
      portalAdmins,
      activePortalAdmins,
      signalGivers,
      staffAdmins,
      adminTypes,
      paymentBreakdown,
      enrollmentStatus,
      recentStudents,
      recentEnrollments,
      courseBreakdown,
      recentChannels,
      recentAdmins,
      adminTypeBreakdown,
      recentBatches,
      skStats,
      skExpiring,
      skPlans,
      momentum,
    ] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM students"),
      pool.query("SELECT COUNT(*)::int AS count FROM courses"),
      pool.query("SELECT COUNT(*)::int AS count FROM enrollments"),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM courses WHERE LOWER(COALESCE(status, '')) = 'active'"
      ),
      pool.query("SELECT COUNT(*)::int AS count FROM batches"),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM batches WHERE is_open = TRUE"
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM batches WHERE LOWER(COALESCE(status, '')) = 'active'"
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM students WHERE phone IS NOT NULL AND TRIM(phone) <> ''"
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM students WHERE telegram_user IS NOT NULL AND TRIM(telegram_user) <> ''"
      ),
      pool.query("SELECT COUNT(*)::int AS count FROM channels"),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM channels WHERE LOWER(COALESCE(status, '')) = 'active'"
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM channel_messages WHERE deleted_at IS NULL"
      ),
      pool.query("SELECT COUNT(*)::int AS count FROM channel_members"),
      pool.query("SELECT COUNT(*)::int AS count FROM channel_admins"),
      pool.query("SELECT COUNT(*)::int AS count FROM portal_admins"),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM portal_admins WHERE is_active = TRUE"
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM portal_admins a
        LEFT JOIN portal_admin_types t ON t.id = a.admin_type_id
        WHERE COALESCE(t.is_signal_only, FALSE) = TRUE
           OR a.admin_type = 'signal_giver'
        `
      ),
      pool.query(
        `
        SELECT COUNT(*)::int AS count
        FROM portal_admins a
        LEFT JOIN portal_admin_types t ON t.id = a.admin_type_id
        WHERE COALESCE(t.is_signal_only, FALSE) = FALSE
          AND COALESCE(a.admin_type, 'staff') <> 'signal_giver'
        `
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM portal_admin_types WHERE is_active = TRUE"
      ),
      pool.query(`
        SELECT COALESCE(payment_status, 'unknown') AS label, COUNT(*)::int AS count
        FROM enrollments
        GROUP BY payment_status
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT COALESCE(status, 'unknown') AS label, COUNT(*)::int AS count
        FROM enrollments
        GROUP BY status
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT id, first_name, last_name, email, phone, created_at
        FROM students
        ORDER BY created_at DESC NULLS LAST, id DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT
          e.id,
          e.status,
          e.payment_status,
          e.enrolled_at,
          e.amount_paid,
          s.first_name,
          s.last_name,
          s.email,
          c.title AS course_title
        FROM enrollments e
        LEFT JOIN students s ON s.id = e.student_id
        LEFT JOIN courses c ON c.id = e.course_id
        ORDER BY e.enrolled_at DESC NULLS LAST, e.id DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT
          c.id,
          c.title,
          c.status,
          c.duration,
          c.price,
          COUNT(e.id)::int AS student_count
        FROM courses c
        LEFT JOIN enrollments e ON e.course_id = c.id
        GROUP BY c.id
        ORDER BY student_count DESC, c.title ASC
        LIMIT 6
      `),
      pool.query(`
        SELECT
          c.id,
          c.name,
          c.code,
          c.status,
          c.created_at,
          COALESCE(
            (SELECT COUNT(*)::int FROM channel_messages m WHERE m.channel_id = c.id AND m.deleted_at IS NULL),
            0
          ) AS message_count,
          COALESCE(
            (SELECT COUNT(*)::int FROM channel_members cm WHERE cm.channel_id = c.id),
            0
          ) AS member_count,
          COALESCE(
            (SELECT COUNT(*)::int FROM channel_admins ca WHERE ca.channel_id = c.id),
            0
          ) AS admin_count
        FROM channels c
        ORDER BY c.created_at DESC NULLS LAST, c.id DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT
          a.id,
          a.admin_id,
          a.name,
          a.admin_type,
          a.is_active,
          a.created_at,
          t.name AS type_name,
          t.is_signal_only,
          COALESCE(
            (
              SELECT ARRAY_AGG(p.power ORDER BY p.power)
              FROM portal_admin_type_powers p
              WHERE p.admin_type_id = a.admin_type_id
            ),
            ARRAY[]::varchar[]
          ) AS powers
        FROM portal_admins a
        LEFT JOIN portal_admin_types t ON t.id = a.admin_type_id
        ORDER BY a.created_at DESC NULLS LAST, a.id DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT
          COALESCE(t.name, COALESCE(a.admin_type, 'staff')) AS label,
          COUNT(*)::int AS count
        FROM portal_admins a
        LEFT JOIN portal_admin_types t ON t.id = a.admin_type_id
        GROUP BY COALESCE(t.name, COALESCE(a.admin_type, 'staff'))
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT
          b.id,
          b.name,
          b.status,
          b.is_open,
          b.start_date,
          b.end_date,
          c.title AS course_title,
          (
            SELECT COUNT(*)::int
            FROM enrollments e
            WHERE e.batch_id = b.id
          ) AS student_count
        FROM batches b
        LEFT JOIN courses c ON c.id = b.course_id
        ORDER BY b.created_at DESC NULLS LAST, b.id DESC
        LIMIT 6
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active,
          COUNT(*) FILTER (
            WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE
          )::int AS expired,
          COUNT(*) FILTER (WHERE payment_status = 'pending')::int AS pending_payments,
          COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid
        FROM superkandle_members
      `),
      pool.query(`
        SELECT COUNT(*)::int AS count
        FROM superkandle_members
        WHERE expires_at IS NOT NULL
          AND expires_at >= CURRENT_DATE
          AND expires_at <= CURRENT_DATE + INTERVAL '7 days'
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active
        FROM superkandle_plans
      `),
      fetchMomentumTotals(),
    ]);

    const sk = skStats.rows[0] || {};
    const plans = skPlans.rows[0] || {};

    res.json({
      success: true,
      stats: {
        students: students.rows[0].count,
        courses: courses.rows[0].count,
        enrollments: enrollments.rows[0].count,
        activeCourses: activeCourses.rows[0].count,
        batches: batches.rows[0].count,
        openBatches: openBatches.rows[0].count,
        activeBatches: activeBatches.rows[0].count,
        studentsWithPhone: studentsWithPhone.rows[0].count,
        studentsWithTelegram: studentsWithTelegram.rows[0].count,
        channels: channels.rows[0].count,
        activeChannels: activeChannels.rows[0].count,
        channelMessages: channelMessages.rows[0].count,
        channelMembers: channelMembers.rows[0].count,
        channelAdmins: channelAdmins.rows[0].count,
        portalAdmins: portalAdmins.rows[0].count,
        activePortalAdmins: activePortalAdmins.rows[0].count,
        signalGivers: signalGivers.rows[0].count,
        staffAdmins: staffAdmins.rows[0].count,
        adminTypes: adminTypes.rows[0].count,
        superkandleMembers: sk.total || 0,
        superkandleActive: sk.active || 0,
        superkandleExpired: sk.expired || 0,
        superkandleExpiring: skExpiring.rows[0]?.count || 0,
        superkandlePending: sk.pending_payments || 0,
        superkandlePaid: sk.paid || 0,
        superkandlePlans: plans.total || 0,
        superkandleActivePlans: plans.active || 0,
      },
      momentum,
      paymentBreakdown: paymentBreakdown.rows,
      enrollmentStatus: enrollmentStatus.rows,
      recentStudents: recentStudents.rows,
      recentEnrollments: recentEnrollments.rows,
      courseBreakdown: courseBreakdown.rows,
      recentChannels: recentChannels.rows,
      recentAdmins: recentAdmins.rows,
      adminTypeBreakdown: adminTypeBreakdown.rows,
      recentBatches: recentBatches.rows,
    });
  } catch (error) {
    console.error("Stats error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load stats" });
  }
});

export default router;

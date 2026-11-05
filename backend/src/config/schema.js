import pool from "./db.js";
import { ALL_POWER_KEYS } from "../constants/powers.js";

export async function ensureChannelSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(60) NOT NULL UNIQUE,
      description TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'active',
      is_admin_only BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_role VARCHAR(40),
      created_by_admin_id VARCHAR(80),
      created_by_name VARCHAR(150),
      created_by_portal_admin_id INTEGER REFERENCES portal_admins(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS created_by_role VARCHAR(40)
  `);
  await pool.query(`
    ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS created_by_admin_id VARCHAR(80)
  `);
  await pool.query(`
    ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(150)
  `);
  await pool.query(`
    ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS created_by_portal_admin_id INTEGER
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_messages (
      id SERIAL PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      title VARCHAR(200),
      body TEXT NOT NULL,
      sent_by VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS sent_by_portal_admin_id INTEGER
      REFERENCES portal_admins(id) ON DELETE SET NULL
  `);
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS sent_by_role VARCHAR(40)
  `);
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ
  `);
  // Soft delete so app clients that cached a message can reconcile it
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ
  `);

  // Media: store a relative URL (/uploads/...) so a CDN base can be prepended later
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS media_type VARCHAR(20)
  `);
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS media_url TEXT
  `);
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS media_mime VARCHAR(120)
  `);
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS media_size INTEGER
  `);
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS media_duration_ms INTEGER
  `);
  await pool.query(`
    ALTER TABLE channel_messages
    ADD COLUMN IF NOT EXISTS media_name VARCHAR(255)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_created
    ON channel_messages (channel_id, created_at DESC, id DESC)
  `);

  // Who has opened/read a broadcast message (students in the channel)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_message_reads (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES channel_messages(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (message_id, student_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_channel_message_reads_message
    ON channel_message_reads (message_id, seen_at DESC)
  `);

  // Portal / super admins who opened a message in the channel thread
  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_message_admin_reads (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES channel_messages(id) ON DELETE CASCADE,
      portal_admin_id INTEGER REFERENCES portal_admins(id) ON DELETE CASCADE,
      super_admin_id INTEGER,
      seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT channel_message_admin_reads_viewer_chk CHECK (
        (portal_admin_id IS NOT NULL AND super_admin_id IS NULL)
        OR (portal_admin_id IS NULL AND super_admin_id IS NOT NULL)
      )
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_message_admin_reads_portal
    ON channel_message_admin_reads (message_id, portal_admin_id)
    WHERE portal_admin_id IS NOT NULL
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_message_admin_reads_super
    ON channel_message_admin_reads (message_id, super_admin_id)
    WHERE super_admin_id IS NOT NULL
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_channel_message_admin_reads_message
    ON channel_message_admin_reads (message_id, seen_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_members (
      id SERIAL PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (channel_id, student_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_channel_members_student
    ON channel_members (student_id)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channel_admins (
      id SERIAL PRIMARY KEY,
      channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      portal_admin_id INTEGER NOT NULL REFERENCES portal_admins(id) ON DELETE CASCADE,
      role VARCHAR(30) NOT NULL DEFAULT 'admin',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (channel_id, portal_admin_id)
    );
  `);
}

async function seedAndMigrateAdminTypes() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_admin_types (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL UNIQUE,
      description TEXT,
      is_signal_only BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_admin_type_powers (
      id SERIAL PRIMARY KEY,
      admin_type_id INTEGER NOT NULL REFERENCES portal_admin_types(id) ON DELETE CASCADE,
      power VARCHAR(80) NOT NULL,
      UNIQUE (admin_type_id, power)
    );
  `);

  await pool.query(`
    ALTER TABLE portal_admins
    ADD COLUMN IF NOT EXISTS admin_type_id INTEGER
  `);

  const existingTypes = await pool.query(
    "SELECT COUNT(*)::int AS count FROM portal_admin_types"
  );

  if (existingTypes.rows[0].count === 0) {
    const staff = await pool.query(
      `
      INSERT INTO portal_admin_types (name, description, is_signal_only, is_active)
      VALUES ($1, $2, FALSE, TRUE)
      RETURNING id
      `,
      [
        "Portal staff",
        "Normal portal admin with management powers",
      ]
    );

    const signal = await pool.query(
      `
      INSERT INTO portal_admin_types (name, description, is_signal_only, is_active)
      VALUES ($1, $2, TRUE, TRUE)
      RETURNING id
      `,
      [
        "Signal giver",
        "App-only account for signal giving",
      ]
    );

    const staffId = staff.rows[0].id;
    const signalId = signal.rows[0].id;

    // Seed staff powers from existing per-admin powers (unique set)
    const oldPowers = await pool.query(`
      SELECT DISTINCT p.power
      FROM portal_admin_powers p
      JOIN portal_admins a ON a.id = p.portal_admin_id
      WHERE COALESCE(a.admin_type, 'staff') <> 'signal_giver'
    `);

    const staffPowers = oldPowers.rows
      .map((row) => row.power)
      .filter((power) => ALL_POWER_KEYS.includes(power) && power !== "give_signals");

    const defaultStaffPowers = staffPowers.length
      ? staffPowers
      : [
          "manage_students",
          "manage_courses",
          "manage_batches",
          "manage_channels",
          "view_channel_people",
          "message_channels",
        ];

    for (const power of defaultStaffPowers) {
      await pool.query(
        `
        INSERT INTO portal_admin_type_powers (admin_type_id, power)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        `,
        [staffId, power]
      );
    }

    await pool.query(
      `
      INSERT INTO portal_admin_type_powers (admin_type_id, power)
      VALUES ($1, 'give_signals')
      ON CONFLICT DO NOTHING
      `,
      [signalId]
    );

    await pool.query(
      `
      UPDATE portal_admins
      SET admin_type_id = $1
      WHERE COALESCE(admin_type, 'staff') = 'signal_giver'
        AND admin_type_id IS NULL
      `,
      [signalId]
    );

    await pool.query(
      `
      UPDATE portal_admins
      SET admin_type_id = $1
      WHERE COALESCE(admin_type, 'staff') <> 'signal_giver'
        AND admin_type_id IS NULL
      `,
      [staffId]
    );
  } else {
    // Ensure any admins without type get a fallback
    const staffType = await pool.query(
      `
      SELECT id
      FROM portal_admin_types
      WHERE is_signal_only = FALSE
      ORDER BY id ASC
      LIMIT 1
      `
    );
    const signalType = await pool.query(
      `
      SELECT id
      FROM portal_admin_types
      WHERE is_signal_only = TRUE
      ORDER BY id ASC
      LIMIT 1
      `
    );

    if (signalType.rows[0]) {
      await pool.query(
        `
        UPDATE portal_admins
        SET admin_type_id = $1
        WHERE admin_type_id IS NULL
          AND COALESCE(admin_type, 'staff') = 'signal_giver'
        `,
        [signalType.rows[0].id]
      );
    }

    if (staffType.rows[0]) {
      await pool.query(
        `
        UPDATE portal_admins
        SET admin_type_id = $1
        WHERE admin_type_id IS NULL
        `,
        [staffType.rows[0].id]
      );
    }
  }
}

export async function ensurePortalAdminSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_admins (
      id SERIAL PRIMARY KEY,
      admin_id VARCHAR(80) NOT NULL UNIQUE,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(180),
      password_hash TEXT NOT NULL,
      admin_type VARCHAR(30) NOT NULL DEFAULT 'staff',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE portal_admins
    ADD COLUMN IF NOT EXISTS admin_type VARCHAR(30) NOT NULL DEFAULT 'staff'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_admin_powers (
      id SERIAL PRIMARY KEY,
      portal_admin_id INTEGER NOT NULL REFERENCES portal_admins(id) ON DELETE CASCADE,
      power VARCHAR(80) NOT NULL,
      UNIQUE (portal_admin_id, power)
    );
  `);

  await seedAndMigrateAdminTypes();
}

export async function ensureSuperkandleSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS superkandle_plans (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      amount NUMERIC(10, 2) NOT NULL,
      offer_price NUMERIC(10, 2),
      duration_value INTEGER NOT NULL DEFAULT 1,
      duration_unit VARCHAR(10) NOT NULL DEFAULT 'month',
      duration_months INTEGER NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_trial BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE superkandle_plans
    ADD COLUMN IF NOT EXISTS duration_value INTEGER
  `);
  await pool.query(`
    ALTER TABLE superkandle_plans
    ADD COLUMN IF NOT EXISTS duration_unit VARCHAR(10) DEFAULT 'month'
  `);
  await pool.query(`
    ALTER TABLE superkandle_plans
    ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT FALSE
  `);

  // Migrate legacy duration_months → duration_value / duration_unit
  await pool.query(`
    UPDATE superkandle_plans
    SET
      duration_value = COALESCE(duration_value, duration_months, 1),
      duration_unit = COALESCE(NULLIF(duration_unit, ''), 'month')
    WHERE duration_value IS NULL
       OR duration_unit IS NULL
       OR TRIM(duration_unit) = ''
  `);

  await pool.query(`
    ALTER TABLE superkandle_plans
    ALTER COLUMN duration_value SET DEFAULT 1
  `);
  await pool.query(`
    ALTER TABLE superkandle_plans
    ALTER COLUMN duration_unit SET DEFAULT 'month'
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS superkandle_members (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES superkandle_plans(id) ON DELETE SET NULL,
      amount NUMERIC(10, 2) NOT NULL DEFAULT 8,
      payment_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      payment_date DATE,
      payment_method VARCHAR(80),
      payment_note TEXT,
      expires_at DATE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE superkandle_members
    ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES superkandle_plans(id) ON DELETE SET NULL
  `);

  await pool.query(`
    ALTER TABLE superkandle_members
    ADD COLUMN IF NOT EXISTS access_shared BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE superkandle_members
    ADD COLUMN IF NOT EXISTS access_shared_at TIMESTAMPTZ
  `);
  await pool.query(`
    ALTER TABLE superkandle_members
    ADD COLUMN IF NOT EXISTS access_error BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await pool.query(`
    ALTER TABLE superkandle_members
    ADD COLUMN IF NOT EXISTS access_error_message TEXT NOT NULL DEFAULT ''
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_superkandle_members_expires_at
    ON superkandle_members (expires_at)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_superkandle_members_payment_status
    ON superkandle_members (payment_status)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS superkandle_trial_claims (
      student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS superkandle_student_otps (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_superkandle_student_otps_email
    ON superkandle_student_otps (email, created_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS superkandle_payments (
      id SERIAL PRIMARY KEY,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES superkandle_plans(id) ON DELETE SET NULL,
      amount NUMERIC(10, 2) NOT NULL,
      network VARCHAR(20) NOT NULL DEFAULT 'BEP20',
      token VARCHAR(20) NOT NULL DEFAULT 'USDT',
      wallet_to VARCHAR(80),
      tx_hash VARCHAR(80),
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    ALTER TABLE superkandle_payments
    ALTER COLUMN amount TYPE NUMERIC(20, 8)
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_superkandle_payments_tx_hash
    ON superkandle_payments (tx_hash)
    WHERE tx_hash IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS superkandle_expiry_notices (
      id SERIAL PRIMARY KEY,
      member_id INTEGER NOT NULL REFERENCES superkandle_members(id) ON DELETE CASCADE,
      expires_at DATE NOT NULL,
      notice_type VARCHAR(20) NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (member_id, expires_at, notice_type)
    )
  `);

  const planCount = await pool.query(
    "SELECT COUNT(*)::int AS count FROM superkandle_plans"
  );

  if (planCount.rows[0].count === 0) {
    await pool.query(
      `
      INSERT INTO superkandle_plans
        (name, amount, offer_price, duration_value, duration_unit, duration_months, is_active, is_default, is_trial)
      VALUES
        ($1, $2, NULL, 1, 'month', 1, TRUE, TRUE, FALSE),
        ($3, $4, NULL, 1, 'month', 1, TRUE, FALSE, TRUE)
      `,
      ["Monthly", 8, "1 Month Free Trial", 0]
    );
  }

  // Ensure free trial plan exists even on older databases
  await pool.query(
    `
    INSERT INTO superkandle_plans
      (name, amount, offer_price, duration_value, duration_unit, duration_months, is_active, is_default, is_trial)
    SELECT
      '1 Month Free Trial', 0, NULL, 1, 'month', 1, TRUE, FALSE, TRUE
    WHERE NOT EXISTS (
      SELECT 1 FROM superkandle_plans WHERE is_trial = TRUE
    )
    `
  );

  await pool.query(`
    UPDATE superkandle_members m
    SET plan_id = p.id
    FROM superkandle_plans p
    WHERE m.plan_id IS NULL
      AND p.is_default = TRUE
  `);

  await pool.query(`
    INSERT INTO portal_admin_type_powers (admin_type_id, power)
    SELECT t.id, 'manage_superkandle'
    FROM portal_admin_types t
    WHERE t.name = 'Portal staff'
      AND t.is_signal_only = FALSE
    ON CONFLICT DO NOTHING
  `);

  // Types that can manage channels also get view people by default (can revoke later)
  await pool.query(`
    INSERT INTO portal_admin_type_powers (admin_type_id, power)
    SELECT DISTINCT admin_type_id, 'view_channel_people'
    FROM portal_admin_type_powers
    WHERE power = 'manage_channels'
    ON CONFLICT DO NOTHING
  `);

  await pool.query(`
    INSERT INTO portal_admin_type_powers (admin_type_id, power)
    SELECT t.id, 'manage_momentum'
    FROM portal_admin_types t
    WHERE t.name = 'Portal staff'
      AND t.is_signal_only = FALSE
    ON CONFLICT DO NOTHING
  `);
}

export async function ensurePortalSettingsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portal_settings (
      key VARCHAR(80) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function ensureAppSchema() {
  await ensurePortalAdminSchema();
  await ensureChannelSchema();
  await ensureSuperkandleSchema();
  await ensurePortalSettingsSchema();
}

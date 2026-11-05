import pool from "../config/db.js";

const KEYS = {
  usdtBep20Wallet: "usdt_bep20_wallet",
  bscRpcUrl: "bsc_rpc_url",
  publicAppUrl: "public_app_url",
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpUser: "smtp_user",
  smtpPass: "smtp_pass",
  smtpFrom: "smtp_from",
  expiryNoticeDays: "expiry_notice_days",
  displayPricedPlans: "display_priced_plans",
};

let cache = null;

function pick(db, key, envValue = "") {
  const stored = db[KEYS[key]];
  if (stored != null && String(stored).trim() !== "") return String(stored);
  return String(envValue || "");
}

function parseFlag(value, fallback = true) {
  if (value == null || String(value).trim() === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function invalidateSettingsCache() {
  cache = null;
}

export async function loadSettings() {
  if (cache && !("displayPricedPlans" in cache)) cache = null;
  if (cache) return cache;

  const result = await pool.query("SELECT key, value FROM portal_settings");
  const db = Object.fromEntries(
    result.rows.map((row) => [row.key, row.value ?? ""])
  );

  const expiry = Number(
    pick(db, "expiryNoticeDays", "7") || process.env.EXPIRY_NOTICE_DAYS || 7
  );

  cache = {
    usdtBep20Wallet: pick(db, "usdtBep20Wallet", process.env.USDT_BEP20_WALLET)
      .trim()
      .toLowerCase(),
    bscRpcUrl:
      pick(db, "bscRpcUrl", process.env.BSC_RPC_URL).trim() ||
      "https://bsc-dataseed.binance.org",
    publicAppUrl:
      pick(db, "publicAppUrl", process.env.PUBLIC_APP_URL).trim() ||
      "http://localhost:5174",
    smtpHost: pick(db, "smtpHost", process.env.SMTP_HOST).trim(),
    smtpPort: pick(db, "smtpPort", process.env.SMTP_PORT || "587").trim(),
    smtpUser: pick(db, "smtpUser", process.env.SMTP_USER).trim(),
    smtpPass: pick(db, "smtpPass", process.env.SMTP_PASS),
    smtpFrom: pick(db, "smtpFrom", process.env.SMTP_FROM).trim(),
    expiryNoticeDays:
      Number.isFinite(expiry) && expiry >= 1 && expiry <= 30
        ? Math.round(expiry)
        : 7,
    displayPricedPlans: parseFlag(db[KEYS.displayPricedPlans], true),
  };

  return cache;
}

export function publicSettings(settings) {
  return {
    usdtBep20Wallet: settings.usdtBep20Wallet,
    displayPricedPlans: settings.displayPricedPlans !== false,
    bscRpcUrl: settings.bscRpcUrl,
    publicAppUrl: settings.publicAppUrl,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpFrom: settings.smtpFrom || settings.smtpUser,
    smtpConfigured: Boolean(
      settings.smtpHost && settings.smtpUser && settings.smtpPass
    ),
    smtpPassSet: Boolean(settings.smtpPass),
    expiryNoticeDays: settings.expiryNoticeDays,
    subscribeUrl: settings.publicAppUrl,
  };
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current };

  if (patch.usdtBep20Wallet != null) {
    next.usdtBep20Wallet = String(patch.usdtBep20Wallet).trim().toLowerCase();
  }
  if (patch.bscRpcUrl != null) {
    next.bscRpcUrl = String(patch.bscRpcUrl).trim();
  }
  if (patch.publicAppUrl != null) {
    next.publicAppUrl = String(patch.publicAppUrl).trim().replace(/\/$/, "");
  }
  if (patch.smtpHost != null) next.smtpHost = String(patch.smtpHost).trim();
  if (patch.smtpPort != null) next.smtpPort = String(patch.smtpPort).trim();
  if (patch.smtpUser != null) next.smtpUser = String(patch.smtpUser).trim();
  if (patch.smtpFrom != null) next.smtpFrom = String(patch.smtpFrom).trim();
  if (patch.smtpPass != null && String(patch.smtpPass).trim() !== "") {
    next.smtpPass = String(patch.smtpPass);
  }
  if (patch.expiryNoticeDays != null) {
    const days = Number(patch.expiryNoticeDays);
    if (Number.isFinite(days) && days >= 1 && days <= 30) {
      next.expiryNoticeDays = Math.round(days);
    }
  }
  if (patch.displayPricedPlans != null) {
    next.displayPricedPlans = parseFlag(
      patch.displayPricedPlans,
      next.displayPricedPlans
    );
  }

  const rows = [
    [KEYS.usdtBep20Wallet, next.usdtBep20Wallet],
    [KEYS.bscRpcUrl, next.bscRpcUrl],
    [KEYS.publicAppUrl, next.publicAppUrl],
    [KEYS.smtpHost, next.smtpHost],
    [KEYS.smtpPort, next.smtpPort],
    [KEYS.smtpUser, next.smtpUser],
    [KEYS.smtpPass, next.smtpPass],
    [KEYS.smtpFrom, next.smtpFrom],
    [KEYS.expiryNoticeDays, String(next.expiryNoticeDays)],
    [KEYS.displayPricedPlans, next.displayPricedPlans ? "true" : "false"],
  ];

  for (const [key, value] of rows) {
    await pool.query(
      `
      INSERT INTO portal_settings (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `,
      [key, value ?? ""]
    );
  }

  invalidateSettingsCache();
  return loadSettings();
}

export function isBep20Address(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || "").trim());
}

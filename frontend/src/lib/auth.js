export const PORTAL_POWERS = [
  {
    key: "give_signals",
    label: "Give signals",
    description: "Main signal authority — send trading signals in the app",
  },
  {
    key: "create_admins",
    label: "Create other admins",
    description: "Create and manage portal staff and signal giver accounts",
  },
  {
    key: "manage_students",
    label: "Manage students",
    description: "View and update students (CRM handles create/delete)",
  },
  {
    key: "manage_courses",
    label: "Manage courses",
    description: "View and update courses (CRM handles create/delete)",
  },
  {
    key: "manage_batches",
    label: "Manage batches",
    description: "View and update batches (CRM handles create/delete)",
  },
  {
    key: "manage_channels",
    label: "Manage channels",
    description: "Create, edit, and delete channels",
  },
  {
    key: "view_channel_people",
    label: "View channel people",
    description: "See member names and details inside channels",
  },
  {
    key: "message_channels",
    label: "Message channels",
    description: "Send messages to channels",
  },
  {
    key: "manage_superkandle",
    label: "Manage Superkandle",
    description: "Manage Superkandle tool members, payments, and expiry",
  },
  {
    key: "manage_momentum",
    label: "Manage Momentum",
    description: "View Momentum membership via TraderConnect",
  },
];

export function getAdmin() {
  try {
    return JSON.parse(localStorage.getItem("admin_user") || "null");
  } catch {
    return null;
  }
}

export function setAdmin(admin) {
  localStorage.setItem("admin_user", JSON.stringify(admin));
}

function powersKey(admin) {
  return [...(admin?.powers || [])].sort().join(",");
}

// Powers can change while a session is open, so pull the current ones and
// report whether anything actually moved.
export async function refreshAdmin() {
  const response = await fetch("/api/auth/me", {
    headers: { Authorization: `Bearer ${localStorage.getItem("admin_token")}` },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success || !data.admin) return false;

  const previous = getAdmin();
  setAdmin(data.admin);

  return (
    powersKey(previous) !== powersKey(data.admin) ||
    previous?.adminTypeId !== data.admin.adminTypeId
  );
}

export function isSuperAdmin(admin = getAdmin()) {
  return admin?.role === "super_admin";
}

export function isSignalGiver(admin = getAdmin()) {
  return Boolean(admin?.isSignalOnly) || admin?.adminType === "signal_giver";
}

export function hasPower(power, admin = getAdmin()) {
  if (!admin) return false;
  if (isSuperAdmin(admin)) return true;
  return Array.isArray(admin.powers) && admin.powers.includes(power);
}

export function hasAnyPower(powers = [], admin = getAdmin()) {
  return powers.some((power) => hasPower(power, admin));
}

export function powerLabel(key) {
  return PORTAL_POWERS.find((power) => power.key === key)?.label || key;
}

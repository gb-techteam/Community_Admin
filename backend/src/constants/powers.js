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

export const ALL_POWER_KEYS = PORTAL_POWERS.map((power) => power.key);

export function isSuperAdmin(admin) {
  return admin?.role === "super_admin";
}

export function hasPower(admin, power) {
  if (!admin) return false;
  if (isSuperAdmin(admin)) return true;
  return Array.isArray(admin.powers) && admin.powers.includes(power);
}

export function normalizeTypePowers(powers, isSignalOnly, actor, existingPowers = []) {
  if (isSignalOnly) {
    return ["give_signals"];
  }

  let list = Array.isArray(powers)
    ? [...new Set(powers.filter((power) => ALL_POWER_KEYS.includes(power)))]
    : [];

  list = list.filter((power) => power !== "give_signals" || !isSignalOnly);

  if (!isSuperAdmin(actor)) {
    list = list.filter((power) => power !== "create_admins");
    if (existingPowers.includes("create_admins")) {
      list.push("create_admins");
    }
  }

  return list;
}

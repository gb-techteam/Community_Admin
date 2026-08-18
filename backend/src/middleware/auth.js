import jwt from "jsonwebtoken";
import { hasPower, isSuperAdmin } from "../constants/powers.js";
import { getAdminTypeAndPowers } from "../services/portalAdmins.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  let payload;

  try {
    payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }

  if (payload.role === "super_admin") {
    req.admin = payload;
    return next();
  }

  // Powers live on the admin type, so read them fresh instead of trusting the
  // token snapshot — changes then apply without forcing a re-login.
  try {
    const current = await getAdminTypeAndPowers(payload.portalAdminId);

    if (!current || !current.is_active) {
      return res.status(401).json({
        success: false,
        message: "Admin account not found or disabled",
      });
    }

    req.admin = {
      ...payload,
      name: current.name,
      adminTypeId: current.admin_type_id,
      adminTypeName: current.type_name,
      isSignalOnly:
        Boolean(current.is_signal_only) || current.admin_type === "signal_giver",
      powers: current.powers || [],
    };

    return next();
  } catch (error) {
    console.error("Auth power lookup error:", error.message);
    // DB down — use powers from the JWT so non-DB routes (e.g. Momentum) still work
    req.admin = {
      ...payload,
      powers: Array.isArray(payload.powers) ? payload.powers : [],
      authDegraded: true,
    };
    return next();
  }
}

export function requireSuperAdmin(req, res, next) {
  if (!isSuperAdmin(req.admin)) {
    return res.status(403).json({
      success: false,
      message: "Only super admin can access this",
    });
  }
  next();
}

export function requirePower(power) {
  return (req, res, next) => {
    if (!hasPower(req.admin, power)) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission for this action",
      });
    }
    next();
  };
}

export function requireAnyPower(...powers) {
  return (req, res, next) => {
    if (
      isSuperAdmin(req.admin) ||
      powers.some((power) => hasPower(req.admin, power))
    ) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "You do not have permission for this action",
    });
  };
}

import { Navigate } from "react-router-dom";
import { hasAnyPower, isSuperAdmin } from "../lib/auth";

export default function PowerRoute({
  children,
  powers = [],
  superOnly = false,
}) {
  const token = localStorage.getItem("admin_token");

  if (!token) {
    return <Navigate to="/" replace />;
  }

  if (superOnly && !isSuperAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }

  if (powers.length && !hasAnyPower(powers) && !isSuperAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

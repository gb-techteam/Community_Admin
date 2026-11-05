import jwt from "jsonwebtoken";

export function requireStudent(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    if (payload.role !== "student" || !payload.studentId) {
      return res.status(401).json({
        success: false,
        message: "Student verification required",
      });
    }
    req.student = payload;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired verification. Start again.",
    });
  }
}

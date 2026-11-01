const jwt = require("jsonwebtoken");

const protect = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Not authorized. No token." });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired token." });
  }
};

const allowSelfOrAdmin = (req, res, next) => {
  const isAdmin = req.user?.role === "admin";

  const isOwner =
    req.user?.role === "household" &&
    String(req.user.id) === String(req.params.id);

  if (!isAdmin && !isOwner) {
    return res.status(403).json({
      success: false,
      message: "Access denied. You can only access your own household account.",
    });
  }

  next();
};

const allowRoles = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  next();
};

module.exports = { protect, allowRoles, allowSelfOrAdmin };
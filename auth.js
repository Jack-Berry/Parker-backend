// auth.js
// CommonJS auth router — multi-property aware with database-backed users
// -----------------------------------------------------------------------------------
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Import database connection
const { pool } = require("./db");

if (!JWT_SECRET) {
  // Keep fast-fail to avoid issuing unsigned tokens
  throw new Error("Missing JWT_SECRET in environment");
}

// Helper to hash new passwords (useful for scripts/tools)
const hashPassword = async (password) => {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
};

// -----------------------------------------------------------------------------------
// Multi-property helpers
// -----------------------------------------------------------------------------------

/**
 * Factory that returns a middleware validating req.params.propertyId
 * against a provided allowlist (array of strings).
 *
 * Usage in server.js (optional, non-breaking):
 *   const { ensureProperty } = require("./auth");
 *   const VALID_PROPERTIES = ["preswylfa", "piddle-inn"];
 *   app.get("/api/events/:propertyId",
 *     ensureProperty(VALID_PROPERTIES),
 *     handler
 *   );
 */
const ensureProperty = (validProperties = []) => {
  // Defensive copy to avoid accidental external mutation
  const allow = Array.isArray(validProperties) ? [...validProperties] : [];
  return (req, res, next) => {
    const pid = req.params?.propertyId;
    if (!pid || !allow.includes(pid)) {
      return res.status(400).json({ error: `Unknown property: ${pid || "—"}` });
    }
    // Attach for downstream handlers if they want it
    req.propertyId = pid;
    next();
  };
};

// -----------------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------------

/**
 * POST /login
 * Body: { username, password }
 *
 * - Returns { token, propertyId, displayName }
 * - propertyId is automatically assigned based on the user's account
 * - Queries database for user credentials
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};

    // Strict basic validation, but keep generic error to avoid username probing
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    // Query database for user
    const [rows] = await pool.query(
      "SELECT id, username, password, property_id, display_name FROM admin_users WHERE username = ? LIMIT 1",
      [username],
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Use the propertyId assigned to this user account
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        propertyId: user.property_id,
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    // Return property info so frontend knows which property they're managing
    return res.json({
      token,
      propertyId: user.property_id,
      displayName: user.display_name,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Middleware: authenticateToken
 * - Accepts "Authorization: Bearer <token>"
 * - On success, attaches decoded payload to req.user
 * - Unchanged export name/signature vs your original file
 */
const authenticateToken = (req, res, next) => {
  // Header can be 'authorization' or 'Authorization' depending on client
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const token =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

  if (!token) return res.status(401).json({ error: "Access denied" });

  jwt.verify(token, JWT_SECRET, (err, payload) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    // payload: { id, username, propertyId, iat, exp }
    req.user = payload;
    next();
  });
};

/**
 * Middleware: requirePropertyAccess
 * - Must be used AFTER authenticateToken
 * - Ensures the user's propertyId matches the :propertyId param (if present)
 * - If no :propertyId param, uses the user's assigned propertyId
 * - Prevents users from accessing other properties' data
 */
const requirePropertyAccess = (req, res, next) => {
  if (!req.user || !req.user.propertyId) {
    return res
      .status(403)
      .json({ error: "No property assigned to this account" });
  }

  // If route has :propertyId param, verify it matches user's property
  const requestedPropertyId = req.params.propertyId;
  if (requestedPropertyId && requestedPropertyId !== req.user.propertyId) {
    return res.status(403).json({
      error: "Access denied",
      message: "You don't have permission to access this property",
    });
  }

  // Set the propertyId param to ensure it's always present for downstream handlers
  req.params.propertyId = req.user.propertyId;
  next();
};

module.exports = {
  router,
  authenticateToken,
  requirePropertyAccess,
  hashPassword,
  ensureProperty,
};

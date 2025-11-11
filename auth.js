// auth.js
// CommonJS auth router — multi-property aware (non-breaking), same admin + responses
// -----------------------------------------------------------------------------------
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  // Keep fast-fail to avoid issuing unsigned tokens
  throw new Error("Missing JWT_SECRET in environment");
}

// -----------------------------------------------------------------------------------
// Unchanged mocked admin user (same bcrypt hash as your original file).            //
// You can later swap this for env-driven or DB-driven credentials without          //
// changing the public API of the routes below.                                     //
// -----------------------------------------------------------------------------------
const users = [
  {
    id: 1,
    username: "admin",
    // same hash you already had
    password: "$2b$10$gHmamOyvsBKmM21nwHKLqelt0ehLjQuWCQLzCLF9lpzYVM453CoTO",
  },
];

// Helper to hash new passwords (unchanged API; useful for local tooling/scripts)
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
 * Body: { username, password, propertyId? }
 *
 * - Keeps your original response shape: { token }
 * - If propertyId is sent, it is embedded into the JWT payload so the
 *   frontend/backend can read which property context the user selected.
 * - If omitted, token still works (propertyId will be undefined).
 */
router.post("/login", async (req, res) => {
  try {
    const { username, password, propertyId } = req.body || {};

    // Strict basic validation, but keep generic error to avoid username probing
    if (typeof username !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Invalid username or password" });
    }

    const user = users.find((u) => u.username === username);
    if (!user) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Note: propertyId is optional; we just pass it through if provided.
    const token = jwt.sign(
      { id: user.id, username: user.username, propertyId },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // Keep original response contract: { token }
    return res.json({ token });
  } catch (err) {
    console.error("Error verifying password:", err);
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
    // payload: { id, username, propertyId?, iat, exp }
    req.user = payload;
    next();
  });
};

module.exports = { router, authenticateToken, hashPassword, ensureProperty };

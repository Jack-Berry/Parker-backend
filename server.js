require("dotenv").config();

console.log("=== ENV CHECK ===");
console.log("PIDDLE_READ_CAL exists?", !!process.env.PIDDLE_READ_CAL);
console.log("PIDDLE_READ_CAL value:", process.env.PIDDLE_READ_CAL);
console.log(
  "PIDDLE_SERVICE_ACCOUNT_EMAIL:",
  process.env.PIDDLE_SERVICE_ACCOUNT_EMAIL,
);
console.log("================");

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");

const { router: authRoutes } = require("./auth");

// Import route modules
const eventsRouter = require("./routes/events");
const pricingRouter = require("./routes/pricing");
const bookingsRouter = require("./routes/bookings");
const contactRouter = require("./routes/contact");

// Import config for debug endpoint
const {
  PROPERTY_CALENDARS,
  SERVICE_ACCOUNT_CONFIG,
} = require("./config/properties");

// Boot diagnostics
console.log("[BOOT] CWD:", process.cwd());
console.log("[BOOT] Entry file:", __filename);
console.log("[BOOT] NODE_ENV:", process.env.NODE_ENV || "(not set)");

const app = express();

// ---------------------------------------
// CORS configuration
// ---------------------------------------
const allowlist = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || allowlist.length === 0 || allowlist.includes(origin)) {
      return cb(null, true);
    }
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
};
app.use(cors(corsOptions));

// ---------------------------------------
// Body parsing
// ---------------------------------------
app.use(bodyParser.json());

// ---------------------------------------
// Mount routes
// ---------------------------------------
app.use("/api", authRoutes);
app.use("/api", eventsRouter);
app.use("/api", pricingRouter);
app.use("/api", bookingsRouter);
app.use("/api", contactRouter);

// ---------------------------------------
// Debug endpoint (optional, can remove in production)
// ---------------------------------------
app.get("/api/debug/config/:propertyId", (req, res) => {
  const propertyId = req.params.propertyId;
  const cfg = PROPERTY_CALENDARS[propertyId];
  res.json({
    propertyId,
    readCalendarId: cfg?.readCalendarId,
    writeCalendarId: cfg?.writeCalendarId,
    serviceAccountEmail: SERVICE_ACCOUNT_CONFIG[propertyId]?.email,
    hasPrivateKey: Boolean(SERVICE_ACCOUNT_CONFIG[propertyId]?.key),
    origin: req.headers.origin,
    userAgent: req.headers["user-agent"],
  });
});

// ---------------------------------------
// Start server
// ---------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

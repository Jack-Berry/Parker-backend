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
const superagent = require("superagent");
const { google } = require("googleapis");

const { pool } = require("./db"); // shared mysql2/promise pool
const { sendEmail } = require("./emailService"); // centralized email helper
const {
  router: authRoutes,
  authenticateToken,
  requirePropertyAccess,
} = require("./auth"); // auth router + middleware

// Put this near the top of server.js, after the requires but before you use it

function getTimestamp() {
  return new Date().toISOString();
}

function logWithTimestamp(message, meta) {
  const ts = getTimestamp();
  if (meta) {
    try {
      console.log(ts, message, JSON.stringify(meta, null, 2));
    } catch {
      console.log(ts, message, meta);
    }
  } else {
    console.log(ts, message);
  }
}

function logErrorWithTimestamp(message, meta) {
  const ts = getTimestamp();
  if (meta) {
    try {
      console.error(ts, message, JSON.stringify(meta, null, 2));
    } catch {
      console.error(ts, message, meta);
    }
  } else {
    console.error(ts, message);
  }
}

// ---- Boot diagnostics to confirm entry point on cPanel ----
console.log("[BOOT] CWD:", process.cwd());
console.log("[BOOT] Entry file:", __filename);
console.log("[BOOT] NODE_ENV:", process.env.NODE_ENV || "(not set)");

const app = express();

// ----- CORS -----
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

// ----- Body parsing -----
app.use(bodyParser.json());

// Mount your existing /api auth endpoints
app.use("/api", authRoutes);

// ---------------------------------------
// Google Calendar config
// ---------------------------------------
const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";
const API_KEYS = {
  preswylfa: process.env.PRESWYLFA_API_KEY || null,
  "piddle-inn": process.env.PIDDLE_API_KEY || null,
};

// Normalise PEM in env (replace literal "\n" with real newlines)
function normalizePrivateKey(pk) {
  return pk ? pk.replace(/\\n/g, "\n") : pk;
}

// NEW: per-property service account config
const SERVICE_ACCOUNT_CONFIG = {
  preswylfa: {
    // Backwards compatible: fall back to old GOOGLE_* vars if specific ones not set
    email:
      process.env.PRESWYLFA_SERVICE_ACCOUNT_EMAIL ||
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      null,
    key: normalizePrivateKey(
      process.env.PRESWYLFA_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || "",
    ),
  },
  "piddle-inn": {
    email: process.env.PIDDLE_SERVICE_ACCOUNT_EMAIL || null,
    key: normalizePrivateKey(process.env.PIDDLE_PRIVATE_KEY || ""),
  },
};

// Cache of google.calendar clients keyed by propertyId
const serviceAccountCalendars = {};

function getServiceAccountCalendar(propertyId) {
  const cfg = SERVICE_ACCOUNT_CONFIG[propertyId];
  if (!cfg || !cfg.email || !cfg.key) {
    throw new Error(
      `Service account not configured for property '${propertyId}'. ` +
        `Check SERVICE_ACCOUNT_CONFIG and env vars (EMAIL + PRIVATE_KEY).`,
    );
  }

  if (!serviceAccountCalendars[propertyId]) {
    const jwtClient = new google.auth.JWT({
      email: cfg.email,
      key: cfg.key,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });

    serviceAccountCalendars[propertyId] = google.calendar({
      version: "v3",
      auth: jwtClient,
    });
  }

  return serviceAccountCalendars[propertyId];
}

// ---------------------------------------
// Properties
// ---------------------------------------
const PROPERTY_CALENDARS = {
  preswylfa: {
    readCalendarId:
      process.env.PRESWYLFA_READ_CAL ||
      process.env.BNBCALENDAR_ID || // legacy env
      "not_configured",
    writeCalendarId:
      process.env.PRESWYLFA_WRITE_CAL ||
      process.env.BOOKCAL_ID || // legacy env
      "not_configured",
    displayName: "Bwthyn Preswylfa",
    emailUser: process.env.PRESWYLFA_EMAIL_USER,
    emailPass: process.env.PRESWYLFA_EMAIL_PASS,
    adminEmail: process.env.ADMIN_EMAIL,
    logoUrl:
      "https://holidayhomesandlets.co.uk/static/media/Bwythn_Preswylfa_Logo_Enhanced.80503fa2351394cb86a6.png",
  },
  "piddle-inn": {
    readCalendarIds: [
      process.env.PIDDLE_READ_CAL_MAIN,
      process.env.PIDDLE_READ_CAL_AIRBNB,
      process.env.PIDDLE_READ_CAL_BOOKING,
      process.env.PIDDLE_READ_CAL_VRBO,
    ].filter((id) => id && id !== "not_configured"),
    writeCalendarId: process.env.PIDDLE_WRITE_CAL || "not_configured",
    displayName: "Piddle Inn",
    emailUser: process.env.PIDDLE_EMAIL_USER,
    emailPass: process.env.PIDDLE_EMAIL_PASS,
    adminEmail: process.env.ADMIN_EMAIL,
    logoUrl:
      "https://www.holidayhomesandlets.co.uk/static/media/piddle-logo.2010f659a389e09283e3.png",
  },
};

const VALID_PROPERTIES = Object.keys(PROPERTY_CALENDARS);
// Default used when :propertyId is omitted (keeps legacy /api/events working)
const DEFAULT_PROPERTY = process.env.DEFAULT_PROPERTY || "preswylfa";

function getPropertyConfig(propertyId) {
  const cfg = PROPERTY_CALENDARS[propertyId];
  if (!cfg) throw new Error(`Unknown property: ${propertyId}`);

  // Normalize: ensure readCalendarIds is always an array
  if (cfg.readCalendarId && !cfg.readCalendarIds) {
    cfg.readCalendarIds = [cfg.readCalendarId];
  }

  return cfg;
}

function getValidPropertyId(req, res) {
  // Allow /api/... and /api/.../:propertyId
  const propertyId = req.params.propertyId || DEFAULT_PROPERTY;
  if (!VALID_PROPERTIES.includes(propertyId)) {
    res.status(400).json({ error: `Unknown property: ${propertyId}` });
    return null;
  }
  return propertyId;
}

// ---------------------------------------
// Utilities
// ---------------------------------------
function parseIsoDateOnly(d) {
  return d.toISOString().split("T")[0];
}

function formatDdMmYyyy(dateString) {
  const d = new Date(dateString);
  if (isNaN(d)) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ---------------------------------------
// Health (under /api so it hits Node, not React)
// ---------------------------------------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------------------------------------
// Debug: list registered routes (handy on cPanel)
// ---------------------------------------
app.get("/api/debug/routes", (_req, res) => {
  const routes = [];
  app._router.stack.forEach((m) => {
    if (m.route && m.route.path) {
      const methods = Object.keys(m.route.methods)
        .filter((k) => m.route.methods[k])
        .map((k) => k.toUpperCase());
      routes.push({ methods, path: m.route.path });
    } else if (m.name === "router" && m.handle?.stack) {
      m.handle.stack.forEach((h) => {
        if (h.route?.path) {
          const methods = Object.keys(h.route.methods)
            .filter((k) => h.route.methods[k])
            .map((k) => k.toUpperCase());
          routes.push({ methods, path: `/api${h.route.path}` });
        }
      });
    }
  });
  res.json({ routes });
});

// ---------------------------------------
// Events (READ) — works for /api/events and /api/events/:propertyId
// Auto-switches between API key (public) and service account (private).
// ---------------------------------------
app.get("/api/events/:propertyId?", async (req, res) => {
  const propertyId = req.params.propertyId || DEFAULT_PROPERTY;
  let mode = null;

  // Set cache-control headers to prevent browser caching
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });

  try {
    if (!VALID_PROPERTIES.includes(propertyId)) {
      logErrorWithTimestamp("[/api/events] Invalid propertyId", { propertyId });
      return res.status(400).json({ error: `Unknown property: ${propertyId}` });
    }

    const propertyCfg = getPropertyConfig(propertyId);
    const readCalendarIds = propertyCfg.readCalendarIds || [];

    if (!readCalendarIds.length) {
      logWithTimestamp("[/api/events] No readCalendarIds configured", {
        propertyId,
      });
      return res.json({ items: [] });
    }

    // Get property-specific API key
    const apiKey = API_KEYS[propertyId];
    const rawApiKey = apiKey && apiKey.trim();

    // Time window (now -> 1 year ahead)
    const now = new Date();
    const oneYearAhead = new Date(now);
    oneYearAhead.setFullYear(now.getFullYear() + 1);

    // Collect events from all calendars
    const allItems = [];

    for (const readCalendarId of readCalendarIds) {
      if (!readCalendarId || readCalendarId === "not_configured") continue;

      try {
        if (rawApiKey) {
          // ---- API KEY MODE (public calendars) ----
          mode = "apiKey";

          const url =
            `${GOOGLE_CALENDAR_URL}/${encodeURIComponent(readCalendarId)}/events` +
            `?key=${rawApiKey}` +
            `&singleEvents=true&orderBy=startTime` +
            `&timeMin=${encodeURIComponent(now.toISOString())}` +
            `&timeMax=${encodeURIComponent(oneYearAhead.toISOString())}` +
            `&maxResults=2500`;

          logWithTimestamp("[/api/events] Fetching via API key", {
            propertyId,
            readCalendarId,
          });

          const response = await superagent.get(url);
          const data = JSON.parse(response.text);

          if (Array.isArray(data.items)) {
            allItems.push(...data.items);
          }

          logWithTimestamp("[/api/events] API key fetch OK", {
            propertyId,
            readCalendarId,
            count: Array.isArray(data.items) ? data.items.length : 0,
          });
        } else {
          // ---- SERVICE ACCOUNT MODE (fallback for private calendars) ----
          mode = "serviceAccount";
          const calendarClient = getServiceAccountCalendar(propertyId);

          logWithTimestamp("[/api/events] Fetching via service account", {
            propertyId,
            readCalendarId,
            serviceAccountEmail:
              SERVICE_ACCOUNT_CONFIG[propertyId]?.email || null,
          });

          const response = await calendarClient.events.list({
            calendarId: readCalendarId,
            timeMin: now.toISOString(),
            timeMax: oneYearAhead.toISOString(),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 2500,
          });

          const items = response.data.items || [];
          allItems.push(...items);

          logWithTimestamp("[/api/events] Service account fetch OK", {
            propertyId,
            readCalendarId,
            count: items.length,
          });
        }
      } catch (calErr) {
        // Log error for this specific calendar but continue with others
        logErrorWithTimestamp("[/api/events] Error fetching from calendar", {
          propertyId,
          readCalendarId,
          mode,
          error: calErr?.response?.data || calErr.message || calErr,
        });
      }
    }

    // Remove duplicates (same event might appear in multiple calendars)
    const uniqueItems = [];
    const seen = new Set();

    for (const item of allItems) {
      // Create a unique key based on start/end time and summary
      const key = `${item.start?.dateTime || item.start?.date}-${item.end?.dateTime || item.end?.date}-${item.summary}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    logWithTimestamp("[/api/events] All calendars fetched", {
      propertyId,
      totalEvents: uniqueItems.length,
      calendarsChecked: readCalendarIds.length,
    });

    return res.json({ items: uniqueItems });
  } catch (err) {
    const safeError = err?.response?.data || err.message || err;

    logErrorWithTimestamp("[/api/events] Calendar read error", {
      propertyId,
      mode,
      error: safeError,
    });

    // Keep frontend resilient
    return res.json({ items: [] });
  }
});

// ---------------------------------------
// Events (WRITE) – property-aware (propertyId optional)
// POST /api/add-event OR /api/add-event/:propertyId
// body: { startDate, endDate, summary, description }
// ---------------------------------------
app.post("/api/add-event/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  const { startDate, endDate, summary, description } = req.body || {};
  if (!startDate || !endDate || !summary) {
    return res.status(400).json({
      error: "Missing required fields",
      details: "startDate, endDate, and summary are required",
    });
  }

  try {
    const { writeCalendarId } = getPropertyConfig(propertyId);
    if (!writeCalendarId || writeCalendarId === "not_configured") {
      return res.status(400).json({
        error: "Calendar not configured",
        message: "Booking system not yet available for this property.",
      });
    }

    const event = {
      summary,
      description,
      start: {
        dateTime: new Date(startDate).toISOString(),
        timeZone: "Europe/London",
      },
      end: {
        dateTime: new Date(endDate).toISOString(),
        timeZone: "Europe/London",
      },
    };

    const calendarClient = getServiceAccountCalendar(propertyId);

    const response = await calendarClient.events.insert({
      calendarId: writeCalendarId,
      resource: event,
    });

    res.json({ eventLink: response?.data?.htmlLink || null });
  } catch (error) {
    console.error(
      `Error adding event for ${propertyId}:`,
      error?.response?.data || error.message,
    );
    res.status(500).json({ error: "Failed to create event" });
  }
});

// ---------------------------------------
// Debug endpoint — see which mode & IDs are live
// ---------------------------------------
app.get("/api/debug/calendar/:propertyId?", (req, res) => {
  const propertyId = req.params.propertyId || DEFAULT_PROPERTY;

  const propertyCfg = PROPERTY_CALENDARS[propertyId] || {};
  const saCfg = SERVICE_ACCOUNT_CONFIG[propertyId] || {};

  const info = {
    propertyId,
    apiKeyPresent: Boolean(apiKey && apiKey.trim()),
    usingServiceAccount: SERVICE_ACCOUNT_ONLY_PROPERTIES.has(propertyId),
    env: {
      PRESWYLFA_READ_CAL: process.env.PRESWYLFA_READ_CAL ? "(set)" : "(unset)",
      PIDDLE_READ_CAL: process.env.PIDDLE_READ_CAL ? "(set)" : "(unset)",
      BNBCALENDAR_ID: process.env.BNBCALENDAR_ID ? "(set)" : "(unset)", // legacy
      PRESWYLFA_SERVICE_ACCOUNT_EMAIL: process.env
        .PRESWYLFA_SERVICE_ACCOUNT_EMAIL
        ? "(set)"
        : "(unset)",
      PIDDLE_SERVICE_ACCOUNT_EMAIL: process.env.PIDDLE_SERVICE_ACCOUNT_EMAIL
        ? "(set)"
        : "(unset)",
    },
    resolvedReadCalendarId: propertyCfg.readCalendarId || "(not_configured)",
    serviceAccountEmail: saCfg.email || "(none)",
  };

  res.json(info);
});

// ---------------------------------------
// Pricing – property-aware (propertyId optional)
// GET /api/prices OR /api/prices/:propertyId
// ---------------------------------------
app.get("/api/prices/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  try {
    const [standardPriceRows] = await pool.query(
      "SELECT value FROM standard_price WHERE property_id = ? LIMIT 1;",
      [propertyId],
    );
    const [datePriceRows] = await pool.query(
      "SELECT id, date, price FROM date_prices WHERE property_id = ? ORDER BY date;",
      [propertyId],
    );

    res.json({
      standardPrice: standardPriceRows?.[0]?.value ?? 150,
      datePrices: datePriceRows.map((r) => ({
        id: r.id,
        date: r.date,
        price: r.price,
      })),
    });
  } catch (err) {
    console.error(`Error fetching prices for ${propertyId}:`, err);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

// ---------------------------------------
// Update standard price – property-aware (propertyId optional)
// PUT /api/prices/standard OR /api/prices/standard/:propertyId
// body: { price }
// PROTECTED: Requires authentication and property access
// ---------------------------------------
app.put(
  "/api/prices/standard/:propertyId?",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { price } = req.body || {};
    if (price == null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: "Invalid or missing 'price'" });
    }

    try {
      const [result] = await pool.query(
        "UPDATE standard_price SET value = ? WHERE property_id = ?;",
        [price, propertyId],
      );

      if (result.affectedRows === 0) {
        await pool.query(
          "INSERT INTO standard_price (property_id, value) VALUES (?, ?);",
          [propertyId, price],
        );
      }

      res.json({ message: "Standard price updated" });
    } catch (err) {
      console.error(`Error updating standard price for ${propertyId}:`, err);
      res.status(500).json({ error: "Failed to update standard price" });
    }
  },
);

// ---------------------------------------
// Upsert date prices – property-aware (propertyId optional)
// POST /api/prices/date-range OR /api/prices/date-range/:propertyId
// body: { dates: ["YYYY-MM-DD", ...], price }
// PROTECTED: Requires authentication and property access
// ---------------------------------------
app.post(
  "/api/prices/date-range/:propertyId?",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { dates, price } = req.body || {};
    if (!Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: "No dates provided" });
    }
    if (price == null || Number.isNaN(Number(price))) {
      return res.status(400).json({ error: "Invalid or missing 'price'" });
    }

    try {
      const statements = dates.map((d) =>
        pool.query(
          `INSERT INTO date_prices (date, price, property_id)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE price = VALUES(price);`,
          [d, price, propertyId],
        ),
      );

      await Promise.all(statements);

      const [rows] = await pool.query(
        "SELECT id, date, price FROM date_prices WHERE property_id = ? ORDER BY date;",
        [propertyId],
      );

      res.json({ datePrices: rows });
    } catch (err) {
      console.error(`Error updating date prices for ${propertyId}:`, err);
      res
        .status(500)
        .json({ error: "Failed to update prices for selected dates" });
    }
  },
);

// ---------------------------------------
// Delete a specific date price – property-aware
// DELETE /api/prices/date-range/:propertyId/:id
// PROTECTED: Requires authentication and property access
// ---------------------------------------
app.delete(
  "/api/prices/date-range/:propertyId/:id",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { id } = req.params;

    try {
      await pool.query(
        "DELETE FROM date_prices WHERE id = ? AND property_id = ?;",
        [id, propertyId],
      );

      const [rows] = await pool.query(
        "SELECT id, date, price FROM date_prices WHERE property_id = ? ORDER BY date;",
        [propertyId],
      );

      res.json({ datePrices: rows });
    } catch (err) {
      console.error(`Error deleting date price for ${propertyId}:`, err);
      res.status(500).json({ error: "Failed to delete date price" });
    }
  },
);

// ---------------------------------------
// Calculate total – property-aware (propertyId optional)
// POST /api/prices/total OR /api/prices/total/:propertyId
// body: { startDate, endDate }
// ---------------------------------------
app.post("/api/prices/total/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  const { startDate, endDate } = req.body || {};
  if (!startDate || !endDate) {
    return res
      .status(400)
      .json({ error: "startDate and endDate are required" });
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    const [standardRows] = await pool.query(
      "SELECT value FROM standard_price WHERE property_id = ? LIMIT 1;",
      [propertyId],
    );
    const standardPrice = parseFloat(standardRows?.[0]?.value ?? 150);

    let current = new Date(start);
    let total = 0;

    while (current <= end) {
      const yyyyMmDd = parseIsoDateOnly(current);

      const [specificRows] = await pool.query(
        "SELECT price FROM date_prices WHERE date = ? AND property_id = ? LIMIT 1;",
        [yyyyMmDd, propertyId],
      );
      const specific = specificRows?.[0]?.price;

      total += specific != null ? parseFloat(specific) : standardPrice;
      current.setDate(current.getDate() + 1);
    }

    res.json({ total });
  } catch (err) {
    console.error(`Error calculating total price for ${propertyId}:`, err);
    res.status(500).json({ error: "Error calculating total price" });
  }
});

// ---------------------------------------
// Contact (unchanged path; uses your emailService)
// POST /api/contact
// ---------------------------------------
app.post("/api/contact", async (req, res) => {
  const { name, email, telephone, message } = req.body || {};
  if (!name || !email || !message) {
    return res
      .status(400)
      .json({ error: "name, email, and message are required" });
  }

  try {
    const html = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Telephone:</strong> ${telephone || "—"}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      </div>
    `;
    await sendEmail(
      process.env.EMAIL_USER,
      "New Contact Form Message",
      html,
      email,
    );
    res.status(200).json({ message: "Message sent" });
  } catch (err) {
    console.error("Error sending contact email:", err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Add this to server.js temporarily
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
// Booking emails – property-aware (propertyId optional)
// POST /api/send-booking-emails OR /api/send-booking-emails/:propertyId
// ---------------------------------------
app.post("/api/send-booking-emails/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  const {
    name,
    email,
    numberOfPeople,
    numberOfPets,
    telephone,
    message,
    startDate,
    endDate,
    totalPrice,
  } = req.body || {};

  try {
    const { displayName, logoUrl } = getPropertyConfig(propertyId);
    const formattedStart = formatDdMmYyyy(startDate);
    const formattedEnd = formatDdMmYyyy(endDate);
    const safeTotal = Number.isFinite(Number(totalPrice))
      ? Number(totalPrice).toFixed(2)
      : "—";

    const customerEmailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 5px; background-color: #f9f9f9;">
        <div style="text-align: center; padding-bottom: 20px;">
          <div style="background-color: #000; display: inline-block; padding: 10px; border-radius: 5px;">
            <img src="${logoUrl}" alt="Holiday Homes Logo" width="200" />
          </div>
        </div>
        <h2>Booking Request Received - ${displayName}</h2>
        <p>Dear <strong>${name || "Guest"}</strong>,</p>
        <p>Thank you for your booking request for <strong>${displayName}</strong>! We are reviewing your details and will confirm shortly.</p>
        <h3>Booking Details</h3>
        <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Property</strong></td><td style="padding:8px;border:1px solid #ddd">${displayName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedStart}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedEnd}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Guests</strong></td><td style="padding:8px;border:1px solid #ddd">${
            numberOfPeople ?? "—"
          }</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Pets</strong></td><td style="padding:8px;border:1px solid #ddd">${
            numberOfPets ?? "—"
          }</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Total</strong></td><td style="padding:8px;border:1px solid #ddd">£${safeTotal}</td></tr>
        </table>
        <p>If you have questions, email <a href="mailto:hello@holidayhomesandlets.co.uk">hello@holidayhomesandlets.co.uk</a>.</p>
        <div style="text-align:center; margin-top:20px">
          <a href="https://holidayhomesandlets.co.uk" style="background:#008CBA;color:#fff;padding:10px 15px;text-decoration:none;border-radius:5px">Visit Our Website</a>
        </div>
      </div>
    `;

    const adminEmailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 5px; background-color: #f9f9f9;">
        <div style="text-align: center; padding-bottom: 20px;">
          <div style="background-color: #000; display: inline-block; padding: 10px; border-radius: 5px;">
            <img src="${logoUrl}" alt="Holiday Homes Logo" width="200" />
          </div>
        </div>
        <h2>New Booking Request - ${displayName}</h2>
        <h3>Booking Details</h3>
        <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Property</strong></td><td style="padding:8px;border:1px solid #ddd">${displayName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Name</strong></td><td style="padding:8px;border:1px solid #ddd">${
            name || "—"
          }</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Email</strong></td><td style="padding:8px;border:1px solid #ddd">${
            email || "—"
          }</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Phone</strong></td><td style="padding:8px;border:1px solid #ddd">${
            telephone || "—"
          }</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedStart}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedEnd}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Guests</strong></td><td style="padding:8px;border:1px solid #ddd">${
            numberOfPeople ?? "—"
          }</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Pets</strong></td><td style="padding:8px;border:1px solid #ddd">${
            numberOfPets ?? "—"
          }</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Total</strong></td><td style="padding:8px;border:1px solid #ddd">£${safeTotal}</td></tr>
        </table>
        <p><strong>Message from customer:</strong></p>
        <p>${message || "—"}</p>
      </div>
    `;

    const propertyCfg = getPropertyConfig(propertyId);

    await Promise.all([
      // Email to customer
      sendEmail(
        email,
        `Your Booking Request Confirmation - ${displayName}`,
        customerEmailHtml,
        propertyCfg.emailUser, // replyTo
        propertyCfg.emailUser, // emailUser
        propertyCfg.emailPass, // emailPass
        displayName, // propertyName
      ),
      // Email to admin/owner
      sendEmail(
        propertyCfg.adminEmail,
        `New Booking Request - ${displayName}`,
        adminEmailHtml,
        email, // replyTo (customer email)
        propertyCfg.emailUser, // emailUser
        propertyCfg.emailPass, // emailPass
        displayName, // propertyName
      ),
    ]);

    res.status(200).json({ message: "Emails sent successfully" });
  } catch (error) {
    console.error(`Error sending booking emails for ${propertyId}:`, error);
    res.status(500).json({ error: "Failed to send emails" });
  }
});

// ---------------------------------------
// Start server
// ---------------------------------------
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

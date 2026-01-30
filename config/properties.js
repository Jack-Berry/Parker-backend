const { google } = require("googleapis");

// ---------------------------------------
// Google Calendar config
// ---------------------------------------
const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";

const API_KEYS = {
  preswylfa: process.env.PRESWYLFA_API_KEY || null,
  "piddle-inn": process.env.PIDDLE_API_KEY || null,
};

// Normalize PEM in env (replace literal "\n" with real newlines)
function normalizePrivateKey(pk) {
  return pk ? pk.replace(/\\n/g, "\n") : pk;
}

// Per-property service account config
const SERVICE_ACCOUNT_CONFIG = {
  preswylfa: {
    email:
      process.env.PRESWYLFA_SERVICE_ACCOUNT_EMAIL ||
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      null,
    key: normalizePrivateKey(
      process.env.PRESWYLFA_PRIVATE_KEY || process.env.GOOGLE_PRIVATE_KEY || ""
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
        `Check SERVICE_ACCOUNT_CONFIG and env vars (EMAIL + PRIVATE_KEY).`
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
// Property Configurations
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
    adminEmail: process.env.PRESWYLFA_EMAIL_USER,
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
    adminEmail: process.env.PIDDLE_EMAIL_USER,
    logoUrl:
      "https://www.holidayhomesandlets.co.uk/static/media/piddle-logo.2010f659a389e09283e3.png",
  },
};

const VALID_PROPERTIES = Object.keys(PROPERTY_CALENDARS);
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

module.exports = {
  GOOGLE_CALENDAR_URL,
  API_KEYS,
  SERVICE_ACCOUNT_CONFIG,
  getServiceAccountCalendar,
  PROPERTY_CALENDARS,
  VALID_PROPERTIES,
  DEFAULT_PROPERTY,
  getPropertyConfig,
  getValidPropertyId,
};

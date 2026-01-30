const express = require("express");
const router = express.Router();
const superagent = require("superagent");
const { google } = require("googleapis");
const { getPropertyConfig, getValidPropertyId } = require("../config/properties");
const { logWithTimestamp, logErrorWithTimestamp, parseIsoDateOnly } = require("../utils/helpers");

// Import from config/properties
const { API_KEYS, getServiceAccountCalendar, GOOGLE_CALENDAR_URL } = require("../config/properties");

// ---------------------------------------
// GET /api/events/:propertyId
// Public read of calendar events using API key
// ---------------------------------------
router.get("/events/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  logWithTimestamp(`[${propertyId}] /api/events requested`, {
    propertyId,
    origin: req.headers.origin,
  });

  const apiKey = API_KEYS[propertyId];
  if (!apiKey) {
    return res.status(400).json({ error: `No API key configured for '${propertyId}'` });
  }

  const cfg = getPropertyConfig(propertyId);
  logWithTimestamp(`[${propertyId}] Config loaded:`, { readCalendarIds: cfg.readCalendarIds });

  if (!cfg.readCalendarIds || cfg.readCalendarIds.length === 0) {
    return res.status(400).json({
      error: `No read calendars configured for '${propertyId}'`,
    });
  }

  try {
    const fetchPromises = cfg.readCalendarIds.map(async (calId) => {
      if (!calId || calId === "not_configured") {
        logWithTimestamp(`[${propertyId}] Skipping unconfigured calId`, { calId });
        return { calId, events: [] };
      }

      const url = `${GOOGLE_CALENDAR_URL}/${encodeURIComponent(calId)}/events`;
      logWithTimestamp(`[${propertyId}] Fetching from calId=${calId}`, { url });

      try {
        const response = await superagent.get(url).query({ key: apiKey });
        const items = response.body?.items || [];
        logWithTimestamp(`[${propertyId}] Fetched ${items.length} events from ${calId}`);
        return { calId, events: items };
      } catch (err) {
        logErrorWithTimestamp(`[${propertyId}] Error fetching from ${calId}:`, {
          status: err.status,
          message: err.message,
        });
        return { calId, events: [], error: err.message };
      }
    });

    const results = await Promise.all(fetchPromises);
    const allEvents = results.flatMap((r) => r.events);
    logWithTimestamp(`[${propertyId}] Total raw events fetched: ${allEvents.length}`);

    // Deduplicate by start date + summary
    const seen = new Map();
    const deduped = [];
    for (const ev of allEvents) {
      const start = ev.start?.date || ev.start?.dateTime;
      const summary = ev.summary || "";
      const key = `${start}|${summary}`;
      if (!seen.has(key)) {
        seen.set(key, true);
        deduped.push(ev);
      }
    }

    logWithTimestamp(`[${propertyId}] Deduplicated to ${deduped.length} events`);

    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
    });

    res.json({ items: deduped });
  } catch (err) {
    logErrorWithTimestamp(`[${propertyId}] Unexpected error in /api/events:`, {
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

// ---------------------------------------
// POST /api/add-event/:propertyId
// Add booking to write calendar using service account
// ---------------------------------------
router.post("/add-event/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  const { summary, location, description, startDate, endDate } = req.body || {};

  if (!summary || !startDate || !endDate) {
    return res.status(400).json({ error: "summary, startDate, endDate required" });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) {
    return res.status(400).json({ error: "Invalid date format" });
  }

  try {
    const cfg = getPropertyConfig(propertyId);
    const calendarService = getServiceAccountCalendar(propertyId);

    const event = {
      summary,
      location: location || "",
      description: description || "",
      start: { date: parseIsoDateOnly(start) },
      end: { date: parseIsoDateOnly(end) },
    };

    logWithTimestamp(`[${propertyId}] Creating event in ${cfg.writeCalendarId}`, event);

    const response = await calendarService.events.insert({
      calendarId: cfg.writeCalendarId,
      requestBody: event,
    });

    logWithTimestamp(`[${propertyId}] Event created successfully`, {
      eventId: response.data.id,
    });

    res.status(200).json({
      message: "Event added",
      eventId: response.data.id,
      htmlLink: response.data.htmlLink,
    });
  } catch (error) {
    logErrorWithTimestamp(`[${propertyId}] Error creating event:`, {
      message: error.message,
      details: error.response?.data || error.stack,
    });

    res.status(500).json({
      error: "Failed to add event",
      details: error.message,
    });
  }
});

module.exports = router;

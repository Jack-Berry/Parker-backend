const express = require("express");
const request = require("superagent");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());

const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";

// Proxy endpoint
app.get("/api/events", async (req, res) => {
  const calendarId = process.env.CALENDAR_ID;
  const apiKey = process.env.GOOGLE_API_KEY;

  console.log("GOOGLE_API_KEY:", process.env.GOOGLE_API_KEY, apiKey);
  console.log("CALENDAR_ID:", process.env.CALENDAR_ID, calendarId);
  console.log("Environment Variables:", process.env);
  ``;

  if (!calendarId || !apiKey) {
    return res.status(400).send("Missing Calendar ID or API Key.");
  }

  const url = `${GOOGLE_CALENDAR_URL}/${calendarId}/events?key=${apiKey}`;
  try {
    const response = await request.get(url);
    res.json(JSON.parse(response.text));
  } catch (error) {
    console.error("Error fetching Google Calendar events:", error);
    res.status(500).send("Error fetching events.");
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});

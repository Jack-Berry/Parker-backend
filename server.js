const express = require("express");
const request = require("superagent");
const { google } = require("googleapis");
const bodyParser = require("body-parser");
const { router: authRoutes, authenticateToken } = require("./auth");
const cors = require("cors");
const fs = require("fs");
require("dotenv").config();
const { pool } = require("./db");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(authRoutes);

const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";

// Initialize Google API client with the service account
const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
});

const calendar = google.calendar({ version: "v3", auth });

// Get Air Bnb
app.get("/api/events", async (req, res) => {
  const calendarId = process.env.BNBCALENDAR_ID;
  const apiKey = process.env.GOOGLE_API_KEY;

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

app.post("/add-event", async (req, res) => {
  const { startDate, endDate, summary, description } = req.body;

  try {
    const event = {
      summary,
      description,
      start: {
        dateTime: startDate,
        timeZone: "America/New_York",
      },
      end: {
        dateTime: endDate,
        timeZone: "America/New_York",
      },
    };

    const calendarId = process.env.BOOKCAL_ID;

    const response = await calendar.events.insert({
      calendarId: calendarId || "primary",
      resource: event,
    });

    res.send({ eventLink: response.data.htmlLink });
  } catch (error) {
    console.error("Error adding event:", error);
    res.status(500).send("Failed to create event.");
  }
});

app.get("/test-db", async (req, res) => {
  ////TEST
  try {
    const result = await pool.query("SELECT 1 + 1 AS result;");
    console.log("Database connection test result:", result.rows);
    res.json({ success: true, result: result.rows });
  } catch (err) {
    console.error("Database connection test failed:", err.message);
    res.status(500).json({ error: "Database connection failed" });
  }
});

app.get("/api/prices", async (req, res) => {
  try {
    const standardPriceResult = await pool.query(
      "SELECT value FROM standard_price LIMIT 1;"
    );
    const datePricesResult = await pool.query(
      "SELECT id, date, price FROM date_prices ORDER BY date;"
    );

    const datePrices = datePricesResult.rows.map((row) => ({
      id: row.id,
      date: row.date, // Fetch the individual date
      price: row.price,
    }));

    res.json({
      standardPrice: standardPriceResult.rows[0]?.value || 0,
      datePrices,
    });
  } catch (err) {
    console.error("Error in /api/prices:", err.message);
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

app.put("/api/prices/standard", async (req, res) => {
  const { price } = req.body;
  try {
    await pool.query("UPDATE standard_price SET value = $1 WHERE id = 1;", [
      price,
    ]);
    res.json({ message: "Standard price updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update standard price" });
  }
});
app.post("/api/prices/date-range", async (req, res) => {
  const { dates, price } = req.body;

  try {
    const queries = dates.map((date) =>
      pool.query(
        `INSERT INTO date_prices (date, price)
         VALUES ($1, $2)
         ON CONFLICT (date) DO UPDATE SET price = $2;`,
        [date, price]
      )
    );

    await Promise.all(queries);

    const result = await pool.query("SELECT * FROM date_prices ORDER BY date;");
    res.json({ datePrices: result.rows });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Failed to update prices for selected dates" });
  }
});

app.delete("/api/prices/date-range/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM date_prices WHERE id = $1;", [id]);
    const result = await pool.query("SELECT * FROM date_prices;");
    res.json({ datePrices: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete date range price" });
  }
});

app.delete("/api/prices/date-range/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM date_prices WHERE id = $1;", [id]);
    const result = await pool.query("SELECT * FROM date_prices;");
    res.json({ datePrices: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete date range price" });
  }
});

app.post("/api/prices/calculate", async (req, res) => {
  const { startDate, endDate } = req.body;

  try {
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      return res
        .status(400)
        .json({ error: "Start date cannot be after end date" });
    }

    // Get the standard price
    const standardPriceResult = await pool.query(
      "SELECT value FROM standard_price LIMIT 1;"
    );
    const standardPrice = parseFloat(standardPriceResult.rows[0]?.value || 0);

    // Fetch date-specific prices
    const datePricesResult = await pool.query(
      `SELECT * FROM date_prices WHERE 
      (start_date <= $2 AND end_date >= $1);`,
      [startDate, endDate]
    );

    const datePrices = datePricesResult.rows;
    console.log(datePrices, "Hey");

    // Calculate the total
    let total = 0;
    for (
      let currentDate = new Date(start);
      currentDate <= end;
      currentDate.setDate(currentDate.getDate() + 1)
    ) {
      const formattedDate = currentDate.toISOString().split("T")[0];
      const specificPrice = datePrices.find(
        (price) =>
          formattedDate >= price.start_date && formattedDate <= price.end_date
      );

      total += specificPrice ? parseFloat(specificPrice.price) : standardPrice;
    }

    res.json({ total });
  } catch (error) {
    console.error("Error calculating price:", error);
    res.status(500).json({ error: "Failed to calculate price" });
  }
});

app.post("/api/prices/total", async (req, res) => {
  const { startDate, endDate } = req.body;

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    let currentDate = new Date(start);
    let total = 0;

    while (currentDate <= end) {
      const formattedDate = currentDate.toISOString().split("T")[0];

      // Fetch specific price for the current date
      const specificPriceResult = await pool.query(
        "SELECT price FROM date_prices WHERE date = $1;",
        [formattedDate]
      );

      const specificPrice = specificPriceResult.rows[0]?.price;

      if (specificPrice) {
        console.log(
          `Adding specific price for ${formattedDate}: ${specificPrice}`
        );
        total += parseFloat(specificPrice);
      } else {
        console.log(`Using standard price for ${formattedDate}`);
        const standardPriceResult = await pool.query(
          "SELECT value FROM standard_price LIMIT 1;"
        );
        total += parseFloat(standardPriceResult.rows[0].value);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({ total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error calculating total price" });
  }
});

// Apply the middleware to secure specific routes
app.get("/secure-data", authenticateToken, (req, res) => {
  res.json({ message: "This is secure data." });
});

// Existing endpoints...
app.get("/api/prices", authenticateToken, (req, res) => {
  // Protected logic here
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});

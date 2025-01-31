const express = require("express");
const mysql = require("mysql2/promise"); // Correctly import mysql2
const request = require("superagent");
const { google } = require("googleapis");
const bodyParser = require("body-parser");
const { router: authRoutes, authenticateToken } = require("./auth");
const cors = require("cors");
require("dotenv").config();
const { pool } = require("./db");

const app = express();
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://holidayhomesandlets.co.uk",
    "https://holidayhomesandlets.co.uk",
    "http://www.holidayhomesandlets.co.uk",
    "https://www.holidayhomesandlets.co.uk",
  ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(bodyParser.json());
app.use("/api", authRoutes);

const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";

const auth = new google.auth.JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
});

const calendar = google.calendar({ version: "v3", auth });

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
      start: { dateTime: startDate, timeZone: "America/New_York" },
      end: { dateTime: endDate, timeZone: "America/New_York" },
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

// Temporary test route to check database connection
app.get("/api/test-db", async (req, res) => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
    });

    console.log("Database connected successfully");
    res.json({ success: true, message: "Database connected successfully" });

    await connection.end();
  } catch (error) {
    console.error("Error connecting to the database:", error.message);
    res.status(500).json({
      success: false,
      error: "Error connecting to the database",
      message: error.message,
    });
  }
});

// app.get("/api/test-db", async (req, res) => {
//   try {
//     const [rows] = await pool.query("SELECT 1 + 1 AS result;");
//     console.log("Database connection successful:", rows);
//     res.json({ success: true, result: rows });
//   } catch (err) {
//     console.error("Database connection failed:", err.message);
//     res.status(500).json({ error: "Database connection failed" });
//   }
// });

app.get("/api/prices", async (req, res) => {
  try {
    const [standardPriceResult] = await pool.query(
      "SELECT value FROM standard_price LIMIT 1;"
    );
    const [datePricesResult] = await pool.query(
      "SELECT id, date, price FROM date_prices ORDER BY date;"
    );

    const datePrices = datePricesResult.map((row) => ({
      id: row.id,
      date: row.date,
      price: row.price,
    }));

    res.json({
      standardPrice: standardPriceResult[0]?.value || 0,
      datePrices,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to fetch prices",
      message: err.message,
      stack: err.stack,
    });
  }
});

app.put("/api/prices/standard", async (req, res) => {
  const { price } = req.body;
  try {
    await pool.query("UPDATE standard_price SET value = ? WHERE id = 1;", [
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
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE price = ?;`,
        [date, price, price]
      )
    );

    await Promise.all(queries);

    const [result] = await pool.query(
      "SELECT * FROM date_prices ORDER BY date;"
    );
    res.json({ datePrices: result });
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
    await pool.query("DELETE FROM date_prices WHERE id = ?;", [id]);
    const [result] = await pool.query("SELECT * FROM date_prices;");
    res.json({ datePrices: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete date range price" });
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
      const [specificPriceResult] = await pool.query(
        "SELECT price FROM date_prices WHERE date = ?;",
        [formattedDate]
      );

      const specificPrice = specificPriceResult[0]?.price;

      if (specificPrice) {
        console.log(
          `Adding specific price for ${formattedDate}: ${specificPrice}`
        );
        total += parseFloat(specificPrice);
      } else {
        console.log(`Using standard price for ${formattedDate}`);
        const [standardPriceResult] = await pool.query(
          "SELECT value FROM standard_price LIMIT 1;"
        );
        total += parseFloat(standardPriceResult[0].value);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({ total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error calculating total price" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

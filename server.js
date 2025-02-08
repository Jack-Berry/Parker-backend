const express = require("express");
const mysql = require("mysql2/promise"); // Correctly import mysql2
const request = require("superagent");
const { google } = require("googleapis");
const bodyParser = require("body-parser");
const { router: authRoutes, authenticateToken } = require("./auth");
const { sendEmail } = require("./emailService");
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
  allowedHeaders: ["Content-Type", "Authorization"],
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

app.post("/api/add-event", async (req, res) => {
  const { startDate, endDate, summary, description } = req.body;

  console.log("📅 Received request to add event:", req.body);

  try {
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

    const calendarId = process.env.BOOKCAL_ID;

    console.log("🚀 Sending request to Google Calendar API...");

    const response = await calendar.events.insert({
      calendarId: calendarId || "primary",
      resource: event,
    });

    console.log("✅ Event successfully added:", response.data);

    res.json({ eventLink: response.data.htmlLink });
  } catch (error) {
    console.error(
      "❌ Error adding event:",
      error.response ? error.response.data : error.message
    );
    res
      .status(500)
      .json({ error: "Failed to create event", details: error.message });
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

app.post("/api/send-booking-emails", async (req, res) => {
  const {
    name,
    email,
    numberOfPeople,
    numberOfPets,
    telephone,
    message,
    startDate,
    endDate,
    totalPrice, // Add totalPrice from the request body
  } = req.body;

  try {
    const formatDate = (dateString) => {
      const date = new Date(dateString);
      const day = String(date.getDate()).padStart(2, "0");
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    };

    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);

    const customerEmailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 5px; background-color: #f9f9f9;">
        <div style="text-align: center; padding-bottom: 20px;">
          <div style="background-color: #000; display: inline-block; padding: 10px; border-radius: 5px;">
            <img src="https://holidayhomesandlets.co.uk/static/media/Bwythn_Preswylfa_Logo_Enhanced.80503fa2351394cb86a6.png" 
              alt="Holiday Homes Logo" width="200" />
          </div>
        </div>
        
        <h2 style="color: #333;">Booking Confirmation</h2>
        <p>Dear <strong>${name}</strong>,</p>
        <p>Thank you for your booking request! We are reviewing your details and will confirm shortly.</p>

        <h3 style="color: #555;">Booking Details:</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Check-in Date:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${formattedStartDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Check-out Date:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${formattedEndDate}</td>
          </tr>
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Number of Guests:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${numberOfPeople}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Number of Pets:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${numberOfPets}</td>
          </tr>
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Price:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">£${totalPrice.toFixed(
              2
            )}</td>
          </tr>
        </table>

        <p>If you have any questions, feel free to contact us at <a href="mailto:hello@holidayhomesandlets.co.uk" style="color: #555; text-decoration: none;">hello@holidayhomesandlets.co.uk</a>.</p>

        <div style="text-align: center; margin-top: 20px;">
          <a href="https://holidayhomesandlets.co.uk" style="background-color: #008CBA; color: white; padding: 10px 15px; text-decoration: none; border-radius: 5px;">
            Visit Our Website
          </a>
        </div>
      </div>
    `;

    const adminEmailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 5px; background-color: #f9f9f9;">
        <div style="text-align: center; padding-bottom: 20px;">
          <div style="background-color: #000; display: inline-block; padding: 10px; border-radius: 5px;">
            <img src="https://holidayhomesandlets.co.uk/static/media/Bwythn_Preswylfa_Logo_Enhanced.80503fa2351394cb86a6.png" 
              alt="Holiday Homes Logo" width="200" />
          </div>
        </div>
        
        <h2 style="color: #333;">New Booking Request</h2>
        <p>Hello Lucy,</p>
        <p>A new booking request has been received. The details are as follows:</p>

        <h3 style="color: #555;">Booking Details:</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Name:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${email}</td>
          </tr>
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Phone:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${telephone}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Check-in Date:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${formattedStartDate}</td>
          </tr>
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Check-out Date:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${formattedEndDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Number of Guests:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${numberOfPeople}</td>
          </tr>
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Number of Pets:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${numberOfPets}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Price:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">£${totalPrice.toFixed(
              2
            )}</td>
          </tr>
        </table>

        <p><strong>Message from Customer:</strong></p>
        <p>${message}</p>

      </div>
    `;

    await Promise.all([
      sendEmail(email, "Your Booking Request Confirmation", customerEmailHtml),
      sendEmail(
        process.env.EMAIL_USER, // Admin email
        "New Booking Request", // Subject
        adminEmailHtml, // Styled admin email
        email // Reply-to set to customer
      ),
    ]);

    res.status(200).json({ message: "Emails sent successfully" });
  } catch (error) {
    console.error("Error sending emails:", error);
    res.status(500).json({ error: "Failed to send emails" });
  }
});

app.post("/api/contact", async (req, res) => {
  const { name, email, message } = req.body;

  try {
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 5px; background-color: #f9f9f9;">
        <div style="text-align: center; padding-bottom: 20px;">
          <div style="background-color: #000; display: inline-block; padding: 10px; border-radius: 5px;">
            <img src="https://holidayhomesandlets.co.uk/static/media/Bwythn_Preswylfa_Logo_Enhanced.80503fa2351394cb86a6.png" 
              alt="Holiday Homes Logo" width="200" />
          </div>
        </div>
        
        <h2 style="color: #333;">New Contact Request</h2>
        <p>Hello Lucy,</p>
        <p>A new contact request has been received. The details are as follows:</p>

        <h3 style="color: #555;">Contact Details:</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background-color: #eee;">
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Name:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td>
            <td style="padding: 8px; border: 1px solid #ddd;">${email}</td>
          </tr>
        </table>

        <h3 style="color: #555; margin-top: 20px;">Message:</h3>
        <p style="background-color: #f4f4f4; padding: 10px; border-radius: 5px; border: 1px solid #ddd;">${message}</p>
      </div>
    `;

    await sendEmail(
      process.env.EMAIL_USER, // Admin's email
      "New Contact Request", // Email subject
      emailHtml, // Styled HTML content
      email // Reply-to set to customer's email
    );

    res.status(200).json({ message: "Message sent successfully!" });
  } catch (error) {
    console.error("Error sending contact email:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

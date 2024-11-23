const express = require("express");
const request = require("superagent");
const { google } = require("googleapis");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const GOOGLE_CALENDAR_URL = "https://www.googleapis.com/calendar/v3/calendars";

// Initialize Google API client with the service account
const auth = new google.auth.JWT({
  email: "website-calendar@bwythnpreswylfa.iam.gserviceaccount.com",
  key: "-----BEGIN PRIVATE KEY-----\nMIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDbRPFmf5ru8fhj\nfWezNiJxgIByif1wC9eaQKl7CowajTjgbtJJ5wrh2fUoZy1rcr6bj0Z2hD3QbM8M\nfQuhT6fPZG/DnFR8P4hLgz8+wzYHmlErT6cJFcbVmHpF0XUnEI0NLiKmNv3B8s11\n/JIFLFdR9rMow6RfiIy4N62U+VbuSbLHjaOyVAiHLka+qWUbTY+nm7JakSed1Bdk\nzWORg0YfCCdc4LbVh1GSAA4F9DWWmqmuONu9E+JpR+Labr+ItK4lKyjNziRqrAso\npFHiRizYhOogJboONLdxLmAoFkfIlk5QjZGQe1qe7ZjjCWx884TpebJW4g71l56r\nyM2/yDylAgMBAAECggEAM0FE6pBGj7dZOCxuyqoLWBvRKrUN3JywC9s0otHe2TAM\nzQ2qs2LCHPQ9hfHEYLsESkmuD3MvHeLpbUJnrw/3KpgQNhn7d8XEHt6xsIKiRRmy\nAp1ObuW7wl8vqdVh/L02M5AGwnLVU3plw8BEA9iPGtY/n/ZHnJtHRaKiPVIhm3aI\n77eyH5Tzv2ULfWYWNHeHrCDKZMe6x3L53faSZcju5Q8RT+oPaotIpfiCIq3NnUeI\ni/o9eFQaa9zaPl72LJs+He9P5tMq+2qqPvCQuN4ZkUR//4A8/wTQXCS4i9ZXSn1E\n+KFKHsxhvDUX1+buWpXt3v8FOkNG2Glw7pIZ0rF6kQKBgQD1844qRzZZxQRLVvBa\nyPLO+RM8t4fkZlxnC4PxO5fP+NVgpwUWvZkkULfkOG78Ha2GQPOqqqPR2LlCkCu9\nE474fm2azqUQpzR98fl0HY5hJonGRH1/Xe9/RPRTrj/9FVUTx/1/rYngUqz8a43c\n/bd+JymqICYKsxg+PsU+BbV0yQKBgQDkOlDGTuYMELuiet89Q3HRynlYJChtVURQ\nlsZpahvx15d6Ks09gb1HKSYjcxmE2mOg8wSlunzrYCIa2edb3gItyCNVh2S826Uc\nVtSU+CGow4BHQnuPwA6NY8wDhr985MrxQjKpO+2Ijxkhmeb0w4Skwp1/0OycELHe\n6L1WHJhC/QKBgQCjLpcSYfEjml4BBouuEElZHVSwIizdUzTXgYJnGVzeNYCNAgOU\nVPM4bv2zQ+YPDDnHK2z/vPu4DQzNpw3+Au4G3QsnfRdzdxySu2sAqWN//avHikWh\nrddrH3rj0mbOKcsqtrPwdFlYJkJzr4COMR//aUhxgab7zlu1YLxJLEx6UQKBgQCH\n/gOhluPXLqVPtN2OuMB6nKZfkfQQ6ezyBFWn/JU4LxnQru5rBwLNA0T5fJ0pH6Sc\nBBKx2gSTkE3iKBOHFyu/MfF0BmBNdKfW0hqLxarwz8WBMKlFx9AkCeJH+6PgfMg8\nqBBd7Rql83arIfSPxm0ka97Dia9jc0M5qv8e75z+1QKBgQDfv0YuC9m5g/ejhxVd\nJOfMdHACYGESbnAwlYLPTxdBjqwB3hUFaYPgWJeq3LumTwMwsjtxqyxgi/c1DKFZ\ndziQLf+tq8L66zBYDDfdD0aYH3u3lZA7stMa60RuEUWyUVsZ/2CtOHoKnKKniJ2G\nBqIO6IqMY5e2dCzERUtZLyh/bg==\n-----END PRIVATE KEY-----\n",
  scopes: ["https://www.googleapis.com/auth/calendar.events"],
});

const calendar = google.calendar({ version: "v3", auth });

// Get Air Bnb
app.get("/api/events", async (req, res) => {
  const calendarId = process.env.BNBCALENDAR_ID;
  const apiKey = process.env.GOOGLE_API_KEY;
  ``;
  console.log("GOOGLE_API_KEY:", process.env.GOOGLE_API_KEY, apiKey);
  console.log("BNBCALENDAR_ID:", process.env.BNBCALENDAR_ID, calendarId);
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

app.post("/add-event", async (req, res) => {
  const { startDate, endDate, summary, description } = req.body;

  try {
    const event = {
      summary,
      description,
      start: {
        dateTime: startDate,
        timeZone: "America/New_York", // Adjust as needed
      },
      end: {
        dateTime: endDate,
        timeZone: "America/New_York", // Adjust as needed
      },
    };

    // Replace with your Google Calendar ID
    const calendarId = process.env.BOOKCAL_ID;
    ``;

    const response = await calendar.events.insert({
      calendarId: calendarId || "primary",
      resource: event,
    });

    res.send({ eventLink: response.data.htmlLink });
  } catch (error) {
    console.error("Error adding event:", error);
    res.status(500).send("Failed to create event.");
  }
  ``;
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});

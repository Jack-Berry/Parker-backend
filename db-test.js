const mysql = require("mysql2/promise");
require("dotenv").config();

(async () => {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
    });

    console.log("Database connection successful!");
    const [rows] = await connection.query("SELECT 1 + 1 AS result;");
    console.log("Query result:", rows);
    await connection.end();
  } catch (err) {
    console.error("Database connection failed:", err.message);
  }
})();

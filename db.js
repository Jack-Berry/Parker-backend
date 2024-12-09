const { Pool } = require("pg");

// Create a connection pool
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

module.exports = {
  pool, // Export the raw pool object
  query: (text, params) => pool.query(text, params),
};

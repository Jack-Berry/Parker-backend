const mysql = require("mysql2/promise");
require("dotenv").config();

const VALID_PROPERTIES = (process.env.VALID_PROPERTIES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PROPERTIES = VALID_PROPERTIES.length
  ? VALID_PROPERTIES
  : ["preswylfa", "piddle-inn"];

(async () => {
  let connection;
  try {
    // --- Connect (same mechanism as original) ---
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT,
    });

    console.log("✅ Database connection successful!");
    const [pingRows] = await connection.query("SELECT 1 + 1 AS result;");
    console.log("Ping result:", pingRows);

    // --- Schema checks for multi-property refactor ---
    console.log("\n🔎 Verifying schema for multi-property support...\n");

    // 1) standard_price must have: property_id, value
    const [spCols] = await connection.query(
      "SHOW COLUMNS FROM standard_price;"
    );
    const spColNames = new Set(spCols.map((c) => c.Field));
    const spOk = spColNames.has("property_id") && spColNames.has("value");
    if (!spOk) {
      throw new Error(
        "Table 'standard_price' must contain columns: property_id, value"
      );
    }
    console.log("✅ standard_price has required columns (property_id, value)");

    // 2) date_prices must have: id, property_id, date, price
    const [dpCols] = await connection.query("SHOW COLUMNS FROM date_prices;");
    const dpColNames = new Set(dpCols.map((c) => c.Field));
    const dpOk =
      dpColNames.has("id") &&
      dpColNames.has("property_id") &&
      dpColNames.has("date") &&
      dpColNames.has("price");
    if (!dpOk) {
      throw new Error(
        "Table 'date_prices' must contain columns: id, property_id, date, price"
      );
    }
    console.log(
      "✅ date_prices has required columns (id, property_id, date, price)"
    );

    // 3) date_prices needs UNIQUE(property_id, date)
    const [dpIdx] = await connection.query("SHOW INDEX FROM date_prices;");
    const uniqueComposite = dpIdx
      .filter((row) => row.Non_unique === 0) // unique indexes only
      .reduce((acc, row) => {
        const key = row.Key_name;
        acc[key] = acc[key] || [];
        acc[key][row.Seq_in_index - 1] = row.Column_name;
        return acc;
      }, {});
    const hasCompositeUnique = Object.values(uniqueComposite).some((cols) => {
      return (
        Array.isArray(cols) &&
        cols.length === 2 &&
        cols[0] === "property_id" &&
        cols[1] === "date"
      );
    });
    if (!hasCompositeUnique) {
      throw new Error(
        "Table 'date_prices' must have a UNIQUE index on (property_id, date)"
      );
    }
    console.log("✅ date_prices has UNIQUE(property_id, date)\n");

    // --- Light data probe per property (optional but useful) ---
    for (const pid of PROPERTIES) {
      // standard price
      const [sp] = await connection.query(
        "SELECT value FROM standard_price WHERE property_id = ? LIMIT 1;",
        [pid]
      );
      const stdPrice = sp?.[0]?.value ?? "(none)";
      // date prices count
      const [dpCount] = await connection.query(
        "SELECT COUNT(*) AS cnt FROM date_prices WHERE property_id = ?;",
        [pid]
      );
      const count = dpCount?.[0]?.cnt ?? 0;

      console.log(
        `• ${pid} → standard_price: ${stdPrice}, date_prices rows: ${count}`
      );
    }

    console.log("\n✅ Multi-property schema looks good.\n");
    await connection.end();
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Database test failed:", err.message);
    if (connection) {
      try {
        await connection.end();
      } catch (_) {}
    }
    process.exit(1);
  }
})();

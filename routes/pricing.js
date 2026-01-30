const express = require("express");
const router = express.Router();
const { pool } = require("../db");
const { authenticateToken, requirePropertyAccess } = require("../auth");
const { getValidPropertyId } = require("../config/properties");
const { parseIsoDateOnly } = require("../utils/helpers");

// ---------------------------------------
// GET /api/prices/:propertyId
// Public: Get pricing data
// ---------------------------------------
router.get("/prices/:propertyId", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  try {
    const [standardRows] = await pool.query(
      "SELECT value FROM standard_price WHERE property_id = ? LIMIT 1;",
      [propertyId],
    );
    const standardPrice = parseFloat(standardRows?.[0]?.value ?? 150);

    const [weekendRows] = await pool.query(
      "SELECT value FROM standard_price WHERE property_id = ? LIMIT 1;",
      [propertyId + "_weekend"],
    );
    const weekendPrice = parseFloat(weekendRows?.[0]?.value ?? standardPrice);

    const [dateRows] = await pool.query(
      "SELECT date, price FROM date_prices WHERE property_id = ?;",
      [propertyId],
    );

    // Return as array for frontend compatibility
    const datePrices = dateRows.map((row) => ({
      date: row.date,
      price: parseFloat(row.price),
    }));

    res.json({ standardPrice, weekendPrice, datePrices });
  } catch (err) {
    console.error(`Error fetching prices for ${propertyId}:`, err);
    res.status(500).json({ error: "Error fetching prices" });
  }
});

// ---------------------------------------
// PUT /api/prices/weekend/:propertyId
// Protected: Update weekend price (Fri/Sat)
// ---------------------------------------
router.put(
  "/prices/weekend/:propertyId",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { price } = req.body || {};
    if (price == null) {
      return res.status(400).json({ error: "Price is required" });
    }

    try {
      const weekendPropertyId = propertyId + "_weekend";
      console.log(`Updating weekend price for ${propertyId} to ${price}`);

      const [result] = await pool.query(
        "UPDATE standard_price SET value = ? WHERE property_id = ?;",
        [price, weekendPropertyId],
      );

      if (result.affectedRows === 0) {
        await pool.query(
          "INSERT INTO standard_price (property_id, value) VALUES (?, ?);",
          [weekendPropertyId, price],
        );
      }

      res.json({ message: "Weekend price updated", success: true });
    } catch (err) {
      console.error(`Error updating weekend price for ${propertyId}:`, err);
      res.status(500).json({ error: "Error updating weekend price" });
    }
  },
);

// ---------------------------------------
// DELETE /api/prices/cleanup/:propertyId
// Protected: Delete all prices older than today
// ---------------------------------------
router.delete(
  "/prices/cleanup/:propertyId",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    try {
      const today = parseIsoDateOnly(new Date());
      const [result] = await pool.query(
        "DELETE FROM date_prices WHERE property_id = ? AND date < ?;",
        [propertyId, today],
      );

      console.log(
        `Cleaned up ${result.affectedRows} old prices for ${propertyId}`,
      );
      res.json({
        message: "Old prices cleaned up",
        deletedCount: result.affectedRows,
      });
    } catch (err) {
      console.error(`Error cleaning up prices for ${propertyId}:`, err);
      res.status(500).json({ error: "Error cleaning up prices" });
    }
  },
);

// ---------------------------------------
// DELETE /api/prices/clear-month/:propertyId/:monthYear
// Protected: Delete all custom prices for a specific month
// monthYear format: YYYY-MM
// ---------------------------------------
router.delete(
  "/prices/clear-month/:propertyId/:monthYear",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { monthYear } = req.params;
    if (!monthYear || !/^\d{4}-\d{2}$/.test(monthYear)) {
      return res
        .status(400)
        .json({ error: "Invalid month format. Use YYYY-MM" });
    }

    try {
      // Delete all dates in the specified month
      const [result] = await pool.query(
        "DELETE FROM date_prices WHERE property_id = ? AND DATE_FORMAT(date, '%Y-%m') = ?;",
        [propertyId, monthYear],
      );

      console.log(
        `Cleared ${result.affectedRows} prices for ${monthYear} in ${propertyId}`,
      );
      res.json({
        message: "Month prices cleared",
        deletedCount: result.affectedRows,
      });
    } catch (err) {
      console.error(`Error clearing month for ${propertyId}:`, err);
      res.status(500).json({ error: "Error clearing month prices" });
    }
  },
);

// ---------------------------------------
// PUT /api/prices/standard/:propertyId
// Protected: Update only standard price (leaves date prices unchanged)
// ---------------------------------------
router.put(
  "/prices/standard/:propertyId",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { price } = req.body || {};
    if (price == null) {
      return res.status(400).json({ error: "Price is required" });
    }

    try {
      console.log(`Updating standard price for ${propertyId} to ${price}`);

      // First delete any extra rows for this property (keep data clean)
      await pool.query(
        "DELETE FROM standard_price WHERE property_id = ? AND id NOT IN " +
          "(SELECT * FROM (SELECT MIN(id) FROM standard_price WHERE property_id = ?) AS tmp);",
        [propertyId, propertyId],
      );

      // Then update the remaining row
      const [result] = await pool.query(
        "UPDATE standard_price SET value = ? WHERE property_id = ?;",
        [price, propertyId],
      );

      console.log(`Update result:`, result);

      if (result.affectedRows === 0) {
        // No row existed, insert one
        console.log(`No row found, inserting new one`);
        await pool.query(
          "INSERT INTO standard_price (property_id, value) VALUES (?, ?);",
          [propertyId, price],
        );
      }

      res.json({ message: "Standard price updated", success: true });
    } catch (err) {
      console.error(`Error updating standard price for ${propertyId}:`, err);
      res.status(500).json({ error: "Error updating standard price" });
    }
  },
);

// ---------------------------------------
// PUT /api/prices/:propertyId
// Protected: Update pricing data
// ---------------------------------------
router.put(
  "/prices/:propertyId",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { standardPrice, datePrices } = req.body || {};
    if (standardPrice == null && !datePrices) {
      return res.status(400).json({ error: "No price data provided" });
    }

    try {
      // Update standard price
      if (standardPrice != null) {
        const [result] = await pool.query(
          "UPDATE standard_price SET value = ? WHERE property_id = ?;",
          [standardPrice, propertyId],
        );

        if (result.affectedRows === 0) {
          await pool.query(
            "INSERT INTO standard_price (property_id, value) VALUES (?, ?);",
            [propertyId, standardPrice],
          );
        }
      }

      // Update date-specific prices
      if (datePrices && typeof datePrices === "object") {
        const entries = Object.entries(datePrices);
        for (const [dateStr, price] of entries) {
          await pool.query(
            "INSERT INTO date_prices (date, price, property_id) VALUES (?, ?, ?) " +
              "ON DUPLICATE KEY UPDATE price = ?;",
            [dateStr, price, propertyId, price],
          );
        }
      }

      res.json({ message: "Prices updated" });
    } catch (err) {
      console.error(`Error updating prices for ${propertyId}:`, err);
      res.status(500).json({ error: "Error updating prices" });
    }
  },
);

// ---------------------------------------
// POST /api/prices/date-range/:propertyId
// Protected: Update price for multiple dates at once
// ---------------------------------------
router.post(
  "/prices/date-range/:propertyId",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { dates, price } = req.body || {};
    if (!Array.isArray(dates) || dates.length === 0 || price == null) {
      return res
        .status(400)
        .json({ error: "Dates array and price are required" });
    }

    try {
      // Update all dates with the specified price
      for (const dateStr of dates) {
        await pool.query(
          "INSERT INTO date_prices (date, price, property_id) VALUES (?, ?, ?) " +
            "ON DUPLICATE KEY UPDATE price = ?;",
          [dateStr, price, propertyId, price],
        );
      }

      // Return updated date prices as array
      const [dateRows] = await pool.query(
        "SELECT date, price FROM date_prices WHERE property_id = ?;",
        [propertyId],
      );
      const datePrices = dateRows.map((row) => ({
        date: row.date,
        price: parseFloat(row.price),
      }));

      res.json({ message: "Date prices updated", datePrices });
    } catch (err) {
      console.error(`Error updating date range prices for ${propertyId}:`, err);
      res.status(500).json({ error: "Error updating date prices" });
    }
  },
);

// ---------------------------------------
// DELETE /api/prices/:propertyId/:date
// Protected: Delete a date price
// ---------------------------------------
router.delete(
  "/prices/:propertyId/:date",
  authenticateToken,
  requirePropertyAccess,
  async (req, res) => {
    const propertyId = getValidPropertyId(req, res);
    if (!propertyId) return;

    const { date } = req.params;

    try {
      await pool.query(
        "DELETE FROM date_prices WHERE date = ? AND property_id = ?;",
        [date, propertyId],
      );
      res.json({ message: "Date price deleted" });
    } catch (err) {
      console.error(`Error deleting date price for ${propertyId}:`, err);
      res.status(500).json({ error: "Error deleting date price" });
    }
  },
);

// ---------------------------------------
// POST /api/prices/total/:propertyId
// Public: Calculate total price for date range
// ---------------------------------------
router.post("/prices/total/:propertyId", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  const { startDate, endDate } = req.body || {};

  if (!startDate || !endDate) {
    return res.status(400).json({ error: "startDate and endDate required" });
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start) || isNaN(end)) {
      return res.status(400).json({ error: "Invalid date format" });
    }

    const [standardRows] = await pool.query(
      "SELECT value FROM standard_price WHERE property_id = ? LIMIT 1;",
      [propertyId],
    );
    const standardPrice = parseFloat(standardRows?.[0]?.value ?? 150);

    let current = new Date(start);
    let total = 0;

    while (current <= end) {
      const yyyyMmDd = parseIsoDateOnly(current);

      const [specificRows] = await pool.query(
        "SELECT price FROM date_prices WHERE date = ? AND property_id = ? LIMIT 1;",
        [yyyyMmDd, propertyId],
      );
      const specific = specificRows?.[0]?.price;

      total += specific != null ? parseFloat(specific) : standardPrice;
      current.setDate(current.getDate() + 1);
    }

    res.json({ total });
  } catch (err) {
    console.error(`Error calculating total price for ${propertyId}:`, err);
    res.status(500).json({ error: "Error calculating total price" });
  }
});

module.exports = router;

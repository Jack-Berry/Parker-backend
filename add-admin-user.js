// add-admin-user.js
// Script to add a new admin user to the database
// Usage: node add-admin-user.js

require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("./db");

async function addAdminUser() {
  // ===== CONFIGURE NEW USER HERE =====
  const username = "admin-newproperty";
  const password = "change_this_password";
  const propertyId = "new-property-slug";
  const displayName = "New Property Admin";
  // ===================================

  try {
    console.log("\n=== Adding New Admin User ===\n");

    // Check if username already exists
    const [existing] = await pool.query(
      "SELECT username FROM admin_users WHERE username = ?",
      [username],
    );

    if (existing.length > 0) {
      console.error(`❌ Error: Username '${username}' already exists!`);
      process.exit(1);
    }

    // Check if property exists
    const [propertyExists] = await pool.query(
      "SELECT id FROM properties WHERE id = ?",
      [propertyId],
    );

    if (propertyExists.length === 0) {
      console.warn(
        `⚠️  Warning: Property '${propertyId}' not found in properties table`,
      );
      console.warn(
        `   Make sure to add it to the properties table if needed\n`,
      );
    }

    // Hash the password
    console.log("🔒 Hashing password...");
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user
    console.log("💾 Inserting user into database...");
    const [result] = await pool.query(
      `INSERT INTO admin_users (username, password, property_id, display_name) 
       VALUES (?, ?, ?, ?)`,
      [username, passwordHash, propertyId, displayName],
    );

    console.log("\n✅ Admin user created successfully!\n");
    console.log("-----------------------------------");
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    console.log(`Property ID: ${propertyId}`);
    console.log(`Display Name: ${displayName}`);
    console.log(`Database ID: ${result.insertId}`);
    console.log("-----------------------------------\n");
    console.log(
      "⚠️  IMPORTANT: Save these credentials securely and change the password!\n",
    );

    process.exit(0);
  } catch (err) {
    console.error("❌ Error adding admin user:", err.message);
    process.exit(1);
  }
}

addAdminUser();

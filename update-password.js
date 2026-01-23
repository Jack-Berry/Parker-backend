// update-password.js
// Script to update an existing admin user's password
// Usage: node update-password.js

require("dotenv").config();
const bcrypt = require("bcrypt");
const { pool } = require("./db");

async function updatePassword() {
  // ===== CONFIGURE HERE =====
  const username = "Lucy";
  const newPassword = "Clowes1234!";
  // ==========================

  try {
    console.log("\n=== Updating Admin Password ===\n");

    // Check if user exists
    const [existing] = await pool.query(
      "SELECT id, username, display_name FROM admin_users WHERE username = ?",
      [username],
    );

    if (existing.length === 0) {
      console.error(`❌ Error: User '${username}' not found!`);
      process.exit(1);
    }

    const user = existing[0];
    console.log(`Found user: ${user.display_name} (${user.username})`);

    // Hash new password
    console.log("🔒 Hashing new password...");
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    console.log("💾 Updating password in database...");
    await pool.query("UPDATE admin_users SET password = ? WHERE id = ?", [
      passwordHash,
      user.id,
    ]);

    console.log("\n✅ Password updated successfully!\n");
    console.log("-----------------------------------");
    console.log(`Username: ${username}`);
    console.log(`New Password: ${newPassword}`);
    console.log("-----------------------------------\n");
    console.log("⚠️  IMPORTANT: Save this password securely!\n");

    process.exit(0);
  } catch (err) {
    console.error("❌ Error updating password:", err.message);
    process.exit(1);
  }
}

updatePassword();

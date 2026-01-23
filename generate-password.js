// generate-password.js
// Run this to generate bcrypt hashes for your admin passwords
// Usage: node generate-password.js

const bcrypt = require("bcrypt");

async function generateHash(label, password) {
  const saltRounds = 10;
  const hash = await bcrypt.hash(password, saltRounds);
  console.log("\n-----------------------------------");
  console.log(`${label}`);
  console.log("-----------------------------------");
  console.log(`Password: ${password}`);
  console.log(`Hash: ${hash}`);
  console.log("-----------------------------------\n");
}

async function main() {
  console.log("\n=== PASSWORD HASH GENERATOR ===\n");
  console.log("Replace the passwords below with your desired passwords,");
  console.log("then run: node generate-password.js\n");

  // CHANGE THESE TO YOUR DESIRED PASSWORDS
  const preswylfa_password = "Clowes1234!";
  const piddle_password = "Herewego01*";

  await generateHash("PRESWYLFA ADMIN", preswylfa_password);
  await generateHash("PIDDLE INN ADMIN", piddle_password);

  console.log("Copy the hashes above into auth.js");
  console.log("Update the password field for each user object\n");
}

main().catch(console.error);

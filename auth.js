const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Mocked user data with a properly hashed password
// Hash the password using bcrypt.hash("admin123", 10) and replace the value below
const users = [
  {
    id: 1,
    username: "admin",
    password: "$2b$10$gHmamOyvsBKmM21nwHKLqelt0ehLjQuWCQLzCLF9lpzYVM453CoTO", // Replace with the actual hashed password
  },
];

// Function to hash a new password (you can use this when creating or updating a user)
const hashPassword = async (password) => {
  const saltRounds = 10; // Adjust the salt rounds for desired security and performance
  return await bcrypt.hash(password, saltRounds);
};

// Login route
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = users.find((u) => u.username === username);

  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  try {
    // Verify the password using bcrypt.compare
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Generate a JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );
    res.json({ token });
  } catch (error) {
    console.error("Error verifying password:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Middleware for token validation
const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access denied" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
};

module.exports = { router, authenticateToken, hashPassword };

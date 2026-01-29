// emailService.js
// Centralized mail transport — multi-property friendly with per-property credentials
// -------------------------------------------------------------------------
const nodemailer = require("nodemailer");

/**
 * Sends an email using property-specific credentials.
 *
 * @param {string|string[]} to - Recipient email(s)
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @param {string} [replyTo] - Reply-to email address
 * @param {string} [emailUser] - Property-specific email user (optional, falls back to env)
 * @param {string} [emailPass] - Property-specific email password (optional, falls back to env)
 * @param {string} [propertyName] - Property display name for "From" field
 */
const sendEmail = async (
  to,
  subject,
  html,
  replyTo,
  emailUser,
  emailPass,
  propertyName,
) => {
  // Use property-specific credentials if provided, otherwise fall back to global env vars
  const user = emailUser || process.env.EMAIL_USER;
  const pass = emailPass || process.env.EMAIL_PASS;
  const displayName = propertyName || "Holiday Homes & Lets";

  // Create transporter with property-specific or default credentials
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, // e.g., mail.holidayhomesandlets.co.uk
    port: 465, // Secure SSL/TLS port
    secure: true, // Use SSL
    auth: {
      user,
      pass,
    },
  });

  try {
    const info = await transporter.sendMail({
      from: `"${displayName}" <${user}>`,
      to,
      replyTo,
      subject,
      html,
    });
    console.log(`Email sent: ${info.messageId} (from: ${user})`);
  } catch (error) {
    console.error("Error sending email:", error);
    throw error; // Re-throw so caller knows it failed
  }
};

module.exports = { sendEmail };

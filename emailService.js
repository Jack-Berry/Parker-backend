// emailService.js
// Centralized mail transport — multi-property friendly, backward compatible
// -------------------------------------------------------------------------
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, // e.g., mail.holidayhomesandlets.co.uk
  port: 465, // Secure SSL/TLS port
  secure: true, // Use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Sends an email using the configured transporter.
 *
 * Backward compatible signature:
 *   sendEmail(to, subject, html, replyTo)
 *
 * Optional 5th arg for multi-property branding:
 *   sendEmail(to, subject, html, replyTo, propertyName)
 *
 * @param {string|string[]} to
 * @param {string} subject
 * @param {string} html
 * @param {string} [replyTo]
 * @param {string} [propertyName]  // optional display name for From:
 */
const sendEmail = async (to, subject, html, replyTo, propertyName) => {
  // Default sender display name remains your original
  const displayName = propertyName || "Bwthyn Preswylfa";

  try {
    const info = await transporter.sendMail({
      from: `"${displayName}" <${process.env.EMAIL_USER}>`,
      to,
      replyTo,
      subject,
      html,
    });
    console.log(`Email sent: ${info.messageId}`);
  } catch (error) {
    console.error("Error sending email:", error);
  }
};

module.exports = { sendEmail };

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST, // mail.holidayhomesandlets.co.uk
  port: 465, // Secure SSL/TLS port
  secure: true, // Use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Sends an email using the configured transporter.
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email content in HTML format
 */
const sendEmail = async (to, subject, html, replyTo) => {
  try {
    const info = await transporter.sendMail({
      from: `"Bwthyn Preswylfa" <${process.env.EMAIL_USER}>`, // Sender's address
      to, // Recipient's address
      replyTo, // The email address to reply to
      subject, // Subject line
      html, // HTML body content
    });
    console.log(`Email sent: ${info.messageId}`);
  } catch (error) {
    console.error("Error sending email:", error);
  }
};

module.exports = { sendEmail };

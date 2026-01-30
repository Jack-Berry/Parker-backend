const express = require("express");
const router = express.Router();
const { sendEmail } = require("../emailService");
const {
  getPropertyConfig,
  getValidPropertyId,
} = require("../config/properties");

// ---------------------------------------
// POST /api/contact/:propertyId
// Send contact form message to property admin
// ---------------------------------------
router.post("/contact/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  const { name, email, telephone, message } = req.body || {};
  if (!name || !email || !message) {
    return res
      .status(400)
      .json({ error: "name, email, and message are required" });
  }

  try {
    const propertyCfg = getPropertyConfig(propertyId);

    const html = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Contact Form Submission - ${propertyCfg.displayName}</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Telephone:</strong> ${telephone || "—"}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      </div>
    `;

    await sendEmail(
      propertyCfg.adminEmail,
      `New Contact Form Message - ${propertyCfg.displayName}`,
      html,
      email, // replyTo
      propertyCfg.emailUser, // emailUser
      propertyCfg.emailPass, // emailPass
      propertyCfg.displayName, // propertyName
    );

    res.status(200).json({ message: "Message sent" });
  } catch (err) {
    console.error(`Error sending contact email for ${propertyId}:`, err);
    res.status(500).json({ error: "Failed to send message" });
  }
});

module.exports = router;

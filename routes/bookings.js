const express = require("express");
const router = express.Router();
const { sendEmail } = require("../emailService");
const { getPropertyConfig, getValidPropertyId } = require("../config/properties");

// ---------------------------------------
// POST /api/send-booking-emails/:propertyId
// Send booking confirmation emails to customer and admin
// ---------------------------------------
router.post("/send-booking-emails/:propertyId?", async (req, res) => {
  const propertyId = getValidPropertyId(req, res);
  if (!propertyId) return;

  const {
    name,
    email,
    numberOfPeople,
    numberOfPets,
    telephone,
    message,
    startDate,
    endDate,
    totalPrice,
  } = req.body || {};

  try {
    const propertyCfg = getPropertyConfig(propertyId);
    const { displayName, logoUrl } = propertyCfg;
    
    // Format dates (DD/MM/YYYY)
    const formatDdMmYyyy = (dateString) => {
      const d = new Date(dateString);
      return [
        String(d.getDate()).padStart(2, "0"),
        String(d.getMonth() + 1).padStart(2, "0"),
        d.getFullYear(),
      ].join("/");
    };
    
    const formattedStart = formatDdMmYyyy(startDate);
    const formattedEnd = formatDdMmYyyy(endDate);
    const safeTotal = Number.isFinite(Number(totalPrice))
      ? Number(totalPrice).toFixed(2)
      : "—";

    const customerEmailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 5px; background-color: #f9f9f9;">
        <div style="text-align: center; padding-bottom: 20px;">
          <div style="background-color: #000; display: inline-block; padding: 10px; border-radius: 5px;">
            <img src="${logoUrl}" alt="Holiday Homes Logo" width="200" />
          </div>
        </div>
        <h2>Booking Request Received - ${displayName}</h2>
        <p>Dear <strong>${name || "Guest"}</strong>,</p>
        <p>Thank you for your booking request for <strong>${displayName}</strong>! We are reviewing your details and will confirm shortly.</p>
        <h3>Booking Details</h3>
        <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Property</strong></td><td style="padding:8px;border:1px solid #ddd">${displayName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedStart}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedEnd}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Guests</strong></td><td style="padding:8px;border:1px solid #ddd">${numberOfPeople ?? "—"}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Pets</strong></td><td style="padding:8px;border:1px solid #ddd">${numberOfPets ?? "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Total</strong></td><td style="padding:8px;border:1px solid #ddd">£${safeTotal}</td></tr>
        </table>
       <p>If you have questions, email <a href="mailto:${propertyCfg.adminEmail}">${propertyCfg.adminEmail}</a>.</p>
        <div style="text-align:center; margin-top:20px">
          <a href="https://holidayhomesandlets.co.uk" style="background:#008CBA;color:#fff;padding:10px 15px;text-decoration:none;border-radius:5px">Visit Our Website</a>
        </div>
      </div>
    `;

    const adminEmailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border-radius: 5px; background-color: #f9f9f9;">
        <div style="text-align: center; padding-bottom: 20px;">
          <div style="background-color: #000; display: inline-block; padding: 10px; border-radius: 5px;">
            <img src="${logoUrl}" alt="Holiday Homes Logo" width="200" />
          </div>
        </div>
        <h2>New Booking Request - ${displayName}</h2>
        <h3>Booking Details</h3>
        <table style="width:100%; border-collapse: collapse; margin-top: 10px;">
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Property</strong></td><td style="padding:8px;border:1px solid #ddd">${displayName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Name</strong></td><td style="padding:8px;border:1px solid #ddd">${name || "—"}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Email</strong></td><td style="padding:8px;border:1px solid #ddd">${email || "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Phone</strong></td><td style="padding:8px;border:1px solid #ddd">${telephone || "—"}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Check-in</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedStart}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Check-out</strong></td><td style="padding:8px;border:1px solid #ddd">${formattedEnd}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Guests</strong></td><td style="padding:8px;border:1px solid #ddd">${numberOfPeople ?? "—"}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd"><strong>Pets</strong></td><td style="padding:8px;border:1px solid #ddd">${numberOfPets ?? "—"}</td></tr>
          <tr style="background:#eee"><td style="padding:8px;border:1px solid #ddd"><strong>Total</strong></td><td style="padding:8px;border:1px solid #ddd">£${safeTotal}</td></tr>
        </table>
        <p><strong>Message from customer:</strong></p>
        <p>${message || "—"}</p>
      </div>
    `;

    await Promise.all([
      // Email to customer
      sendEmail(
        email,
        `Your Booking Request Confirmation - ${displayName}`,
        customerEmailHtml,
        propertyCfg.emailUser, // replyTo
        propertyCfg.emailUser, // emailUser
        propertyCfg.emailPass, // emailPass
        displayName, // propertyName
      ),
      // Email to admin/owner
      sendEmail(
        propertyCfg.adminEmail,
        `New Booking Request - ${displayName}`,
        adminEmailHtml,
        email, // replyTo (customer email)
        propertyCfg.emailUser, // emailUser
        propertyCfg.emailPass, // emailPass
        displayName, // propertyName
      ),
    ]);

    res.status(200).json({ message: "Emails sent successfully" });
  } catch (error) {
    console.error(`Error sending booking emails for ${propertyId}:`, error);
    res.status(500).json({ error: "Failed to send emails" });
  }
});

module.exports = router;

const nodemailer = require("nodemailer");
const dns = require("dns").promises;

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

let cachedTransporter = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // re-resolve every 10 min in case Gmail rotates IPs

// Resolves smtp.gmail.com to a real IPv4 address and connects directly
// to that IP — this makes an IPv6 connection attempt structurally
// impossible, sidestepping whatever is causing nodemailer/Node to still
// prefer IPv6 despite family:4 and dns.setDefaultResultOrder.
const getTransporter = async () => {
  const now = Date.now();
  if (cachedTransporter && now - cachedAt < CACHE_TTL_MS) {
    return cachedTransporter;
  }

  const addresses = await dns.resolve4(SMTP_HOST);
  const ipv4Address = addresses[0];

  cachedTransporter = nodemailer.createTransport({
    host: ipv4Address,
    port: SMTP_PORT,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
    tls: {
      // Required when connecting to a bare IP instead of a hostname —
      // otherwise TLS certificate hostname verification fails, since the
      // cert is issued for "smtp.gmail.com", not the IP literal.
      servername: SMTP_HOST,
    },
    connectionTimeout: 10000,
  });
  cachedAt = now;

  return cachedTransporter;
};

const sendPasswordEmail = async ({ to, fullname, password }) => {
  const transporter = await getTransporter();
  await transporter.sendMail({
    from: `"Smart Waste Management" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your Household Account Credentials",
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #16a34a;">Welcome, ${fullname}!</h2>
        <p>Your household has been successfully registered in the <strong>Smart Waste Management System</strong>.</p>
        <p>Here are your login credentials:</p>
        <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <p style="margin: 0;"><strong>Email:</strong> ${to}</p>
          <p style="margin: 8px 0 0;"><strong>Password:</strong> <span style="font-size: 18px; color: #16a34a; font-weight: bold;">${password}</span></p>
        </div>
        <p style="color: #6b7280; font-size: 13px;">Please keep your password safe. You can change it after logging in.</p>
      </div>
    `,
  });
};

const sendResetCodeEmail = async ({ to, code }) => {
  const transporter = await getTransporter();
  const expiryMinutes = process.env.RESET_CODE_EXPIRY_MINUTES || 10;

  await transporter.sendMail({
    from: `"Smart Waste Management" <${process.env.GMAIL_USER}>`,
    to,
    subject: "Your password reset code",
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="color: #16a34a;">Reset your password</h2>
        <p>Use the code below to reset your password. It expires in ${expiryMinutes} minutes.</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; background: #f3f4f6; padding: 16px; text-align: center; border-radius: 8px;">
          ${code}
        </p>
        <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};

module.exports = { getTransporter, sendPasswordEmail, sendResetCodeEmail };
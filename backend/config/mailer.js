const nodemailer = require("nodemailer");

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000; // 1s, 2s, 4s

let cachedTransporter = null;
let cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Builds a transporter using the hostname directly. We rely on:
//  - dns.setDefaultResultOrder("ipv4first") (set once, globally, in server.js)
//  - family: 4 here, forcing the socket to prefer IPv4
// instead of manually resolving the A record ourselves. That manual
// dns.resolve4() step was itself a single point of failure — if the
// DNS query failed (as in the "queryA ECONNREFUSED" incident), the
// entire mailer broke even though SMTP itself was never the problem.
// Letting Node's normal connection-time resolution handle it is more
// resilient, especially during cold starts on hosts like Render.
const buildTransporter = () =>
  nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    family: 4,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
  });

const getTransporter = async () => {
  const now = Date.now();
  if (cachedTransporter && now - cachedAt < CACHE_TTL_MS) {
    return cachedTransporter;
  }
  cachedTransporter = buildTransporter();
  cachedAt = now;
  return cachedTransporter;
};

// Drop the cached transporter so the next attempt builds a fresh one
// instead of retrying against a connection/socket that just failed.
const invalidateTransporter = () => {
  cachedTransporter = null;
  cachedAt = 0;
};

// Runs `fn(transporter)` with retry + exponential backoff. On any
// failure, the cached transporter is invalidated so the next attempt
// (in this loop, or a future request) doesn't keep reusing a dead
// connection — this is what actually fixes the cold-start race:
// instead of one shot that can lose the race against DNS/network
// coming up, we get up to 3 tries spread over ~7 seconds.
const withRetry = async (fn) => {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const transporter = await getTransporter();
      return await fn(transporter);
    } catch (err) {
      lastErr = err;
      invalidateTransporter();
      if (attempt === RETRY_ATTEMPTS) break;
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[Mailer] Attempt ${attempt}/${RETRY_ATTEMPTS} failed (${err.message}). Retrying in ${delay}ms...`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
};

const verifyMailer = () => withRetry((transporter) => transporter.verify());

const sendPasswordEmail = async ({ to, fullname, password }) => {
  await withRetry((transporter) =>
    transporter.sendMail({
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
    })
  );
};

const sendResetCodeEmail = async ({ to, code }) => {
  const expiryMinutes = process.env.RESET_CODE_EXPIRY_MINUTES || 10;

  await withRetry((transporter) =>
    transporter.sendMail({
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
    })
  );
};

module.exports = { getTransporter: verifyMailer, sendPasswordEmail, sendResetCodeEmail };
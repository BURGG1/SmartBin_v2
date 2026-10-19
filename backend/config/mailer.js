
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const BREVO_ACCOUNT_URL = "https://api.brevo.com/v3/account";

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getBrevoConfig = () => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName =
    process.env.BREVO_SENDER_NAME || "Smart Waste Management";

  if (!apiKey || !senderEmail) {
    throw new Error(
      "Missing BREVO_API_KEY or BREVO_SENDER_EMAIL environment variable"
    );
  }

  return { apiKey, senderEmail, senderName };
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[char];
  });

const requestBrevo = async (url, options) => {
  const { apiKey } = getBrevoConfig();

  return fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "api-key": apiKey,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
};

// Retry transient connection errors and server errors.
// Do not retry invalid credentials or invalid request data.
const withRetry = async (fn) => {
  let lastError;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (err.permanent || attempt === RETRY_ATTEMPTS) {
        break;
      }

      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

      console.warn(
        `[Mailer] Attempt ${attempt}/${RETRY_ATTEMPTS} failed ` +
          `(${err.message}). Retrying in ${delay}ms...`
      );

      await sleep(delay);
    }
  }

  throw lastError;
};

// Keep the existing function name used by server.js.
// This verifies the API key with Brevo, not email delivery.
const verifyMailer = async () => {
  getBrevoConfig();

  return withRetry(async () => {
    const response = await requestBrevo(BREVO_ACCOUNT_URL, {
      method: "GET",
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const error = new Error(
        result.message || `Brevo verification failed (${response.status})`
      );

      if ([400, 401, 403, 404].includes(response.status)) {
        error.permanent = true;
      }

      throw error;
    }

    console.log("[Mailer] Brevo API connection verified.");
    return true;
  });
};

const sendBrevoEmail = async ({ to, subject, html }) => {
  const { senderEmail, senderName } = getBrevoConfig();

  // Avoid automatic retries of an email POST after a timeout:
  // Brevo may already have accepted the message before the timeout.
  const response = await requestBrevo(BREVO_API_URL, {
    method: "POST",
    body: JSON.stringify({
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    console.error(
      "[Mailer] Brevo rejected email:",
      response.status,
      result.message || "Unknown error"
    );

    throw new Error(
      result.message || `Brevo email request failed (${response.status})`
    );
  }

  console.log("[Mailer] Email accepted by Brevo:", result.messageId);
  return result;
};

const sendPasswordEmail = async ({ to, fullname, password }) => {
  const safeFullname = escapeHtml(fullname);
  const safeEmail = escapeHtml(to);
  const safePassword = escapeHtml(password);

  return sendBrevoEmail({
    to,
    subject: "Your Household Account Credentials",
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2 style="color:#16a34a;">Welcome, ${safeFullname}!</h2>
        <p>Your household has been successfully registered in the <strong>Smart Waste Management System</strong>.</p>
        <p>Here are your login credentials:</p>
        <div style="background:#f3f4f6;padding:16px;border-radius:8px;margin:16px 0;">
          <p style="margin:0;"><strong>Email:</strong> ${safeEmail}</p>
          <p style="margin:8px 0 0;"><strong>Password:</strong>
            <span style="font-size:18px;color:#16a34a;font-weight:bold;">${safePassword}</span>
          </p>
        </div>
        <p style="color:#6b7280;font-size:13px;">Please keep your password safe. You can change it after logging in.</p>
      </div>
    `,
  });
};

const sendResetCodeEmail = async ({ to, code }) => {
  const expiryMinutes = Number(
    process.env.RESET_CODE_EXPIRY_MINUTES || 10
  );

  return sendBrevoEmail({
    to,
    subject: "Your password reset code",
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2 style="color:#16a34a;">Reset your password</h2>
        <p>Use the code below to reset your password. It expires in ${expiryMinutes} minutes.</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px;background:#f3f4f6;padding:16px;text-align:center;border-radius:8px;">
          ${escapeHtml(code)}
        </p>
        <p style="color:#6b7280;font-size:13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
};

module.exports = {
  getTransporter: verifyMailer,
  sendPasswordEmail,
  sendResetCodeEmail,
};


const UNISMS_API_URL = "https://unismsapi.com/api/sms";

/**
 * Normalize Philippine mobile numbers into +639XXXXXXXXX.
 *
 * Accepted examples:
 * 09171234567
 * 9171234567
 * 639171234567
 * +639171234567
 */
const normalizePhilippinePhone = (input) => {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A recipient phone number is required.");
  }

  let digits = input.replace(/\D/g, "");

  if (digits.startsWith("63") && digits.length === 12) {
    digits = digits.slice(2);
  }

  if (digits.length === 10 && digits.startsWith("9")) {
    digits = "0" + digits;
  }

  if (!/^09\d{9}$/.test(digits)) {
    throw new Error(
      "Invalid Philippine mobile number. Use 09XXXXXXXXX or +639XXXXXXXXX."
    );
  }

  return "+63" + digits.slice(1);
};

/**
 * Send an SMS using UniSMS.
 *
 * Required .env variables:
 * UNISMS_SECRET_KEY
 * UNISMS_SENDER_ID
 *
 * Node.js 18+ is recommended for built-in fetch.
 */
const sendUniSms = async ({ to, message, metadata = {} }) => {
  const secretKey = process.env.UNISMS_SECRET_KEY;
  const senderId = process.env.UNISMS_SENDER_ID;

  if (!secretKey) {
    throw new Error("UNISMS_SECRET_KEY is not configured.");
  }

  if (!senderId) {
    throw new Error("UNISMS_SENDER_ID is not configured.");
  }

  if (typeof message !== "string" || !message.trim()) {
    throw new Error("SMS message cannot be empty.");
  }

  if (message.length > 670) {
    throw new Error("SMS message exceeds the 670-character limit.");
  }

  const recipient = normalizePhilippinePhone(to);

  // UniSMS uses HTTP Basic Authentication:
  // username = secret key; password = empty.
  const authorization = Buffer.from(`${secretKey}:`).toString("base64");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(UNISMS_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient,
        content: message,
        sender_id: senderId,
        ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
      }),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[UniSMS] Request failed:", {
        httpStatus: response.status,
        response: result,
      });

      throw new Error(
        result.message ||
          result.error ||
          `UniSMS returned HTTP ${response.status}.`
      );
    }

    const sms = result.message || result;

    console.log("[UniSMS] SMS request accepted:", {
      recipient,
      status: sms.status,
      reference_id: sms.reference_id,
    });

    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("UniSMS request timed out after 15 seconds.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Send the initial password after household registration.
 */
const sendInitialPasswordSms = ({ to, fullname, password }) => {
  return sendUniSms({
    to,
    message:
      `Hello ${fullname}, your SmartBin account has been created. ` +
      `Your initial password is ${password}. ` +
      `Please log in and change it immediately.`,
    metadata: {
      purpose: "household_initial_password",
    },
  });
};

/**
 * Send the password-reset code.
 */
const sendResetCodeSms = ({ to, code }) => {
  const expiryMinutes = Number(
    process.env.RESET_CODE_EXPIRY_MINUTES || 10
  );

  return sendUniSms({
    to,
    message:
      `SmartBin password reset code: ${code}. ` +
      `This code expires in ${expiryMinutes} minutes. ` +
      `Do not share it with anyone.`,
    metadata: {
      purpose: "password_reset",
    },
  });
};

module.exports = {
  normalizePhilippinePhone,
  sendUniSms,
  sendInitialPasswordSms,
  sendResetCodeSms,
};


const TEXTBEE_API_URL =
  "https://api.textbee.dev/api/v1/gateway/send-sms";

/**
 * Normalize common Philippine mobile formats to +639XXXXXXXXX.
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
    digits = "0" + digits.slice(2);
  } else if (digits.length === 10 && digits.startsWith("9")) {
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
 * Send SMS using TextBee.
 *
 * Required environment variable:
 * TEXTBEE_API_KEY
 *
 * Optional environment variable:
 * TEXTBEE_DEVICE_ID
 */
const sendTextBeeSms = async ({ to, message }) => {
  const apiKey = process.env.TEXTBEE_API_KEY;
  const deviceId = process.env.TEXTBEE_DEVICE_ID;

  if (!apiKey) {
    throw new Error("TEXTBEE_API_KEY is not configured.");
  }

  if (typeof message !== "string" || !message.trim()) {
    throw new Error("SMS message cannot be empty.");
  }

  const recipient = normalizePhilippinePhone(to);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(TEXTBEE_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipients: [recipient],
        message: message.trim(),
        ...(deviceId ? { deviceId } : {}),
      }),
      signal: controller.signal,
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("[TextBee] Request failed:", {
        httpStatus: response.status,
        error: result?.message || result?.error || "Unknown API error",
      });

      throw new Error(
        result?.message ||
          result?.error ||
          `TextBee returned HTTP ${response.status}`
      );
    }

    console.log("[TextBee] SMS request accepted:", {
      recipient,
      smsBatchId: result?.data?.smsBatchId || result?.smsBatchId,
      recipientCount:
        result?.data?.recipientCount || result?.recipientCount,
    });

    return result;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("TextBee request timed out after 20 seconds.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Send initial household account credentials.
 */
const sendInitialPasswordSms = ({ to, fullname, password }) => {
  return sendTextBeeSms({
    to,
    message:
      `Hello ${fullname}, your SmartBin account has been created. ` +
      `Your initial password is ${password}. ` +
      "Please log in and change it immediately.",
  });
};

/**
 * Send password-reset verification code.
 */
const sendResetCodeSms = ({ to, code }) => {
  const expiryMinutes = Number(
    process.env.RESET_CODE_EXPIRY_MINUTES || 10
  );

  return sendTextBeeSms({
    to,
    message:
      `SmartBin password reset code: ${code}. ` +
      `This code expires in ${expiryMinutes} minutes. ` +
      "Do not share it with anyone.",
  });
};

module.exports = {
  normalizePhilippinePhone,
  sendTextBeeSms,

  // Compatibility alias for any older imports.
  sendUniSms: sendTextBeeSms,

  sendInitialPasswordSms,
  sendResetCodeSms,
};

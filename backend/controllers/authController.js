const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const Household = require("../models/Household");
const Collector = require("../models/Collector");
const Admin = require("../models/Admin");

const { findAccountByEmail } = require("../utils/accountLookup");
const { sendResetCodeEmail } = require("../config/mailer");
const { sendResetCodeSms } = require("../config/sms");

const generateToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: "12h",
  });
};

// POST /api/auth/login

const login = async (req, res) => {
  try {
    // Support the new "identifier" field and legacy "email" requests.
    const { identifier, email, password } = req.body;
    const loginValue = String(identifier ?? email ?? "").trim();

    if (!loginValue || !password) {
      return res.status(400).json({
        success: false,
        message: "Email or phone number and password are required.",
      });
    }

    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginValue);

    // Email is case-insensitive. Phone numbers are matched as stored.
    const normalizedValue = isEmail
      ? loginValue.toLowerCase()
      : loginValue;

    // 1. Admin login: email only.
    if (isEmail) {
      const admin = await Admin.findOne({
        email: normalizedValue,
        isActive: true,
      });

      if (admin) {
        const isMatch = await bcrypt.compare(password, admin.password);

        if (!isMatch) {
          return res.status(401).json({
            success: false,
            message: "Incorrect password.",
          });
        }

        const token = generateToken({
          id: admin._id,
          role: "admin",
          email: admin.email,
        });

        return res.json({
          success: true,
          role: "admin",
          token,
          user: {
            id: admin._id,
            name: admin.name,
            email: admin.email,
            role: "admin",
          },
        });
      }
    }

    // 2. Collector login: email or registered contact number.
    const collector = await Collector.findOne({
      ...(isEmail
        ? { email: normalizedValue }
        : { contact: normalizedValue }),
      isActive: true,
    });

    if (collector) {
      const isMatch = await bcrypt.compare(
        password,
        collector.password
      );

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Incorrect password.",
        });
      }

      const token = generateToken({
        id: collector._id,
        role: "collector",
        email: collector.email,
      });

      return res.json({
        success: true,
        role: "collector",
        token,
        user: {
          id: collector._id,
          name: collector.name,
          employeeId: collector.employeeId,
          assignedBarangay: collector.assignedBarangay,
          contact: collector.contact,
          email: collector.email,
          totalCollections: collector.totalCollections,
          role: "collector",
        },
      });
    }

    // 3. Household login: email or registered contact number.
    const household = await Household.findOne({
      ...(isEmail
        ? { email: normalizedValue }
        : { contactNumber: normalizedValue }),
      isActive: true,
    });

    if (!household) {
      return res.status(401).json({
        success: false,
        message: "No active account found with that email or phone number.",
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      household.password
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password.",
      });
    }

    const token = generateToken({
      id: household._id,
      role: "household",
      email: household.email,
    });

    return res.json({
      success: true,
      role: "household",
      token,
      user: {
        id: household._id,
        fullname: household.fullname,
        email: household.email,
        contactNumber: household.contactNumber,
        address: household.address,
        rfid: household.rfid,
        role: "household",
      },
    });
  } catch (error) {
    console.error("[LOGIN] Error:", error);

    return res.status(500).json({
      success: false,
      message: "An error occurred during login.",
    });
  }
};


// ------------------------------------------------------------
// Forgot / Reset Password
// ------------------------------------------------------------

const CODE_LENGTH = Number(
  process.env.RESET_CODE_LENGTH || 6
);

const CODE_EXPIRY_MS =
  Number(process.env.RESET_CODE_EXPIRY_MINUTES || 10) *
  60 *
  1000;

const MAX_VERIFY_ATTEMPTS = 5;

const LOCK_DURATION_MS = 15 * 60 * 1000;

const GENERIC_INVALID_MESSAGE =
  "Invalid or expired code. Please try again.";

const isValidEmail = (value) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(value || "").trim()
  );

function generateNumericCode(length) {
  if (!Number.isInteger(length) || length < 4 || length > 9) {
    throw new Error(
      "RESET_CODE_LENGTH must be between 4 and 9."
    );
  }

  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;

  return String(crypto.randomInt(min, max + 1));
}

// HMAC protects short-lived reset codes using a server-side secret.
function hashCode(code) {
  const secret = process.env.RESET_CODE_SECRET;

  if (!secret) {
    throw new Error(
      "RESET_CODE_SECRET is not configured in .env."
    );
  }

  return crypto
    .createHmac("sha256", secret)
    .update(code)
    .digest("hex");
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const { email, method } = req.body;

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const account = await findAccountByEmail(normalizedEmail);

    // Avoid revealing whether an email is registered.
    if (!account) {
      return res.json({
        success: true,
        message:
          "If an account exists, password reset instructions will be sent.",
      });
    }

    const { user, role } = account;

    if (
      !user ||
      !user._id ||
      !["admin", "collector", "household"].includes(role)
    ) {
      console.error(
        "[FORGOT PASSWORD] Unexpected account lookup result."
      );

      return res.status(500).json({
        success: false,
        message: "Unable to process the password reset request.",
      });
    }

    const code = generateNumericCode(CODE_LENGTH);
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MS);

    // Persist reset information on the account.
    user.resetPasswordCodeHash = codeHash;
    user.resetPasswordExpires = expiresAt;
    user.resetPasswordAttempts = 0;
    user.resetPasswordLockedUntil = null;

    await user.save();

    const deliveryMethod =
      String(method || "email").toLowerCase();

    try {
      if (deliveryMethod === "sms") {
        const phone =
          user.contactNumber || user.contact;

        if (!phone) {
          throw new Error(
            "No phone number is registered for this account."
          );
        }

        await sendResetCodeSms({
          to: phone,
          code,
        });
      } else if (deliveryMethod === "email") {
        await sendResetCodeEmail({
          to: user.email,
          code,
        });
      } else {
        return res.status(400).json({
          success: false,
          message:
            "Invalid delivery method. Use email or sms.",
        });
      }
    } catch (deliveryError) {
      // Remove the code if delivery failed.
      user.resetPasswordCodeHash = undefined;
      user.resetPasswordExpires = undefined;
      user.resetPasswordAttempts = 0;
      user.resetPasswordLockedUntil = undefined;

      await user.save().catch((saveError) => {
        console.error(
          "[FORGOT PASSWORD] Failed to clear reset code:",
          saveError.message
        );
      });

      console.error(
        "[FORGOT PASSWORD] Delivery failed:",
        deliveryError.message
      );

      return res.status(502).json({
        success: false,
        message:
          "Unable to send the reset code. Please try again later.",
      });
    }

    return res.json({
      success: true,
      message:
        "If an account exists, password reset instructions will be sent.",
    });
  } catch (error) {
    console.error("[FORGOT PASSWORD] Error:", error);

    return res.status(500).json({
      success: false,
      message:
        "An error occurred while requesting a password reset.",
    });
  }
};

// POST /api/auth/verify-reset-code
const verifyResetCode = async (req, res) => {
  try {
    const { email, code } = req.body;

    if (
      !email ||
      !isValidEmail(email) ||
      typeof code !== "string" ||
      !new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code)
    ) {
      return res.status(400).json({
        success: false,
        message: GENERIC_INVALID_MESSAGE,
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const account = await findAccountByEmail(normalizedEmail);

    if (!account || !account.user) {
      return res.status(400).json({
        success: false,
        message: GENERIC_INVALID_MESSAGE,
      });
    }

    const { user } = account;

    if (
      user.resetPasswordLockedUntil &&
      user.resetPasswordLockedUntil > new Date()
    ) {
      return res.status(429).json({
        success: false,
        message:
          "Too many attempts. Please try again later.",
      });
    }

    if (
      !user.resetPasswordCodeHash ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires <= new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: GENERIC_INVALID_MESSAGE,
      });
    }

    const submittedHash = hashCode(code);

    const isMatch = timingSafeEqualHex(
      submittedHash,
      user.resetPasswordCodeHash
    );

    if (!isMatch) {
      const attempts =
        Number(user.resetPasswordAttempts || 0) + 1;

      user.resetPasswordAttempts = attempts;

      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        user.resetPasswordLockedUntil = new Date(
          Date.now() + LOCK_DURATION_MS
        );
      }

      await user.save();

      return res.status(400).json({
        success: false,
        message: GENERIC_INVALID_MESSAGE,
      });
    }

    // The code is valid. Mark it verified and preserve the expiry.
    user.resetPasswordVerifiedAt = new Date();

    await user.save();

    return res.json({
      success: true,
      message: "Reset code verified successfully.",
    });
  } catch (error) {
    console.error("[VERIFY RESET CODE] Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify the reset code.",
    });
  }
};

// POST /api/auth/reset-password
const resetPassword = async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;

    if (
      !email ||
      !isValidEmail(email) ||
      typeof code !== "string" ||
      !new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code) ||
      typeof newPassword !== "string" ||
      newPassword.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Provide a valid email, reset code, and password with at least 8 characters.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const account = await findAccountByEmail(normalizedEmail);

    if (!account || !account.user) {
      return res.status(400).json({
        success: false,
        message: GENERIC_INVALID_MESSAGE,
      });
    }

    const { user } = account;

    if (
      user.resetPasswordLockedUntil &&
      user.resetPasswordLockedUntil > new Date()
    ) {
      return res.status(429).json({
        success: false,
        message:
          "Too many attempts. Please try again later.",
      });
    }

    if (
      !user.resetPasswordCodeHash ||
      !user.resetPasswordExpires ||
      user.resetPasswordExpires <= new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: GENERIC_INVALID_MESSAGE,
      });
    }

    const submittedHash = hashCode(code);

    const isMatch = timingSafeEqualHex(
      submittedHash,
      user.resetPasswordCodeHash
    );

    if (!isMatch) {
      const attempts =
        Number(user.resetPasswordAttempts || 0) + 1;

      user.resetPasswordAttempts = attempts;

      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        user.resetPasswordLockedUntil = new Date(
          Date.now() + LOCK_DURATION_MS
        );
      }

      await user.save();

      return res.status(400).json({
        success: false,
        message: GENERIC_INVALID_MESSAGE,
      });
    }

    // Hash the new password before saving.
    user.password = await bcrypt.hash(newPassword, 12);

    // Clear all reset-code state after a successful reset.
    user.resetPasswordCodeHash = undefined;
    user.resetPasswordExpires = undefined;
    user.resetPasswordAttempts = 0;
    user.resetPasswordLockedUntil = undefined;
    user.resetPasswordVerifiedAt = undefined;

    await user.save();

    return res.json({
      success: true,
      message:
        "Password reset successfully. You can now log in using your new password.",
    });
  } catch (error) {
    console.error("[RESET PASSWORD] Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to reset the password.",
    });
  }
};

module.exports = {
  login,
  forgotPassword,
  verifyResetCode,
  resetPassword,
};
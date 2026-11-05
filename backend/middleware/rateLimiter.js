const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;

// Identify requests using IP address + email/identifier.
const keyByIpAndEmail = (req, res) => {
    const ip = ipKeyGenerator(req.ip);

    const identifier = String(
        req.body?.identifier ??
        req.body?.email ??
        ""
    ).trim().toLowerCase();

    return `${ip}:${identifier}`;
};

// Forgot password: maximum 3 requests per 15 minutes.
const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByIpAndEmail,
    message: {
        success: false,
        message: "Too many reset requests. Please try again later."
    }
});

// Reset password: maximum 10 attempts per 15 minutes.
const resetPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByIpAndEmail,
    message: {
        success: false,
        message: "Too many attempts. Please try again later."
    }
});

// Login: maximum 10 attempts per 15 minutes.
// Successful logins do not count toward the limit.
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByIpAndEmail,
    skipSuccessfulRequests: true,
    message: {
        success: false,
        message: "Too many login attempts. Please try again later."
    }
});

module.exports = {
    forgotPasswordLimiter,
    resetPasswordLimiter,
    loginLimiter
};
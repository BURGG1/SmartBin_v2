const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;

/**
 * IMPORTANT: express-rate-limit's default store is in-memory. That's fine for
 * a single Node process, but if you ever run multiple instances behind a load
 * balancer (PM2 cluster mode, Docker replicas, etc.), each instance has its
 * own counter and the real limit becomes (yourLimit * instanceCount). For
 * true multi-instance production, swap the store for Redis:
 *
 *   const RedisStore = require("rate-limit-redis");
 *   const { createClient } = require("redis");
 *   store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) })
 *
 * Keying by IP + email (not just IP) stops one bad actor from exhausting the
 * limit for a specific victim's account from many IPs, and stops NAT'd
 * offices/campuses from blocking each other.
 */
const keyByIpAndEmail = (req, res) =>
  `${ipKeyGenerator(req, res)}:${(req.body?.email || "").toLowerCase()}`;

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIpAndEmail,
  message: { success: false, message: "Too many reset requests. Please try again later." },
});

const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // higher than send-code: legitimate users mistype codes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIpAndEmail,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIpAndEmail,
  message: { success: false, message: "Too many login attempts. Please try again later." },
});

module.exports = { forgotPasswordLimiter, resetPasswordLimiter, loginLimiter };

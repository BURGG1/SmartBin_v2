require("dns").setDefaultResultOrder("ipv4first");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const mongoSanitize = require("express-mongo-sanitize");
const path = require("path");

const connectDB = require("./config/db");
const deviceRoutes = require("./routes/deviceRoutes");
const householdRoutes = require("./routes/householdRoutes");
const rfidRoutes = require("./routes/rfidRoutes");
const binRoutes = require("./routes/binRoutes");
const rewardRoutes = require("./routes/rewardRoutes");
const ruleRoutes = require("./routes/ruleRoutes");
const collectorRoutes = require("./routes/collectorRoutes");
const errorHandler = require("./middleware/errorHandler");
const authRoutes = require("./routes/authRoutes");
const registrationRequestRoutes = require("./routes/registrationRequestRoutes");
const { startBinStatusChecker } = require("./jobs/binStatusChecker");
const { checkAndAutoSchedule } = require("./services/autoScheduleService");
const {transporter} = require("./config/mailer");

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();
startBinStatusChecker();

transporter.verify((err, success) => {
  if (err) {
    console.error("[Mailer] Verification failed:", err.message);
  } else {
    console.log("[Mailer] Ready to send emails.");
  }
});

// ═══════════════════════════════════════════════════════════════
//  0. TRUST PROXY — required on Render (and most cloud hosts) so
//     express-rate-limit reads the real client IP from X-Forwarded-For
//     instead of the proxy's IP.
// ═══════════════════════════════════════════════════════════════
app.set("trust proxy", 1);

// ═══════════════════════════════════════════════════════════════
//  1. HELMET — security headers (must be first)
// ═══════════════════════════════════════════════════════════════
app.use(helmet());

// ═══════════════════════════════════════════════════════════════
//  2. CORS — restrict to known origins
// ═══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, ESP32, Postman, curl)
      if (!origin) return callback(null, true);

      const isLocalhost = origin.includes("localhost");
      const isLAN = origin.includes("192.168.");
      const isAllowed = ALLOWED_ORIGINS.some((o) => origin.startsWith(o));

      if (isLocalhost || isLAN || isAllowed) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin "${origin}" not allowed`));
      }
    },
    credentials: true,
  })
);

// ═══════════════════════════════════════════════════════════════
//  3. BODY PARSING — with size limit to prevent payload flooding
// ═══════════════════════════════════════════════════════════════
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true, limit: "10kb" }));

// ═══════════════════════════════════════════════════════════════
//  4. MONGO SANITIZE — strip $ and . from request data
//     prevents NoSQL injection e.g. { "rfid": { "$gt": "" } }
// ═══════════════════════════════════════════════════════════════
app.use(mongoSanitize());

// ═══════════════════════════════════════════════════════════════
//  5. RATE LIMITERS
// ═══════════════════════════════════════════════════════════════

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Please try again later." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
});

const rfidLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "RFID scan rate limit exceeded." },
});

app.use("/api/", generalLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/rfid", rfidLimiter);

// ═══════════════════════════════════════════════════════════════
//  6. LOGGING — dev only
// ═══════════════════════════════════════════════════════════════
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// ═══════════════════════════════════════════════════════════════
//  7. ROUTES
// ═══════════════════════════════════════════════════════════════
app.use("/api/rewards", rewardRoutes);
app.use("/api/rules", ruleRoutes);
app.use("/api/households", householdRoutes);
app.use("/api/rfid", rfidRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/requests", registrationRequestRoutes);
app.use("/api/bins", binRoutes);
app.use("/api/collectors", collectorRoutes);
app.use("/api/devices", deviceRoutes);

app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Server is running" });
});

// ═══════════════════════════════════════════════════════════════
//  8. 404 + ERROR HANDLER (must be last)
// ═══════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use(errorHandler);

// ═══════════════════════════════════════════════════════════════
//  9. AUTO-SCHEDULE POLLING
// ═══════════════════════════════════════════════════════════════
let isScheduleRunning = false;

setInterval(async () => {
  if (isScheduleRunning) return;
  isScheduleRunning = true;
  try {
    await checkAndAutoSchedule();
  } catch (err) {
    console.error("[AutoSchedule] Polling error:", err.message);
  } finally {
    isScheduleRunning = false;
  }
}, 30_000);

checkAndAutoSchedule().catch(console.error);

// ═══════════════════════════════════════════════════════════════
//  10. START SERVER
// ═══════════════════════════════════════════════════════════════
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Server running on port ${PORT}`);

  // mDNS/Bonjour only makes sense on a local network (e.g. your ESP32
  // finding the server on the same WiFi during development). It has no
  // effect — and can error — inside a cloud container like Render, so
  // it's skipped outside of local development.
  if (process.env.NODE_ENV === "development") {
    try {
      const { Bonjour } = require("bonjour-service");
      const bonjour = new Bonjour();
      bonjour.publish({ name: "SmartBin", type: "http", port: PORT });
      console.log(`mDNS broadcast: http://smartbin.local:${PORT}`);
    } catch (err) {
      console.warn("mDNS broadcast skipped:", err.message);
    }
  }
});
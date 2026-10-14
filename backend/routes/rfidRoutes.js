const express = require("express");
const router  = express.Router();
const { upload, uploadMemory } = require("../middleware/upload");
const { protect, allowRoles } = require("../middleware/authMiddleware");

const {
    binScan, webScan, getLatestScan, checkRfid, getRfidLogs, getRfidHistory, flagLog,
    prepareBag, rejectIfAlreadyFlagged, getBagByStamp, scanStampImage, flagBagByStamp,
} = require("../controllers/rfidController");

// ─────────────────────────────────────────────────────────────────────────────
// BIN ROUTES  (called by ESP32 hardware at the physical bin)
// ─────────────────────────────────────────────────────────────────────────────

// ESP32 calls this when a card is tapped at a physical bin
router.post("/bin-scan", binScan);

// Legacy alias — kept for backward compatibility with older ESP32 firmware
router.post("/scan-bin", binScan);
router.post("/scan",     binScan);

// ─────────────────────────────────────────────────────────────────────────────
// WEB ROUTES  (called by the web dashboard)
// ─────────────────────────────────────────────────────────────────────────────

// Admin desk RFID reader — scan card to identify or start registration
router.post("/web-scan", webScan);

// Web dashboard polls this to auto-fill RFID field during registration
router.get("/latest-scan", getLatestScan);

// Check if an RFID is already assigned before registering a new household
router.get("/check/:rfid", checkRfid);

// ─────────────────────────────────────────────────────────────────────────────
// LOG ROUTES  (used by both web dashboard and mobile app)
// ─────────────────────────────────────────────────────────────────────────────

// All logs — supports ?rfid=, ?action=, ?binId=, ?page=, ?limit=
router.get("/logs", getRfidLogs);

// Full scan history for one card
router.get("/logs/:rfid", getRfidHistory);

// Flag or unflag a disposal log entry with optional evidence photo
router.patch("/logs/:id/flag", upload.single("evidencePhoto"), flagLog);

const collectorOnly = [protect, allowRoles("collector")];

router.post("/stamp/scan", ...collectorOnly, uploadMemory.single("photo"), scanStampImage);
router.get("/stamp/:binId/:stamp", ...collectorOnly, prepareBag, getBagByStamp);
router.patch(
    "/stamp/:binId/:stamp/flag",
    ...collectorOnly,
    prepareBag,
    rejectIfAlreadyFlagged,
    upload.single("evidencePhoto"),
    flagBagByStamp
);

module.exports = router;
const express = require("express");
const router = express.Router();
const { scanRfid, scanAtBin, checkRfid, getRfidLogs, getRfidHistory, getLatestScan, flagRfidLog } = require("../controllers/rfidController");

router.post("/scan", scanRfid);
router.post("/scan-bin", scanAtBin);      // ← ESP32 calls this for bin taps
router.get("/check/:rfid", checkRfid);
router.get("/latest-scan", getLatestScan);
router.get("/logs", getRfidLogs);
router.get("/logs/:rfid", getRfidHistory);
router.patch("/logs/:id/flag", flagRfidLog);

module.exports = router;
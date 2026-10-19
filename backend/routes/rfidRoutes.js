const express = require("express");
const router  = express.Router();
const { upload, uploadMemory } = require("../middleware/upload");
const { protect, allowRoles } = require("../middleware/authMiddleware");

const {
    binScan, completeDisposal, webScan, getLatestScan, checkRfid, getRfidLogs, getRfidHistory, flagLog,
    prepareBag, rejectIfAlreadyFlagged, getBagByStamp, scanStampImage, flagBagByStamp,
} = require("../controllers/rfidController");

// Physical bin routes
router.post("/bin-scan", binScan);
router.post("/complete-disposal", completeDisposal);
router.post("/scan-bin", binScan); // legacy aliases
router.post("/scan", binScan);

// Web dashboard routes
router.post("/web-scan", webScan);
router.get("/latest-scan", getLatestScan);
router.get("/check/:rfid", checkRfid);

// Logs
router.get("/logs", getRfidLogs);
router.get("/logs/:rfid", getRfidHistory);
router.patch("/logs/:id/flag", upload.single("evidencePhoto"), flagLog);

const collectorOnly = [protect, allowRoles("collector")];
router.post("/stamp/scan", ...collectorOnly, uploadMemory.single("photo"), scanStampImage);
router.get("/stamp/:binId/:stamp", ...collectorOnly, prepareBag, getBagByStamp);
router.patch("/stamp/:binId/:stamp/flag", ...collectorOnly, prepareBag, rejectIfAlreadyFlagged, upload.single("evidencePhoto"), flagBagByStamp);

module.exports = router;

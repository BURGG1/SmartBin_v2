
const express = require("express");
const router = express.Router();

const { upload, uploadMemory } = require("../middleware/upload");
const { protect, allowRoles } = require("../middleware/authMiddleware");

const {
    binScan,
    webScan,
    getLatestScan,
    checkRfid,
    getRfidLogs,
    getRfidHistory,
    flagLog,
    prepareBag,
    rejectIfAlreadyFlagged,
    getBagByStamp,
    scanStampImage,
    flagBagByStamp,
    completeDisposal,
} = require("../controllers/rfidController");

const deviceAuth = require("../middleware/deviceAuth");

const {
  requireAssignedBin,
} = require("../middleware/deviceAuth");
// Existing scan and device routes
router.post(
  "/bin-scan",
  deviceAuth,
  requireAssignedBin,
  binScan
);

router.post(
  "/scan-bin",
  deviceAuth,
  requireAssignedBin,
  binScan
);

router.post(
  "/scan",
  deviceAuth,
  requireAssignedBin,
  binScan
);

router.post(
  "/complete-disposal",
  deviceAuth,
  requireAssignedBin,
  completeDisposal
);
router.post("/web-scan", webScan);
router.get("/latest-scan", getLatestScan);
router.get("/check/:rfid", checkRfid);

// Protected RFID log routes
const logAccess = [protect, allowRoles("admin", "household")];

router.get("/logs", ...logAccess, getRfidLogs);
router.get("/logs/:rfid", ...logAccess, getRfidHistory);

// Admin-only flagging
router.patch(
    "/logs/:id/flag",
    protect,
    allowRoles("admin"),
    upload.single("evidencePhoto"),
    flagLog
);

// Collector-only stamp routes
const collectorOnly = [protect, allowRoles("collector")];

router.post(
    "/stamp/scan",
    ...collectorOnly,
    uploadMemory.single("photo"),
    scanStampImage
);

router.get(
    "/stamp/:binId/:stamp",
    ...collectorOnly,
    prepareBag,
    getBagByStamp
);

router.patch(
    "/stamp/:binId/:stamp/flag",
    ...collectorOnly,
    prepareBag,
    rejectIfAlreadyFlagged,
    upload.single("evidencePhoto"),
    flagBagByStamp
);

module.exports = router;

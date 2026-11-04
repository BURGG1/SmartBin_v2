
const express = require("express");
const router = express.Router();
const { protect, allowRoles } = require("../middleware/authMiddleware");

const {
  updateDeviceHeartbeat,
  updateDeviceLocation,
  getAvailableDevices,
  updateFillLevel,
} = require("../controllers/deviceController");

router.post("/heartbeat", updateDeviceHeartbeat);
router.post("/location", updateDeviceLocation);
router.post("/fill-level", updateFillLevel);
router.get(
  "/available",
  protect,
  allowRoles("admin"),
  getAvailableDevices
);
module.exports = router;

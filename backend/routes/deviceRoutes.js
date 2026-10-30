
const express = require("express");
const router = express.Router();

const {
  updateDeviceHeartbeat,
  updateDeviceLocation,
  getAvailableDevices,
  updateFillLevel,
} = require("../controllers/deviceController");

router.post("/heartbeat", updateDeviceHeartbeat);
router.post("/location", updateDeviceLocation);
router.post("/fill-level", updateFillLevel);
router.get("/available", getAvailableDevices);

module.exports = router;

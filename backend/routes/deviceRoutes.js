
const express = require("express");
const router = express.Router();

const { protect, allowRoles } = require("../middleware/authMiddleware");
const deviceAuth = require("../middleware/deviceAuth");

const {
  requireMatchingDeviceId,
} = require("../middleware/deviceAuth");

const {
  updateDeviceHeartbeat,
  updateDeviceLocation,
  getAvailableDevices,
  updateFillLevel,
} = require("../controllers/deviceController");

const {
  provisionDevice,
  enableDeviceAuth,
  revokeDeviceAuth,
} = require("../controllers/deviceCredentialController");

// Admin device management
router.get(
  "/available",
  protect,
  allowRoles("admin"),
  getAvailableDevices
);

router.post(
  "/:deviceId/provision",
  protect,
  allowRoles("admin"),
  provisionDevice
);

router.patch(
  "/:deviceId/auth/enable",
  protect,
  allowRoles("admin"),
  enableDeviceAuth
);

router.patch(
  "/:deviceId/auth/revoke",
  protect,
  allowRoles("admin"),
  revokeDeviceAuth
);

// ESP32 authenticated endpoints
router.post(
  "/heartbeat",
  deviceAuth,
  requireMatchingDeviceId,
  updateDeviceHeartbeat
);

router.post(
  "/location",
  deviceAuth,
  requireMatchingDeviceId,
  updateDeviceLocation
);

router.post(
  "/fill-level",
  deviceAuth,
  requireMatchingDeviceId,
  updateFillLevel
);

module.exports = router;

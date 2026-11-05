
const Device = require("../models/Device");
const {
  generateDeviceSecret,
  hashSecret,
  encryptSecret,
} = require("../services/deviceCredentialService");

// POST /api/devices/:deviceId/provision
const provisionDevice = async (req, res) => {
  try {
    const deviceId = String(req.params.deviceId || "").trim();

    const device = await Device.findOne({ deviceId });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Registered device not found.",
      });
    }

    if (device.authEnabled || device.encryptedSecret || device.keyHash) {
      return res.status(409).json({
        success: false,
        message: "Device already has credentials. Revoke or rotate them first.",
      });
    }

    const secret = generateDeviceSecret();

    device.keyHash = hashSecret(secret);
    device.encryptedSecret = encryptSecret(secret);
    device.keyVersion = (device.keyVersion || 0) + 1;
    device.provisionedAt = new Date();

    // Keep disabled until ESP32 firmware is updated.
    device.authEnabled = false;
    device.revokedAt = null;

    await device.save();

    return res.status(201).json({
      success: true,
      message: "Device credentials provisioned. Save the secret securely; it will not be shown again.",
      data: {
        deviceId: device.deviceId,
        secret,
        keyVersion: device.keyVersion,
        authEnabled: false,
      },
    });
  } catch (error) {
    console.error("[ProvisionDevice]", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to provision device.",
    });
  }
};

// PATCH /api/devices/:deviceId/auth/enable
const enableDeviceAuth = async (req, res) => {
  try {
    const device = await Device.findOne({
      deviceId: String(req.params.deviceId || "").trim(),
    }).select("+encryptedSecret");

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    if (!device.encryptedSecret || !device.keyHash) {
      return res.status(409).json({
        success: false,
        message: "Provision device credentials first.",
      });
    }

    device.authEnabled = true;
    device.revokedAt = null;
    await device.save();

    return res.json({
      success: true,
      message: "Device authentication enabled.",
      data: {
        deviceId: device.deviceId,
        authEnabled: true,
      },
    });
  } catch (error) {
    console.error("[EnableDeviceAuth]", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to enable device authentication.",
    });
  }
};

// PATCH /api/devices/:deviceId/auth/revoke
const revokeDeviceAuth = async (req, res) => {
  try {
    const device = await Device.findOne({
      deviceId: String(req.params.deviceId || "").trim(),
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found.",
      });
    }

    device.authEnabled = false;
    device.revokedAt = new Date();
    device.keyHash = null;
    device.encryptedSecret = null;

    await device.save();

    return res.json({
      success: true,
      message: "Device credentials revoked.",
      data: {
        deviceId: device.deviceId,
        authEnabled: false,
      },
    });
  } catch (error) {
    console.error("[RevokeDeviceAuth]", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to revoke device credentials.",
    });
  }
};

module.exports = {
  provisionDevice,
  enableDeviceAuth,
  revokeDeviceAuth,
};

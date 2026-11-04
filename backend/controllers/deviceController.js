
const Device = require("../models/Device");
const Bin = require("../models/Bin");
const { createNotification } = require("./notificationController");
const {
  checkAutoConfirm,
  checkAndAutoSchedule,
} = require("../services/autoScheduleService");

const CRITICAL_LEVEL = 90;
const DEVICE_ONLINE_WINDOW_MS = 90 * 1000;

// POST /api/devices/heartbeat
// ESP32 calls this every 30 seconds. GPS is not required.
const updateDeviceHeartbeat = async (req, res) => {
  try {
    const { deviceId } = req.body;

    if (typeof deviceId !== "string" || !deviceId.trim()) {
      return res.status(400).json({
        success: false,
        message: "deviceId is required.",
      });
    }

    const normalizedDeviceId = deviceId.trim();
    const now = new Date();


    const device = await Device.findOneAndUpdate(
      { deviceId: normalizedDeviceId },
      {
        $set: {
          lastSeen: now,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device is not registered. Contact an administrator.",
      });
    }


    return res.json({
      success: true,
      message: "Heartbeat received.",
      data: {
        deviceId: device.deviceId,
        assignedBin: device.assignedBin,
        binId,
        lastSeen: device.lastSeen,
        status: "online",
      },
    });
  } catch (error) {
    console.error("[Heartbeat] Failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update device heartbeat.",
    });
  }
};

// POST /api/devices/location
// GPS remains optional. This endpoint updates coordinates when available.
const updateDeviceLocation = async (req, res) => {
  try {
    const { deviceId, lat, lng } = req.body;

    if (typeof deviceId !== "string" || !deviceId.trim()) {
      return res.status(400).json({
        success: false,
        message: "deviceId is required.",
      });
    }

    if (lat === undefined || lng === undefined) {
      return res.status(400).json({
        success: false,
        message: "lat and lng are required for location updates.",
      });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "lat and lng must be valid geographic coordinates.",
      });
    }

    const normalizedDeviceId = deviceId.trim();
    const now = new Date();


    const device = await Device.findOneAndUpdate(
      { deviceId: normalizedDeviceId },
      {
        $set: {
          lat: latNum,
          lng: lngNum,
          lastSeen: now,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device is not registered. Contact an administrator.",
      });
    }


    if (device.assignedBin) {
      await Bin.findByIdAndUpdate(device.assignedBin, {
        lat: latNum,
        lng: lngNum,
      });
    }

    return res.json({
      success: true,
      data: device,
    });
  } catch (error) {
    console.error("[DeviceLocation] Failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to update device location.",
    });
  }
};

// GET /api/devices/available
// Returns unassigned devices and whether they have reported recently.
const getAvailableDevices = async (req, res) => {
  try {
    const devices = await Device.find({
      assignedBin: null,
    })
      .sort({ deviceId: 1 })
      .lean();

    const now = Date.now();

    const data = devices.map((device) => {
      const lastSeenTime = device.lastSeen
        ? new Date(device.lastSeen).getTime()
        : 0;

      const isOnline =
        lastSeenTime > 0 &&
        now - lastSeenTime <= DEVICE_ONLINE_WINDOW_MS;

      return {
        _id: device._id,
        deviceId: device.deviceId,
        assignedBin: device.assignedBin,
        lastSeen: device.lastSeen,
        lat: device.lat,
        lng: device.lng,
        fillLevel: device.fillLevel,
        distanceCm: device.distanceCm,
        lastFillUpdate: device.lastFillUpdate,
        status: isOnline ? "online" : "offline",
      };
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[AvailableDevices] Failed:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch available devices.",
    });
  }
};

// POST /api/devices/fill-level
// Existing fill-level, scheduling, confirmation and notification logic retained.
const updateFillLevel = async (req, res) => {
  try {
    const { deviceId, fillLevel, distanceCm } = req.body;

    if (
      typeof deviceId !== "string" ||
      !deviceId.trim() ||
      fillLevel === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "deviceId and fillLevel are required.",
      });
    }

    const newLevel = Number(fillLevel);

    if (!Number.isFinite(newLevel) || newLevel < 0 || newLevel > 100) {
      return res.status(400).json({
        success: false,
        message: "fillLevel must be a number between 0 and 100.",
      });
    }

    if (
      distanceCm !== undefined &&
      distanceCm !== null &&
      !Number.isFinite(Number(distanceCm))
    ) {
      return res.status(400).json({
        success: false,
        message: "distanceCm must be a valid number.",
      });
    }

    const normalizedDeviceId = deviceId.trim();
    const existing = await Device.findOne({
      deviceId: normalizedDeviceId,
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Device not found. Register or pair the device first.",
      });
    }

    const now = new Date();

    const updateFields = {
      fillLevel: newLevel,
      lastFillUpdate: now,
      lastSeen: now,
    };

    if (distanceCm !== undefined) {
      updateFields.distanceCm =
        distanceCm === null ? null : Number(distanceCm);
    }

    const device = await Device.findOneAndUpdate(
      { _id: existing._id },
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (device.assignedBin) {
      const bin = await Bin.findByIdAndUpdate(
        device.assignedBin,
        { $set: { fill: newLevel } },
        { new: true, runValidators: true }
      );

      if (bin) {
        try {
          await checkAutoConfirm(bin, newLevel);
        } catch (err) {
          console.error("[AutoConfirm] Failed:", err.message);
        }

        if (newLevel >= 75) {
          try {
            await checkAndAutoSchedule();
          } catch (err) {
            console.error("[AutoSchedule] Failed:", err.message);
          }
        }

        if (
          newLevel >= CRITICAL_LEVEL &&
          (existing.fillLevel ?? 0) < CRITICAL_LEVEL
        ) {
          const binLabel = bin.binId;

          try {
            await createNotification({
              title: "Bin fill level critical",
              message: `${binLabel} is ${newLevel}% full and needs collection.`,
              type: "bin_critical",
              meta: {
                binId: binLabel,
                fillLevel: newLevel,
              },
              dedupe: {
                type: "bin_critical",
                "meta.binId": binLabel,
              },
            });
          } catch (err) {
            console.error("[Notification] Failed:", err.message);
          }
        }
      }
    }

    return res.json({
      success: true,
      data: device,
    });
  } catch (err) {
    console.error("[FillUpdate] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to update fill level.",
    });
  }
};

module.exports = {
  updateDeviceHeartbeat,
  updateDeviceLocation,
  getAvailableDevices,
  updateFillLevel,
};

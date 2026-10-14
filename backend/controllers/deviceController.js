const Device = require("../models/Device");
const Bin = require("../models/Bin");
const { createNotification } = require("./notificationController");
const { checkAutoConfirm, checkAndAutoSchedule } = require("../services/autoScheduleService");
const CRITICAL_LEVEL = 90; // adjust to your definition of critical

// POST /api/devices/location — ESP32 calls this every 30s
const updateDeviceLocation = async (req, res) => {
  try {
    const { deviceId, lat, lng } = req.body;
    if (!deviceId || lat === undefined || lng === undefined) {
      return res.status(400).json({ success: false, message: "deviceId, lat, lng required" });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ success: false, message: "lat and lng must be valid numbers" });
    }

    // Creates the device on first ping, updates it on every ping after
    const device = await Device.findOneAndUpdate(
      { deviceId },
      { lat: latNum, lng: lngNum, lastSeen: new Date() },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Keep the linked bin's location fresh too, once one has been assigned
    if (device.assignedBin) {
      await Bin.findByIdAndUpdate(device.assignedBin, { lat: latNum, lng: lngNum });
    }

    res.json({ success: true, data: device });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/devices/available — devices that have reported a location but aren't tied to a bin yet
const getAvailableDevices = async (req, res) => {
  try {
    const devices = await Device.find({ assignedBin: null }).sort({ deviceId: 1 });
    res.json({ success: true, data: devices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/devices/fill — ESP32 reports fill level

const updateFillLevel = async (req, res) => {
  try {
    const { deviceId, fillLevel, distanceCm } = req.body;

    if (!deviceId || fillLevel === undefined) {
      return res.status(400).json({
        success: false,
        message: "deviceId and fillLevel are required.",
      });
    }

    const newLevel = Number(fillLevel);

    if (
      !Number.isFinite(newLevel) ||
      newLevel < 0 ||
      newLevel > 100
    ) {
      return res.status(400).json({
        success: false,
        message: "fillLevel must be a number between 0 and 100.",
      });
    }

    const existing = await Device.findOne({ deviceId });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Device not found. Register or pair the device first.",
      });
    }

    const now = new Date();

    const device = await Device.findOneAndUpdate(
      { _id: existing._id },
      {
        $set: {
          fillLevel: newLevel,
          distanceCm,
          lastFillUpdate: now,
          lastSeen: now,
        },
      },
      { new: true, runValidators: true }
    );

    if (device.assignedBin) {
      const bin = await Bin.findByIdAndUpdate(
        device.assignedBin,
        { $set: { fill: newLevel } },
        { new: true, runValidators: true }
      );

      if (bin) {
        // Check an existing collection on every reading.
        try {
          await checkAutoConfirm(bin, newLevel);
        } catch (err) {
          console.error(
            "[AutoConfirm] Failed:",
            err.message
          );
        }

        // Keep retrying scheduling whenever the bin is >= 75%.
        // The scheduler itself checks for an existing pending schedule.
        if (newLevel >= 75) {
          try {
            await checkAndAutoSchedule();
          } catch (err) {
            console.error(
              "[AutoSchedule] Failed:",
              err.message
            );
          }
        }

        // Notify only when the reading crosses the critical threshold.
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
            console.error(
              "[Notification] Failed:",
              err.message
            );
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


module.exports = { updateDeviceLocation, getAvailableDevices, updateFillLevel };
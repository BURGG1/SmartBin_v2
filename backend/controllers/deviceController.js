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
      return res.status(400).json({ success: false, message: "deviceId and fillLevel required" });
    }

    const newLevel = Number(fillLevel);
    if (Number.isNaN(newLevel)) {
      return res.status(400).json({ success: false, message: "fillLevel must be a number" });
    }

    // Read the OLD level BEFORE it gets overwritten
    const existing = await Device.findOne({ deviceId });
    const previousLevel = existing?.fillLevel ?? 0;

    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        fillLevel: newLevel,
        distanceCm,
        lastFillUpdate: new Date(),
        lastSeen: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // ── Sync to the assigned bin ──
    if (device.assignedBin) {
      const bin = await Bin.findByIdAndUpdate(
        device.assignedBin,
        { fill: newLevel },
        { new: true }
      );

      // ── Notify admin when the bin crosses into critical ──
      if (bin && newLevel >= CRITICAL_LEVEL && previousLevel < CRITICAL_LEVEL) {
        const binLabel = bin.binId ?? bin.id ?? String(bin._id);
        await createNotification({
          title: "Bin fill level critical",
          message: `${binLabel} is ${newLevel}% full and needs collection.`,
          type: "bin_critical",
          meta: { binId: binLabel, fillLevel: newLevel },
          dedupe: { type: "bin_critical", "meta.binId": binLabel },
        });
      }

      // ── Auto-confirm collection: runs on EVERY reading ──
      if (bin && newLevel >= 75 && previousLevel < 75) {
        checkAndAutoSchedule().catch((err) =>
          console.error("[AutoSchedule] Error after fill update:", err.message)
        );
      }
    }

    res.json({ success: true, data: device });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { updateDeviceLocation, getAvailableDevices, updateFillLevel };
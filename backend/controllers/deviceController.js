const Device = require("../models/Device");
const Bin = require("../models/Bin");

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

// controllers/deviceController.js
const updateFillLevel = async (req, res) => {
  try {
    const { deviceId, fillLevel, distanceCm } = req.body;

    if (!deviceId || fillLevel === undefined) {
      return res.status(400).json({ success: false, message: "deviceId and fillLevel required" });
    }

    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        fillLevel,
        distanceCm,
        lastFillUpdate: new Date(),
        lastSeen: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // ── Sync to the assigned bin ──
    if (device.assignedBin) {
      await Bin.findByIdAndUpdate(device.assignedBin, { fill: fillLevel });
    }

    res.json({ success: true, data: device });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { updateDeviceLocation, getAvailableDevices, updateFillLevel };
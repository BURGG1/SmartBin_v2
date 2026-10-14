const Bin = require("../models/Bin");
const Disposal = require("../models/Disposal");
const Household = require("../models/Household");
const PointLog = require("../models/PointLog");
const Device = require("../models/Device");
const BinSchedule = require("../models/BinSchedule");
const { checkAndAwardPoints } = require("../services/streakService");
const { checkAndAutoSchedule, unassignBinFromCollector } = require("../services/autoScheduleService");

// Helper: auto-generate next Bin ID.
async function generateBinId() {
  const last = await Bin.findOne().sort({ createdAt: -1 }).select("binId");
  if (!last) return "BIN-001";
  const num = parseInt(last.binId.split("-")[1], 10) + 1;
  return `BIN-${String(num).padStart(3, "0")}`;
}

// POST /api/bins/dispose
const dispose = async (req, res) => {
  try {
    const { rfid, binId, kilos, items, bricks } = req.body;
    if (!rfid || !binId) {
      return res.status(400).json({ success: false, message: "rfid and binId are required." });
    }

    const household = await Household.findOne({ rfid, isActive: true });
    if (!household) {
      return res.status(404).json({ success: false, message: "RFID not registered." });
    }

    const bin = await Bin.findOne({ binId, isActive: true });
    if (!bin) {
      return res.status(404).json({ success: false, message: "Bin not found." });
    }

    const pointsMap = { Biodegradable: 10, "Non-biodegradable": 5, Recyclable: 15 };
    const basePoints = pointsMap[bin.type] || 10;

    if (!household.points) household.points = { total: 0, thisMonth: 0 };
    household.points.total += basePoints;
    household.points.thisMonth += basePoints;

    const disposalRecord = await Disposal.create({
      household: household._id,
      bin: bin._id,
      rfid,
      binId,
      wasteType: bin.type,
      pointsEarned: basePoints,
    });

    // Persist base points before running the rule service.
    await household.save();

    await PointLog.create({
      household: household._id,
      rule: null,
      points: basePoints,
      quantity: 1,
      reason: `Disposed ${bin.type} waste at ${binId}`,
    });

    const streakResult = await checkAndAwardPoints(household._id, {
      disposalId: disposalRecord._id,
      kilos,
      items,
      bricks,
    });

    // Recheck automatic scheduling after disposal if the bin is sufficiently full.
    const updatedBin = await Bin.findOne({ binId });
    if (updatedBin && (updatedBin.fill ?? 0) >= 75) {
      checkAndAutoSchedule().catch((err) =>
        console.error("[AutoSchedule] Error after disposal:", err.message)
      );
    }

    const householdAfter = await Household.findById(household._id).select("points");

    return res.json({
      success: true,
      message: `Disposal logged. ${basePoints} base points earned!`,
      data: {
        household: household.fullname,
        wasteType: bin.type,
        basePointsEarned: basePoints,
        streakAwards: streakResult.awards,
        currentStreak: streakResult.currentStreak,
        totalPoints: householdAfter?.points?.total ?? household.points.total,
        disposedAt: disposalRecord.disposedAt,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/bins
const getAllBins = async (req, res) => {
  try {
    const { type, search } = req.query;
    const query = {};
    if (type && type !== "all") query.type = type;
    if (search) {
      query.$or = [
        { binId: { $regex: search, $options: "i" } },
        { type: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    const bins = await Bin.find(query).sort({ createdAt: 1 });

    // Include collectorId and ISO date so the Bin Monitoring JSX can
    // exclude the current collector and preserve/display the scheduled date.
    const pendingSchedules = await BinSchedule.find({ status: "pending" })
      .select("binId collector collectorName scheduledAt triggeredBy createdAt");

    const scheduleMap = new Map(
      pendingSchedules.map((schedule) => [
        schedule.binId,
        {
          collector: schedule.collectorName,
          collectorId: schedule.collector ? String(schedule.collector) : null,
          date: schedule.scheduledAt
            ? new Date(schedule.scheduledAt).toISOString().slice(0, 10)
            : null,
          createdAt: schedule.createdAt,
          auto: schedule.triggeredBy === "auto",
        },
      ])
    );

    const binsWithSchedule = bins.map((bin) => ({
      ...bin.toObject(),
      schedule: scheduleMap.get(bin.binId) ?? null,
    }));

    return res.json({ success: true, data: binsWithSchedule });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/bins
const createBin = async (req, res) => {
  try {
    const { name, type, capacity, location, deviceId } = req.body;
    if (!name || !type || !capacity || !location || !deviceId) {
      return res.status(400).json({
        success: false,
        message: "name, type, capacity, location, and deviceId are required.",
      });
    }

    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({
        success: false,
        message: `Device "${deviceId}" hasn't reported a location yet. Make sure the ESP32 is powered on and has a GPS fix.`,
      });
    }
    if (device.assignedBin) {
      return res.status(400).json({
        success: false,
        message: `Device "${deviceId}" is already assigned to a bin.`,
      });
    }

    const bin = await Bin.create({
      binId: deviceId,
      name,
      type,
      capacity,
      location,
      lat: device.lat,
      lng: device.lng,
      fill: 0,
      lastEmptied: null,
    });

    device.assignedBin = bin._id;
    await device.save();

    return res.status(201).json({ success: true, data: bin });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Bin ID already exists." });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/bins/:id
const updateBin = async (req, res) => {
  try {
    const allowedFields = ["name", "type", "capacity", "location", "fill", "lastEmptied", "lat", "lng"];
    const updates = {};
    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const bin = await Bin.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!bin) return res.status(404).json({ success: false, message: "Bin not found." });
    return res.json({ success: true, data: bin });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/bins/:id
const deleteBin = async (req, res) => {
  try {
    const bin = await Bin.findByIdAndDelete(req.params.id);
    if (!bin) return res.status(404).json({ success: false, message: "Bin not found." });

    await BinSchedule.updateMany(
      { binId: bin.binId, status: "pending" },
      { status: "cancelled" }
    );
    await unassignBinFromCollector(bin.binId);

    return res.json({ success: true, message: "Bin deleted." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/bins/assigned?mac=XX:XX:XX:XX:XX:XX
const getBinByMac = async (req, res) => {
  try {
    const { mac } = req.query;
    if (!mac) {
      return res.status(400).json({ success: false, message: "MAC address is required." });
    }

    const bin = await Bin.findOne({ macAddress: mac.toUpperCase(), isActive: true });
    if (!bin) {
      return res.status(404).json({
        success: false,
        message: `No bin assigned to MAC: ${mac}`,
      });
    }

    return res.json({
      success: true,
      data: { binId: bin.binId, name: bin.name, type: bin.type, location: bin.location },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/bins/count
const getBinCount = async (req, res) => {
  try {
    const count = await Bin.countDocuments();
    return res.json({ success: true, count });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/bins/heartbeat
const heartbeat = async (req, res) => {
  try {
    const { binId } = req.body;
    if (!binId) {
      return res.status(400).json({ success: false, message: "binId is required." });
    }

    const bin = await Bin.findOneAndUpdate(
      { binId },
      { status: "online", isActive: true, lastHeartbeat: new Date() },
      { new: true }
    );

    if (!bin) return res.status(404).json({ success: false, message: "Bin not found." });

    if ((bin.fill ?? 0) >= 75) {
      checkAndAutoSchedule().catch((err) =>
        console.error("[AutoSchedule] Error after heartbeat:", err.message)
      );
    }

    return res.json({
      success: true,
      message: "Heartbeat received.",
      data: { binId, status: "online" },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  dispose,
  getAllBins,
  createBin,
  updateBin,
  deleteBin,
  getBinByMac,
  heartbeat,
  getBinCount,
};

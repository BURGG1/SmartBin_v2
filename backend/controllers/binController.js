
const Bin = require("../models/Bin");
const Disposal = require("../models/Disposal");
const Household = require("../models/Household");
const PointLog = require("../models/PointLog");
const Device = require("../models/Device");
const BinSchedule = require("../models/BinSchedule");
const { checkAndAwardPoints } = require("../services/streakService");
const {
  checkAndAutoSchedule,
  unassignBinFromCollector,
} = require("../services/autoScheduleService");

const COMPONENT_STATUSES = ["working", "warning", "fault", "unknown"];

// ── Helper: auto-generate next Bin ID ────────────────────────────────────────
async function generateBinId() {
  const last = await Bin.findOne().sort({ createdAt: -1 }).select("binId");
  if (!last) return "BIN-001";

  const num = parseInt(last.binId.split("-")[1], 10) + 1;
  return `BIN-${String(num).padStart(3, "0")}`;
}

// POST /api/bins/dispose
const dispose = async (req, res) => {
  try {
    const { rfid, binId } = req.body;

    if (!rfid || !binId) {
      return res.status(400).json({
        success: false,
        message: "rfid and binId are required.",
      });
    }

    const household = await Household.findOne({ rfid, isActive: true });
    if (!household) {
      return res.status(404).json({
        success: false,
        message: "RFID not registered.",
      });
    }

    const bin = await Bin.findOne({ binId, isActive: true });
    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    const pointsMap = {
      Biodegradable: 10,
      "Non-biodegradable": 5,
      Recyclable: 15,
    };
    const basePoints = pointsMap[bin.type] || 10;

    if (!household.points) {
      household.points = { total: 0, thisMonth: 0 };
    }

    household.points.total += basePoints;
    household.points.thisMonth += basePoints;

    const disposal = await Disposal.create({
      household: household._id,
      bin: bin._id,
      rfid,
      binId,
      wasteType: bin.type,
      pointsEarned: basePoints,
    });

    await household.save();

    await PointLog.create({
      household: household._id,
      points: basePoints,
      reason: `Disposed ${bin.type} waste at ${binId}`,
    });

    const streakAwards = await checkAndAwardPoints(household);

    // Auto-schedule check after every disposal.
    const updatedBin = await Bin.findOne({ binId });

    if (updatedBin && (updatedBin.fill ?? 0) >= 75) {
      checkAndAutoSchedule().catch((err) =>
        console.error("[AutoSchedule] Error after disposal:", err.message)
      );
    }

    res.json({
      success: true,
      message: `Disposal logged. ${basePoints} base points earned!`,
      data: {
        household: household.fullname,
        wasteType: bin.type,
        basePointsEarned: basePoints,
        streakAwards,
        currentStreak: household.streak?.currentStreak ?? 1,
        totalPoints: household.points.total,
        disposedAt: disposal.disposedAt,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/bins
const getAllBins = async (req, res) => {
  try {
    const { type, search } = req.query;
    const query = {};

    if (type && type !== "all") {
      query.type = type;
    }

    if (search) {
      query.$or = [
        { binId: { $regex: search, $options: "i" } },
        { type: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    const bins = await Bin.find(query).sort({ createdAt: 1 });

    const pendingSchedules = await BinSchedule.find({ status: "pending" })
      .select(
        "binId collector collectorName scheduledAt triggeredBy collectorDone collectorDoneAt"
      );

    const scheduleMap = new Map(
      pendingSchedules.map((schedule) => [
        schedule.binId,
        {
          collector: schedule.collectorName,
          collectorId: schedule.collector
            ? String(schedule.collector)
            : null,
          date: new Date(schedule.scheduledAt).toLocaleDateString(),
          auto: schedule.triggeredBy === "auto",
          collectorDone: Boolean(schedule.collectorDone),
          collectorDoneAt: schedule.collectorDoneAt ?? null,
        },
      ])
    );

    const binsWithSchedule = bins.map((bin) => ({
      ...bin.toObject(),
      schedule: scheduleMap.get(bin.binId) ?? null,
    }));

    res.json({
      success: true,
      data: binsWithSchedule,
      total: binsWithSchedule.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
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

    res.status(201).json({
      success: true,
      data: bin,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Bin ID already exists.",
      });
    }

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// PUT /api/bins/:id
const updateBin = async (req, res) => {
  try {
    const bin = await Bin.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    res.json({ success: true, data: bin });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// DELETE /api/bins/:id
const deleteBin = async (req, res) => {
  try {
    const bin = await Bin.findByIdAndDelete(req.params.id);

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    await BinSchedule.updateMany(
      { binId: bin.binId, status: "pending" },
      { $set: { status: "cancelled" } }
    );

    await unassignBinFromCollector(bin.binId);

    res.json({
      success: true,
      message: "Bin deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/bins/assigned?mac=XX:XX:XX:XX:XX:XX
const getBinByMac = async (req, res) => {
  try {
    const { mac } = req.query;

    if (!mac) {
      return res.status(400).json({
        success: false,
        message: "MAC address is required.",
      });
    }

    const bin = await Bin.findOne({
      macAddress: mac.toUpperCase(),
      isActive: true,
    });

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: `No bin assigned to MAC: ${mac}`,
      });
    }

    res.json({
      success: true,
      data: {
        binId: bin.binId,
        name: bin.name,
        type: bin.type,
        location: bin.location,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/bins/count
const getBinCount = async (req, res) => {
  try {
    const count = await Bin.countDocuments();
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// POST /api/bins/heartbeat
const heartbeat = async (req, res) => {
  try {
    const { binId, diagnostics } = req.body;

    if (!binId) {
      return res.status(400).json({
        success: false,
        message: "binId is required.",
      });
    }

    const update = {
      status: "online",
      isActive: true,
      lastHeartbeat: new Date(),
    };

    if (diagnostics && typeof diagnostics === "object") {
      update["diagnostics.components"] = diagnostics.components || {};
      update["diagnostics.overallStatus"] =
        diagnostics.overallStatus || "unknown";
      update["diagnostics.alerts"] = Array.isArray(diagnostics.alerts)
        ? diagnostics.alerts
        : [];
      update["diagnostics.reportedAt"] = new Date();
    }

    const bin = await Bin.findOneAndUpdate(
      { binId },
      { $set: update },
      { new: true, runValidators: true }
    );

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    if ((bin.fill ?? 0) >= 75) {
      checkAndAutoSchedule().catch((err) =>
        console.error("[AutoSchedule] Error after heartbeat:", err.message)
      );
    }

    res.json({
      success: true,
      message: "Heartbeat received.",
      data: { binId, status: "online" },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// GET /api/bins/:binId/diagnostics
const getBinDiagnostics = async (req, res) => {
  try {
    const bin = await Bin.findOne({ binId: req.params.binId });

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    const diagnostics = bin.diagnostics?.toObject
      ? bin.diagnostics.toObject()
      : bin.diagnostics;

    const reportedAt = diagnostics?.reportedAt ?? null;
    const stale =
      !reportedAt || Date.now() - new Date(reportedAt).getTime() > 3 * 60 * 1000;

    res.json({
      success: true,
      data: {
        binId: bin.binId,
        status: bin.status,
        lastHeartbeat: bin.lastHeartbeat,
        diagnostics: {
          ...(diagnostics || {}),
          stale,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// POST /api/bins/:binId/diagnostics
const updateBinDiagnostics = async (req, res) => {
  try {
    const { components, overallStatus, alerts } = req.body;

    if (
      !components ||
      typeof components !== "object" ||
      Array.isArray(components)
    ) {
      return res.status(400).json({
        success: false,
        message: "A valid components object is required.",
      });
    }

    const allowedComponents = [
      "wifi",
      "rfid",
      "fillSensor",
      "objectSensor",
      "gps",
      "actuator",
      "solenoid",
      "backend",
    ];

    const safeComponents = {};

    for (const name of allowedComponents) {
      if (!components[name]) continue;

      const component = components[name];
      const status = COMPONENT_STATUSES.includes(component.status)
        ? component.status
        : "unknown";

      safeComponents[name] = {
        status,
        message:
          typeof component.message === "string"
            ? component.message.slice(0, 240)
            : "",
      };
    }

    const safeOverallStatus = COMPONENT_STATUSES.includes(overallStatus)
      ? overallStatus
      : "unknown";

    const safeAlerts = Array.isArray(alerts)
      ? alerts.slice(0, 30).map((alert) => ({
          title:
            typeof alert.title === "string"
              ? alert.title.slice(0, 100)
              : "Component alert",
          message:
            typeof alert.message === "string"
              ? alert.message.slice(0, 300)
              : "",
          key: typeof alert.key === "string" ? alert.key.slice(0, 120) : "",
          at: alert.at ? new Date(alert.at) : new Date(),
        }))
      : [];

    const bin = await Bin.findOneAndUpdate(
      { binId: req.params.binId },
      {
        $set: {
          "diagnostics.components": safeComponents,
          "diagnostics.overallStatus": safeOverallStatus,
          "diagnostics.alerts": safeAlerts,
          "diagnostics.reportedAt": new Date(),
        },
      },
      { new: true, runValidators: true }
    );

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found.",
      });
    }

    res.json({
      success: true,
      message: "Diagnostics updated.",
      data: bin.diagnostics,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
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
  getBinDiagnostics,
  updateBinDiagnostics,
};

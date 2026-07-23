const Household = require("../models/Household");
const RfidLog = require("../models/RfidLog");
const Bin = require("../models/Bin");
const { cloudinary } = require("../middleware/upload");
const { normalizeRfid } = require("../utils/normalize");

// POST /api/rfid/scan
const scanRfid = async (req, res) => {
  try {
    const { rfid: rawRfid, binId } = req.body;

    if (!rawRfid)
      return res.status(400).json({ success: false, message: "RFID code is required" });

    const rfid = normalizeRfid(rawRfid);

    const household = await Household.findOne({ rfid, isActive: true });

    if (!household) {
      await RfidLog.create({
        rfid,
        household: null,
        binId: binId || null,
        action: "scan",
        note: binId
          ? `Unregistered RFID scanned at ${binId}`
          : "Unregistered RFID scanned — pending registration",
      });
      return res.status(404).json({
        success: false,
        message: "RFID not registered",
        rfid,
      });
    }

    await RfidLog.create({
      rfid,
      household: household._id,
      binId: binId || null,
      action: binId ? "dispose" : "scan",
      note: binId ? `Scanned at ${binId}` : "Entry scan",
    });

    res.json({
      success: true,
      message: "RFID recognized",
      data: {
        household: {
          id: household._id,
          fullname: household.fullname,
          address: household.address,
          familyMember: household.familyMember,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/rfid/scan-bin
const scanAtBin = async (req, res) => {
  try {
    const { rfid: rawRfid, binId, lat, lng, fillLevel, distanceCm } = req.body;

    if (!rawRfid || !binId)
      return res.status(400).json({ success: false, message: "rfid and binId are required" });

    const rfid = normalizeRfid(rawRfid);

    const household = await Household.findOne({ rfid });
    if (!household) {
      await RfidLog.create({
        rfid, household: null, binId, action: "scan",
        note: `Unregistered RFID scanned at ${binId}`,
      });
      return res.status(404).json({ success: false, message: "RFID not registered", rfid });
    }

    const bin = await Bin.findOne({ binId, isActive: true });
    if (!bin)
      return res.status(404).json({ success: false, message: `Bin ${binId} not found` });

    // ── GPS + fill level update ───────────────────────────────────────────────
    const hasValidCoords =
      typeof lat === "number" && typeof lng === "number" &&
      !Number.isNaN(lat) && !Number.isNaN(lng) && (lat !== 0 || lng !== 0);

    if (hasValidCoords) { bin.lat = lat; bin.lng = lng; }
    if (typeof fillLevel === "number" && fillLevel >= 0) bin.fill = fillLevel;
    if (hasValidCoords || typeof fillLevel === "number") await bin.save();

    // ── Update streak ─────────────────────────────────────────────────────────
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const lastDate = household.streak?.lastDisposalDate
      ? new Date(
        household.streak.lastDisposalDate.getFullYear(),
        household.streak.lastDisposalDate.getMonth(),
        household.streak.lastDisposalDate.getDate()
      )
      : null;

    let streakChanged = false;

    if (!lastDate) {
      household.streak.currentStreak = 1;
      household.streak.lastDisposalDate = now;
      streakChanged = true;
    } else {
      const diffDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        // Already scanned today — don't update streak
      } else if (diffDays === 1) {
        household.streak.currentStreak += 1;
        household.streak.lastDisposalDate = now;
        streakChanged = true;
      } else {
        household.streak.currentStreak = 1;
        household.streak.lastDisposalDate = now;
        household.streak.awardedStreaks = [];
        streakChanged = true;
      }
    }

    if (streakChanged) await household.save();

    // ── Disposal log (resets to 1 every day, per bin) ───────────────────────────
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const existingCount = await RfidLog.countDocuments({
      binId,
      action: "dispose",
      scannedAt: { $gte: startOfDay, $lt: endOfDay },
    });
    const disposalOrder = existingCount + 1;

    await RfidLog.create({
      rfid,
      household: household._id,
      binId,
      action: "dispose",
      disposalOrder,
      note: `${household.fullname} tapped at ${binId} (${bin.type})`,
    });

    res.json({
      success: true,
      message: `Logged: ${household.fullname} tapped at ${binId}`,
      data: {
        household: household.fullname,
        binId,
        binType: bin.type,
        disposalOrder,
        currentStreak: household.streak.currentStreak,
        coordsUpdated: hasValidCoords,
        lat: bin.lat,
        lng: bin.lng,
        fill: bin.fill,
        scannedAt: new Date(),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/rfid/logs/:id/flag
const flagRfidLog = async (req, res) => {
  try {
    const { flagged } = req.body;
    if (flagged === undefined) {
      return res.status(400).json({ success: false, message: "flagged is required." });
    }

    const log = await RfidLog.findById(req.params.id);
    if (!log) {
      return res.status(404).json({ success: false, message: "Log not found." });
    }

    log.flagged = flagged === "true" || flagged === true;
    log.flaggedAt = log.flagged ? new Date() : null;

    if (req.file) {
      if (log.evidencePhoto) {
        const publicId = log.evidencePhoto.split("/").slice(-2).join("/").split(".")[0];
        await cloudinary.uploader.destroy(publicId).catch((err) =>
          console.error("[Cloudinary] Failed to delete old evidence photo:", err.message)
        );
      }
      log.evidencePhoto = req.file.path;
    }

    if (!log.flagged) {
      if (log.evidencePhoto) {
        const publicId = log.evidencePhoto.split("/").slice(-2).join("/").split(".")[0];
        await cloudinary.uploader.destroy(publicId).catch((err) =>
          console.error("[Cloudinary] Failed to delete evidence photo on unflag:", err.message)
        );
      }
      log.evidencePhoto = null;
    }

    await log.save();
    await log.populate("household", "fullname address contactNumber email");

    res.json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/rfid/check/:rfid
const checkRfid = async (req, res) => {
  try {
    const rfid = normalizeRfid(req.params.rfid);
    const existing = await Household.findOne({ rfid });
    if (existing) {
      return res.json({
        success: true,
        available: false,
        message: `RFID is already assigned to ${existing.fullname}`,
      });
    }
    res.json({ success: true, available: true, message: "RFID is available" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/rfid/latest-scan
const getLatestScan = async (req, res) => {
  try {
    const latest = await RfidLog.findOne({ action: "scan", household: null })
      .sort({ scannedAt: -1 });

    if (!latest)
      return res.json({ success: false, message: "No pending scan" });

    const threeSecondsAgo = new Date(Date.now() - 3000);
    if (latest.scannedAt < threeSecondsAgo)
      return res.json({ success: false, message: "No recent scan" });

    res.json({ success: true, rfid: latest.rfid });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/rfid/logs
const getRfidLogs = async (req, res) => {
  try {
    const { rfid, action, binId, date, from, to, page = 1, limit = 20 } = req.query;
    const query = {};
    if (rfid) query.rfid = normalizeRfid(rfid);
    if (action) query.action = action;
    if (binId) query.binId = binId;

    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.scannedAt = { $gte: start, $lte: end };
    } else if (from || to) {
      query.scannedAt = {};
      if (from) {
        const start = new Date(from);
        start.setHours(0, 0, 0, 0);
        query.scannedAt.$gte = start;
      }
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.scannedAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      RfidLog.find(query)
        .populate("household", "fullname address contactNumber email")
        .sort({ scannedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      RfidLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/rfid/logs/:rfid
const getRfidHistory = async (req, res) => {
  try {
    const { action, from, to, page = 1, limit = 20 } = req.query;
    const query = { rfid: normalizeRfid(req.params.rfid) };
    if (action) query.action = action;

    if (from || to) {
      query.scannedAt = {};
      if (from) {
        const start = new Date(from);
        start.setHours(0, 0, 0, 0);
        query.scannedAt.$gte = start;
      }
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        query.scannedAt.$lte = end;
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      RfidLog.find(query)
        .populate("household", "fullname address contactNumber email")
        .sort({ scannedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      RfidLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { scanRfid, scanAtBin, checkRfid, getLatestScan, getRfidLogs, getRfidHistory, flagRfidLog };
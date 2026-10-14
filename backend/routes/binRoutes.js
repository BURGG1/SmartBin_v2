const express = require("express");
const router = express.Router();
const Bin = require("../models/Bin");
const BinSchedule = require("../models/BinSchedule");
const Collector = require("../models/Collector");
const {
    checkAndAutoSchedule,
    findBestCollector,
    unassignBinFromCollector,
    completeScheduleForBin,
} = require("../services/autoScheduleService");
const {
    dispose,
    getAllBins,
    createBin,
    updateBin,
    deleteBin,
    getBinCount,
    heartbeat,
} = require("../controllers/binController");

// ── No-param routes FIRST (before /:id) ──────────────────────────────────────
router.post("/heartbeat", heartbeat);
router.post("/dispose", dispose);
router.post("/auto-schedule", async (req, res) => {
    try {
        const count = await checkAndAutoSchedule();
        res.json({ success: true, message: `Auto-scheduled ${count} bin(s).`, count });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/update-location", async (req, res) => {
    try {
        const { binId, lat, lng } = req.body;
        if (!binId || lat === undefined || lng === undefined) {
            return res.status(400).json({ success: false, message: "binId, lat, lng required" });
        }
        const latNum = Number(lat);
        const lngNum = Number(lng);
        if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
            return res.status(400).json({ success: false, message: "lat and lng must be valid numbers" });
        }
        const bin = await Bin.findOneAndUpdate(
            { binId },
            { lat: latNum, lng: lngNum },
            { new: true }
        );
        if (!bin) return res.status(404).json({ success: false, message: "Bin not found" });
        res.json({ success: true, message: "Location updated", data: { binId, lat: latNum, lng: lngNum } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/", getAllBins);
router.post("/", createBin);
router.get("/count", getBinCount);

router.get("/schedules", async (req, res) => {
    try {
        const schedules = await BinSchedule.find({ status: "pending" })
            .populate("collector", "name email contact")
            .sort({ createdAt: -1 });
        res.json({ success: true, data: schedules });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── /:id routes AFTER all fixed-path routes ───────────────────────────────────
router.get("/:id", async (req, res) => {
    try {
        const bin = await Bin.findById(req.params.id);
        if (!bin) return res.status(404).json({ success: false, message: "Bin not found" });
        res.json({ success: true, data: bin });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.put("/:id", async (req, res) => {
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
        if (!bin) return res.status(404).json({ success: false, message: "Bin not found" });
        res.json({ success: true, data: bin });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const bin = await Bin.findByIdAndDelete(req.params.id);
        if (!bin) return res.status(404).json({ success: false, message: "Bin not found" });
        res.json({ success: true, message: `${bin.binId} deleted successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Nested /:binId/schedule routes ───────────────────────────────────────────
router.post("/:binId/schedule", async (req, res) => {
    try {
        const { binId } = req.params;
        const { collector: collectorName, date } = req.body;

        const bin = await Bin.findOne({ binId });
        if (!bin) return res.status(404).json({ success: false, message: "Bin not found" });

        const existingSchedule = await BinSchedule.findOne({
        binId,
        status: "pending",
        });

        if (existingSchedule) {
        return res.status(409).json({
            success: false,
            message: "This bin already has a pending collection.",
            data: {
            binId,
            scheduleId: existingSchedule._id,
            collector: existingSchedule.collectorName,
            },
        });
        }

        let collector;
        if (collectorName) {
            collector = await Collector.findOne({ name: collectorName, isActive: true });
        }
        if (!collector) collector = await findBestCollector();
        if (!collector) {
            return res.status(400).json({ success: false, message: "No available collectors." });
        }

        // Update the collector's load FIRST. assignedBins stores bin ID strings
        // (e.g. "BIN-001") — the same value unassignBinFromCollector and the
        // frontend both expect. If this fails, bail before ever creating a
        // BinSchedule doc, so we never leave an orphaned "pending" schedule
        // with no collector behind it.
        const updatedCollector = await Collector.findByIdAndUpdate(
            collector._id,
            { $addToSet: { assignedBins: binId } },
            { new: true }
        );
        if (!updatedCollector) {
            return res.status(500).json({ success: false, message: "Failed to update collector assignment." });
        }

        let schedule;
        try {
            schedule = await BinSchedule.create({
                bin: bin._id,
                binId,
                collector: collector._id,
                collectorName: collector.name,
                fillAtSchedule: bin.fill,
                scheduledAt: date ? new Date(date) : new Date(),
                triggeredBy: "manual",
            });
        } catch (err) {
            // Schedule failed after the collector was already updated — undo
            // the assignment so the collector's load doesn't drift out of sync.
            await Collector.findByIdAndUpdate(collector._id, { $pull: { assignedBins: binId } });
            throw err;
        }

        res.json({
            success: true,
            message: `${binId} scheduled for ${collector.name}`,
            data: { collector: collector.name, date: schedule.scheduledAt, binId },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


router.post("/:binId/schedule/complete", async (req, res) => {
  try {
    const { binId } = req.params;

    const schedule = await completeScheduleForBin(
      binId,
      "manual"
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "No pending collection found for this bin.",
      });
    }

    return res.json({
      success: true,
      message: `${binId} marked as collected. History preserved.`,
      data: schedule,
    });
  } catch (err) {
    console.error("[CompleteCollection] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to complete collection.",
    });
  }
});


module.exports = router;
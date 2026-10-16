const express = require("express");
const router = express.Router();
const Bin = require("../models/Bin");
const BinSchedule = require("../models/BinSchedule");
const Collector = require("../models/Collector");
const {
    checkAndAutoSchedule,
    findBestCollector,
    unassignBinFromCollector,
    confirmCollectionByAdmin,
    reassignScheduleCollector,
} = require("../services/autoScheduleService");
const { protect } = require("../middleware/authMiddleware");
const mongoose = require("mongoose");

const MAX_BINS_PER_COLLECTOR = 2;
const adminOnly = (req, res, next) => {
    if (req.user?.role === "collector" || req.user?.role === "household") {
        return res.status(403).json({ success: false, message: "Access denied." });
    }
    next();
};
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
        // Don't leave orphaned schedules or collector slots behind.
        await BinSchedule.updateMany(
            { binId: bin.binId, status: "pending" },
            { $set: { status: "cancelled" } }
        );
        await unassignBinFromCollector(bin.binId);
        res.json({ success: true, message: `${bin.binId} deleted successfully.` });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Nested /:binId/schedule routes ───────────────────────────────────────────
router.post("/:binId/schedule", protect, adminOnly, async (req, res) => {
    try {
        const { binId } = req.params;
        const { collector: collectorName, collectorId, date } = req.body;

        const bin = await Bin.findOne({ binId });
        if (!bin) return res.status(404).json({ success: false, message: "Bin not found" });

        // Never cancel/replace an existing schedule here: that would wipe the
        // collector's "done" flag. Moving a bin to another collector is what
        // PATCH /:binId/schedule/reassign is for.
        const existingSchedule = await BinSchedule.findOne({ binId, status: "pending" });
        if (existingSchedule) {
            return res.status(409).json({
                success: false,
                message: "This bin already has a pending collection. Use reassign to change the collector.",
            });
        }

        let scheduledAt = new Date();
        if (date) {
            scheduledAt = new Date(date);
            if (Number.isNaN(scheduledAt.getTime())) {
                return res.status(400).json({ success: false, message: "Invalid date." });
            }
        }

        // The admin's explicit choice wins: match by _id first, then by name.
        // If they chose someone, never silently swap in a different collector.
        let collector = null;
        const chosen = Boolean(collectorId || collectorName);
        if (collectorId && mongoose.isValidObjectId(collectorId)) {
            collector = await Collector.findOne({ _id: collectorId, isActive: true });
        } else if (collectorName) {
            collector = await Collector.findOne({ name: collectorName, isActive: true });
        }
        if (chosen && !collector) {
            return res.status(400).json({ success: false, message: "That collector is not available." });
        }
        if (!collector) collector = await findBestCollector();
        if (!collector) {
            return res.status(400).json({ success: false, message: "No available collectors." });
        }

        // Enforce the 2-bin cap on every path (assignedBins + pending schedules).
        const theirPending = await BinSchedule.find({ collector: collector._id, status: "pending" }).select("binId");
        const workload = new Set((collector.assignedBins || []).map(String));
        theirPending.forEach((item) => workload.add(String(item.binId)));
        workload.delete(binId);
        if (workload.size >= MAX_BINS_PER_COLLECTOR) {
            return res.status(409).json({
                success: false,
                message: `${collector.name} already has ${MAX_BINS_PER_COLLECTOR} bins assigned.`,
            });
        }

        // Create the schedule first. The unique partial index on pending
        // schedules means only one writer can win for this bin.
        let schedule;
        try {
            schedule = await BinSchedule.create({
                bin: bin._id,
                binId,
                collector: collector._id,
                collectorName: collector.name,
                fillAtSchedule: bin.fill,
                scheduledAt,
                triggeredBy: "manual",
            });
        } catch (err) {
            if (err.code === 11000) {
                return res.status(409).json({
                    success: false,
                    message: "This bin was just scheduled by someone else. Refresh and try again.",
                });
            }
            throw err;
        }

        try {
            await Collector.updateMany(
                { _id: { $ne: collector._id }, assignedBins: binId },
                { $pull: { assignedBins: binId } }
            );
            await Collector.findByIdAndUpdate(collector._id, { $addToSet: { assignedBins: binId } });
        } catch (err) {
            await BinSchedule.updateOne({ _id: schedule._id, status: "pending" }, { $set: { status: "cancelled" } });
            throw err;
        }

        res.json({
            success: true,
            message: `${binId} scheduled for ${collector.name}`,
            data: { collector: collector.name, collectorId: String(collector._id), date: schedule.scheduledAt, binId },
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin moves a pending collection to another collector.
// Blocked (409) once the collector has tapped "Done Collection" - confirm instead.
router.patch("/:binId/schedule/reassign", protect, adminOnly, async (req, res) => {
    try {
        const result = await reassignScheduleCollector(
            req.params.binId,
            req.body?.collectorId,
            req.body?.date
        );
        if (!result.ok) {
            return res.status(result.code).json({ success: false, message: result.message });
        }
        // The previous collector just got a free slot: let waiting bins take it.
        checkAndAutoSchedule().catch((e) => console.error("[AutoSchedule] after reassign:", e.message));
        res.json({
            success: true,
            message: `${req.params.binId} reassigned to ${result.schedule.collectorName}.`,
            data: {
                binId: req.params.binId,
                collector: result.schedule.collectorName,
                collectorId: String(result.schedule.collector),
                date: result.schedule.scheduledAt,
            },
        });
    } catch (err) {
        console.error("[Reassign] failed:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Admin confirms a collection. Allowed only when the collector tapped
// "Done Collection" AND the bin's fill level reads 0%. Completing the
// schedule releases the collector so they can be assigned another bin.
// PATCH is the method the admin dashboard sends; POST is kept as an alias.
const confirmCollectionHandler = async (req, res) => {
    try {
        const result = await confirmCollectionByAdmin(req.params.binId);
        if (!result.ok) {
            return res.status(result.code).json({ success: false, message: result.message });
        }
        // The collector is free again: let any waiting full bin take the slot.
        checkAndAutoSchedule().catch((e) => console.error("[AutoSchedule] after confirm:", e.message));
        res.json({
            success: true,
            message: `${req.params.binId} marked as collected.`,
            data: result.schedule,
        });
    } catch (err) {
        console.error("[Collection] Admin confirm failed:", err);
        res.status(500).json({ success: false, message: err.message });
    }
};

router.patch("/:binId/schedule/complete", protect, adminOnly, confirmCollectionHandler);
router.post("/:binId/schedule/complete", protect, adminOnly, confirmCollectionHandler);

module.exports = router;
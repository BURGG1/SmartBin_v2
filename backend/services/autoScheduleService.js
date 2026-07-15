const Bin = require("../models/Bin");
const Collector = require("../models/Collector");
const BinSchedule = require("../models/BinSchedule");

const FILL_THRESHOLD = 75;

// ── Find the best available collector ────────────────────────────────────────
// Uses assignedBins.length to pick the least-loaded collector evenly.
const findBestCollector = async () => {
    const collectors = await Collector.find({ isActive: true });
    if (collectors.length === 0) return null;

    // Sort by number of currently assigned bins — least loaded first
    const sorted = [...collectors].sort(
        (a, b) => (a.assignedBins?.length ?? 0) - (b.assignedBins?.length ?? 0)
    );

    return sorted[0];
};

// ── Auto-schedule a single bin ────────────────────────────────────────────────
const autoScheduleBin = async (bin) => {
    // Skip if already has a pending schedule for this bin
    const existing = await BinSchedule.findOne({
        binId: bin.binId,
        status: "pending",
    });
    if (existing) return null;

    const collector = await findBestCollector();
    if (!collector) {
        console.warn(`[AutoSchedule] No available collectors for ${bin.binId}`);
        return null;
    }

    const scheduledAt = new Date();
    scheduledAt.setDate(scheduledAt.getDate() + 1);

    // Update the collector's load first.
    try {
        await Collector.findByIdAndUpdate(
            collector._id,
            { $addToSet: { assignedBins: bin.binId } }
        );
    } catch (err) {
        console.error(`[AutoSchedule] Failed to update collector ${collector.name}'s assignedBins for ${bin.binId}:`, err.message);
        throw err;
    }

    let schedule;
    try {
        schedule = await BinSchedule.create({
            bin: bin._id,
            binId: bin.binId,
            collector: collector._id,
            collectorName: collector.name,
            fillAtSchedule: bin.fill,
            triggeredBy: "auto",
            scheduledAt,
            status: "pending",
        });
    } catch (err) {
        // Roll back the collector update since the schedule never actually landed.
        await Collector.findByIdAndUpdate(collector._id, { $pull: { assignedBins: bin.binId } });
        console.error(`[AutoSchedule] Failed to create schedule for ${bin.binId}, rolled back collector ${collector.name}:`, err.message);
        throw err;
    }

    return schedule;
};

// ── Check all bins and auto-schedule those at/above threshold ─────────────────
const checkAndAutoSchedule = async () => {
    const bins = await Bin.find({ isActive: true });

    const binsToSchedule = bins.filter((b) => (b.fill ?? 0) >= FILL_THRESHOLD);

    if (binsToSchedule.length === 0) return 0;

    const results = await Promise.allSettled(
        binsToSchedule.map((b) => autoScheduleBin(b))
    );

    const scheduled = results.filter(
        (r) => r.status === "fulfilled" && r.value !== null
    ).length;

    if (scheduled > 0) {
        console.log(`[AutoSchedule] Scheduled ${scheduled} bin(s).`);
    }

    return scheduled;
};

// ── Remove bin from collector's assignedBins when collection is done ──────────
const unassignBinFromCollector = async (binId) => {
    await Collector.updateMany(
        { assignedBins: binId },
        { $pull: { assignedBins: binId } }
    );
};

module.exports = {
    checkAndAutoSchedule,
    autoScheduleBin,
    findBestCollector,
    unassignBinFromCollector,
};
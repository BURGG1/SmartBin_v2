
const Bin = require("../models/Bin");
const Collector = require("../models/Collector");
const BinSchedule = require("../models/BinSchedule");

const FILL_THRESHOLD = 75;
const EMPTIED_THRESHOLD = 10;
const MAX_BINS_PER_COLLECTOR = 2;
const LOW_CONFIRM_MS = 10 * 1000;

// Find the least-loaded active collector who has capacity.
const findBestCollector = async () => {
  const collectors = await Collector.find({
    isActive: true,
    $expr: {
      $lt: [
        { $size: { $ifNull: ["$assignedBins", []] } },
        MAX_BINS_PER_COLLECTOR,
      ],
    },
  });

  if (collectors.length === 0) return null;

  collectors.sort(
    (a, b) =>
      (a.assignedBins?.length ?? 0) -
      (b.assignedBins?.length ?? 0)
  );

  return collectors[0];
};

// Create one pending schedule for an eligible bin.
const autoScheduleBin = async (bin) => {
  if (
    !bin ||
    !bin.isActive ||
    (Number(bin.fill) || 0) < FILL_THRESHOLD
  ) {
    return null;
  }

  const existing = await BinSchedule.exists({
    binId: bin.binId,
    status: "pending",
  });

  if (existing) return null;

  const collector = await findBestCollector();

  if (!collector) {
    console.warn(
      `[AutoSchedule] No available collectors for ${bin.binId}`
    );
    return null;
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
      scheduledAt: new Date(),
      status: "pending",
    });
  } catch (err) {
    if (err.code === 11000) return null;
    throw err;
  }

  try {
    await Collector.findByIdAndUpdate(
      collector._id,
      { $addToSet: { assignedBins: bin.binId } }
    );
  } catch (err) {
    await BinSchedule.updateOne(
      { _id: schedule._id, status: "pending" },
      { $set: { status: "cancelled" } }
    );

    throw err;
  }

  console.log(
    `[AutoSchedule] ${bin.binId} assigned to ${collector.name}`
  );

  return schedule;
};

// Check all active bins for automatic scheduling.
const checkAndAutoSchedule = async () => {
  const bins = await Bin.find({
    isActive: true,
    fill: { $gte: FILL_THRESHOLD },
  });

  const results = await Promise.allSettled(
    bins.map((bin) => autoScheduleBin(bin))
  );

  const scheduled = results.filter(
    (result) =>
      result.status === "fulfilled" && result.value !== null
  ).length;

  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        "[AutoSchedule] Failed:",
        result.reason?.message ?? result.reason
      );
    }
  }

  if (scheduled > 0) {
    console.log(`[AutoSchedule] Scheduled ${scheduled} bin(s).`);
  }

  return scheduled;
};

// Remove the bin from all collector assignment lists.
const unassignBinFromCollector = async (binId) => {
  await Collector.updateMany(
    { assignedBins: binId },
    { $pull: { assignedBins: binId } }
  );
};

// Complete one pending schedule and update the bin.
const completeScheduleForBin = async (
  binId,
  method = "manual"
) => {
  if (!["auto", "manual"].includes(method)) {
    throw new Error("Invalid completion method.");
  }

  const completedAt = new Date();

  // Only one caller can complete a pending schedule.
  const schedule = await BinSchedule.findOneAndUpdate(
    { binId, status: "pending" },
    [
      {
        $set: {
          status: "completed",
          completedAt,
          completionMethod: method,
          collectionDurationMs: {
            $max: [
              0,
              {
                $subtract: [
                  completedAt,
                  { $ifNull: ["$createdAt", completedAt] },
                ],
              },
            ],
          },
        },
      },
    ],
    { new: true }
  );

  if (!schedule) {
    console.log(
      `[Collection] No pending schedule for ${binId}`
    );
    return null;
  }

  const updatedBin = await Bin.findOneAndUpdate(
    { binId },
    {
      $set: {
        lastEmptied: completedAt,
        lowSince: null,
        fill: 0,
      },
    },
    { new: true }
  );

  if (!updatedBin) {
    console.error(
      `[Collection] Schedule completed, but bin ${binId} was not found`
    );
    throw new Error(`Bin ${binId} not found during completion`);
  }

  await unassignBinFromCollector(binId);

  if (schedule.collector) {
    await Collector.findByIdAndUpdate(
      schedule.collector,
      { $inc: { totalCollections: 1 } }
    );
  }

  console.log("[Collection] Completed successfully:", {
    binId,
    method,
    completedAt: updatedBin.lastEmptied,
    fill: updatedBin.fill,
    collector: schedule.collectorName,
  });

  return schedule;
};

// Called on every fill reading after updating the bin's fill.
const checkAutoConfirm = async (bin, newLevel) => {
  if (!bin) return null;

  const level = Number(newLevel);

  if (!Number.isFinite(level) || level < 0 || level > 100) {
    console.warn("[AUTO-CONFIRM] Invalid fill level:", newLevel);
    return null;
  }

  const schedule = await BinSchedule.findOne({
    binId: bin.binId,
    status: "pending",
  });

  if (!schedule) {
    if (bin.lowSince) {
      await Bin.updateOne(
        { _id: bin._id },
        { $set: { lowSince: null } }
      );
    }

    return null;
  }

  // If fill rises above 10%, reset the confirmation timer.
  if (level > EMPTIED_THRESHOLD) {
    if (bin.lowSince) {
      await Bin.updateOne(
        { _id: bin._id },
        { $set: { lowSince: null } }
      );
    }

    return null;
  }

  // Start the timer on the first reading at or below 10%.
  if (!bin.lowSince) {
    const timerStartedAt = new Date();

    await Bin.updateOne(
      { _id: bin._id, lowSince: null },
      { $set: { lowSince: timerStartedAt } }
    );

    console.log(
      `[AUTO-CONFIRM] Low-fill timer started: ${bin.binId}`
    );

    return null;
  }

  const lowElapsed =
    Date.now() - new Date(bin.lowSince).getTime();

  if (lowElapsed < LOW_CONFIRM_MS) {
    console.log("[AUTO-CONFIRM] Waiting:", {
      binId: bin.binId,
      fill: level,
      remainingSeconds: Math.ceil(
        (LOW_CONFIRM_MS - lowElapsed) / 1000
      ),
    });

    return null;
  }

  console.log(
    `[AUTO-CONFIRM] Emptying detected: ${bin.binId}`
  );

  return completeScheduleForBin(bin.binId, "auto");
};

module.exports = {
  checkAndAutoSchedule,
  autoScheduleBin,
  findBestCollector,
  unassignBinFromCollector,
  completeScheduleForBin,
  checkAutoConfirm,
};

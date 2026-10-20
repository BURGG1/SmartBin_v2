const mongoose = require("mongoose");
const Bin = require("../models/Bin");
const Collector = require("../models/Collector");
const BinSchedule = require("../models/BinSchedule");
const Notification = require("../models/Notification");

const FILL_THRESHOLD = 75;
const MAX_BINS_PER_COLLECTOR = 2;

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

  if (!collectors.length) return null;

  collectors.sort(
    (a, b) =>
      (a.assignedBins?.length ?? 0) -
      (b.assignedBins?.length ?? 0)
  );

  return collectors[0];
};

// Remove a bin from every collector's assignment list.
// Safe to call more than once.
const unassignBinFromCollector = async (binId) => {
  if (typeof binId !== "string" || !binId.trim()) {
    throw new Error("A valid binId is required to clear collector assignments.");
  }

  await Collector.updateMany(
    { assignedBins: binId },
    { $pull: { assignedBins: binId } }
  );
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

  // Include pending schedules when calculating workload.
  const pending = await BinSchedule.find({
    collector: collector._id,
    status: "pending",
  }).select("binId");

  const workload = new Set(
    (collector.assignedBins || []).map(String)
  );

  pending.forEach((item) => workload.add(String(item.binId)));

  if (workload.size >= MAX_BINS_PER_COLLECTOR) {
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
    // A unique partial index for pending schedules is recommended
    // to prevent duplicates during concurrent requests.
    if (err.code === 11000) return null;
    throw err;
  }

  try {
    await Collector.findByIdAndUpdate(
      collector._id,
      { $addToSet: { assignedBins: bin.binId } }
    );

    // Remove stale assignments from other collectors.
    await Collector.updateMany(
      { _id: { $ne: collector._id } },
      { $pull: { assignedBins: bin.binId } }
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

// Complete one pending schedule and clear its collector assignments.
// Only a successful pending -> completed transition increments the counter.
// The bin's fill level is NOT touched: the sensor owns that value, and the
// admin can only confirm once it already reads 0%.
const completeScheduleForBin = async (binId, method = "manual") => {
  if (typeof binId !== "string" || !binId.trim()) {
    throw new Error("A valid binId is required.");
  }

  if (method !== "manual") {
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
    console.log(`[Collection] No pending schedule for ${binId}`);
    return null;
  }

  let binUpdateError = null;

  try {
    const updatedBin = await Bin.findOneAndUpdate(
      { binId },
      { $set: { lastEmptied: completedAt } },
      { new: true }
    );

    if (!updatedBin) {
      binUpdateError = new Error(
        `Bin ${binId} not found during completion`
      );
    }
  } catch (err) {
    binUpdateError = err;
  }

  // Always attempt cleanup after the schedule is marked completed.
  // This is what releases the collector for a new assignment.
  try {
    await unassignBinFromCollector(binId);
  } catch (cleanupError) {
    console.error(
      `[Collection] Failed to clear assignments for ${binId}:`,
      cleanupError
    );
    throw cleanupError;
  }

  if (schedule.collector) {
    try {
      await Collector.findByIdAndUpdate(
        schedule.collector,
        { $inc: { totalCollections: 1 } }
      );
    } catch (counterError) {
      console.error(
        `[Collection] Could not increment totalCollections for ${binId}:`,
        counterError
      );
    }
  }

  if (binUpdateError) {
    console.error(
      `[Collection] Schedule completed and assignments cleared, but bin update failed:`,
      binUpdateError
    );
    throw binUpdateError;
  }

  console.log("[Collection] Completed successfully:", {
    binId,
    method,
    completedAt,
    collector: schedule.collectorName,
  });

  return schedule;
};

// Collector taps "Done Collection" in the mobile app.
// The schedule stays pending; the admin is notified and confirms later.
const markCollectorDone = async (binId, collectorId) => {
  if (typeof binId !== "string" || !binId.trim()) {
    return { ok: false, code: 400, message: "A valid binId is required." };
  }

  const schedule = await BinSchedule.findOne({
    binId,
    status: "pending",
    collector: collectorId,
  });

  if (!schedule) {
    return {
      ok: false,
      code: 404,
      message: "No pending collection assigned to you for this bin.",
    };
  }

  if (schedule.collectorDone) {
    return { ok: false, code: 409, message: "Already marked as done." };
  }

  // Atomic guard so a double tap can't create two notifications.
  const updated = await BinSchedule.findOneAndUpdate(
    // `collector` is pinned so that if the admin reassigns the bin between the
  // read above and this write, the OLD collector cannot flag the NEW
  // collector's schedule as done.
  { _id: schedule._id, status: "pending", collector: collectorId, collectorDone: { $ne: true } },
    { $set: { collectorDone: true, collectorDoneAt: new Date() } },
    { new: true }
  );

  if (!updated) {
    return { ok: false, code: 409, message: "Already marked as done." };
  }

  try {
    await Notification.create({
      type: "collection_done",
      title: "Collection marked as done",
      message: `${updated.collectorName} finished collecting ${binId}.`,
      meta: {
        binId,
        collectorId: String(updated.collector),
        collectorName: updated.collectorName,
      },
    });
  } catch (err) {
    // The schedule is already flagged, so don't fail the collector's request.
    console.error("[Collection] Could not create admin notification:", err);
  }

  console.log(`[Collection] ${updated.collectorName} marked ${binId} as done`);

  return { ok: true, schedule: updated };
};

// Admin confirms. Only allowed when the collector is done AND the bin reads 0%.
const confirmCollectionByAdmin = async (binId) => {
  if (typeof binId !== "string" || !binId.trim()) {
    return { ok: false, code: 400, message: "A valid binId is required." };
  }

  const bin = await Bin.findOne({ binId });
  if (!bin) {
    return { ok: false, code: 404, message: "Bin not found." };
  }

  const schedule = await BinSchedule.findOne({ binId, status: "pending" });
  if (!schedule) {
    return { ok: false, code: 404, message: "No pending collection for this bin." };
  }

  if (!schedule.collectorDone) {
    return {
      ok: false,
      code: 409,
      message: "The collector has not marked this collection as done.",
    };
  }

  if (Number(bin.fill) >= 5) {
    return {
      ok: false,
      code: 409,
      message: "The bin's fill level is not less than 5% yet.",
    };
  }

  const completed = await completeScheduleForBin(binId, "manual");
  if (!completed) {
    return { ok: false, code: 409, message: "This collection was already completed." };
  }

  return { ok: true, schedule: completed };
};

// Admin moves a PENDING schedule to a different collector.
//  - Updates the schedule in place (createdAt, scheduledAt, triggeredBy kept).
//  - Refused once the collector tapped "Done Collection": at that point the
//    admin should confirm instead (confirmCollectionByAdmin).
//  - The write is atomic and pinned to the current collector + collectorDone,
//    so it can't race with markCollectorDone or confirmCollectionByAdmin.
const reassignScheduleCollector = async (binId, newCollectorId, newDate = null) => {
  if (typeof binId !== "string" || !binId.trim()) {
    return { ok: false, code: 400, message: "A valid binId is required." };
  }
  if (!newCollectorId || !mongoose.isValidObjectId(newCollectorId)) {
    return { ok: false, code: 400, message: "A valid collectorId is required." };
  }

  const schedule = await BinSchedule.findOne({ binId, status: "pending" });
  if (!schedule) {
    return { ok: false, code: 404, message: "No pending collection for this bin." };
  }

  if (schedule.collectorDone) {
    return {
      ok: false,
      code: 409,
      message:
        "The collector already marked this collection as done. Confirm it instead of reassigning.",
    };
  }

  if (String(schedule.collector) === String(newCollectorId)) {
    return { ok: false, code: 400, message: "This bin is already assigned to that collector." };
  }

  const newCollector = await Collector.findById(newCollectorId);
  if (!newCollector) {
    return { ok: false, code: 404, message: "Collector not found." };
  }
  if (!newCollector.isActive) {
    return { ok: false, code: 409, message: "That collector is not active." };
  }

  // Workload = assignedBins plus pending schedules, minus this bin.
  const theirPending = await BinSchedule.find({
    collector: newCollector._id,
    status: "pending",
  }).select("binId");
  const workload = new Set((newCollector.assignedBins || []).map(String));
  theirPending.forEach((item) => workload.add(String(item.binId)));
  workload.delete(binId);

  if (workload.size >= MAX_BINS_PER_COLLECTOR) {
    return {
      ok: false,
      code: 409,
      message: `${newCollector.name} already has ${MAX_BINS_PER_COLLECTOR} bins assigned.`,
    };
  }

  // Optional new collection date (the calendar in the reassign modal).
  let newScheduledAt = null;
  if (newDate) {
    newScheduledAt = new Date(newDate);
    if (Number.isNaN(newScheduledAt.getTime())) {
      return { ok: false, code: 400, message: "Invalid date." };
    }
  }

  const oldCollectorId = schedule.collector;
  const oldCollectorName = schedule.collectorName;
  const oldScheduledAt = schedule.scheduledAt;

  const updated = await BinSchedule.findOneAndUpdate(
    {
      _id: schedule._id,
      status: "pending",
      collector: oldCollectorId,
      collectorDone: { $ne: true },
    },
    {
      $set: {
        collector: newCollector._id,
        collectorName: newCollector.name,
        reassignedAt: new Date(),
        ...(newScheduledAt ? { scheduledAt: newScheduledAt } : {}),
      },
    },
    { new: true }
  );

  if (!updated) {
    return {
      ok: false,
      code: 409,
      message:
        "This collection just changed (the collector may have marked it done). Refresh and try again.",
    };
  }

  try {
    await Collector.updateMany(
      { _id: { $ne: newCollector._id }, assignedBins: binId },
      { $pull: { assignedBins: binId } }
    );
    await Collector.findByIdAndUpdate(newCollector._id, {
      $addToSet: { assignedBins: binId },
    });
  } catch (err) {
    // Put everything back so schedule and assignments never disagree.
    await BinSchedule.updateOne(
      { _id: updated._id, status: "pending" },
      { $set: { collector: oldCollectorId, collectorName: oldCollectorName, scheduledAt: oldScheduledAt, reassignedAt: null } }
    ).catch((e) => console.error("[Reassign] rollback (schedule) failed:", e));
    await Collector.findByIdAndUpdate(oldCollectorId, {
      $addToSet: { assignedBins: binId },
    }).catch((e) => console.error("[Reassign] rollback (old collector) failed:", e));
    await Collector.findByIdAndUpdate(newCollector._id, {
      $pull: { assignedBins: binId },
    }).catch((e) => console.error("[Reassign] rollback (new collector) failed:", e));
    throw err;
  }

  console.log(`[Reassign] ${binId}: ${oldCollectorName} -> ${newCollector.name}`);
  return { ok: true, schedule: updated };
};

module.exports = {
  checkAndAutoSchedule,
  autoScheduleBin,
  findBestCollector,
  unassignBinFromCollector,
  completeScheduleForBin,
  markCollectorDone,
  confirmCollectionByAdmin,
  reassignScheduleCollector,
};
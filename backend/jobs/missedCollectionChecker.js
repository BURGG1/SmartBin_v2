
const BinSchedule = require("../models/BinSchedule");
const Notification = require("../models/Notification");

const CHECK_INTERVAL_MS = 60_000;

// A schedule becomes overdue after 24 hours by default.
// Configure MISSED_COLLECTION_GRACE_HOURS in your environment if needed.
const configuredHours = Number(
  process.env.MISSED_COLLECTION_GRACE_HOURS || 24
);

const GRACE_HOURS =
  Number.isFinite(configuredHours) && configuredHours >= 1
    ? configuredHours
    : 24;

const GRACE_MS = GRACE_HOURS * 60 * 60 * 1000;

let intervalHandle = null;
let isRunning = false;

const checkMissedCollections = async () => {
  if (isRunning) return;

  isRunning = true;

  try {
    const cutoff = new Date(Date.now() - GRACE_MS);

    const overdueSchedules = await BinSchedule.find({
      status: "pending",
      scheduledAt: { $lte: cutoff },
    })
      .select(
        "_id binId collector collectorName scheduledAt fillAtSchedule"
      )
      .lean();

    let createdCount = 0;

    for (const schedule of overdueSchedules) {
      const scheduleId = String(schedule._id);

      try {
        // The unique Notification index prevents duplicate alerts across
        // repeated checks and concurrent application instances.
        const result = await Notification.updateOne(
          {
            type: "missed_collection",
            "meta.scheduleId": scheduleId,
          },
          {
            $setOnInsert: {
              title: "Missed Collection",
              message:
                `Bin ${schedule.binId} has remained uncollected for ` +
                `${GRACE_HOURS} hours. Please reassign a collector.`,
              type: "missed_collection",
              read: false,
              flagged: false,
              actionTaken: null,
              resolvedAt: null,
              resolvedBy: null,
              meta: {
                binId: schedule.binId,
                scheduleId,
                collectorId: String(schedule.collector),
                collectorName: schedule.collectorName,
                scheduledAt: schedule.scheduledAt,
                fillLevel: schedule.fillAtSchedule ?? 0,
              },
            },
          },
          { upsert: true }
        );

        if (result.upsertedCount > 0) {
          createdCount++;
          console.log(
            `[MissedCollection] Alert created for ${schedule.binId}`
          );
        }
      } catch (err) {
        // A duplicate-key race is expected if another server instance
        // creates the same alert at the same time.
        if (err.code !== 11000) {
          console.error(
            `[MissedCollection] Failed for ${schedule.binId}:`,
            err.message
          );
        }
      }
    }

    if (createdCount > 0) {
      console.log(
        `[MissedCollection] Created ${createdCount} notification(s).`
      );
    }
  } catch (err) {
    console.error(
      "[MissedCollection] Checker failed:",
      err.message
    );
  } finally {
    isRunning = false;
  }
};

const startMissedCollectionChecker = () => {
  if (intervalHandle) return;

  // Run once on startup and then at the configured interval.
  checkMissedCollections().catch((err) => {
    console.error("[MissedCollection] Startup check failed:", err.message);
  });

  intervalHandle = setInterval(() => {
    checkMissedCollections();
  }, CHECK_INTERVAL_MS);

  console.log(
    `[MissedCollection] Checker started. Grace period: ${GRACE_HOURS} hours.`
  );
};

module.exports = {
  startMissedCollectionChecker,
  checkMissedCollections,
};

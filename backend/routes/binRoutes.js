
const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const Bin = require("../models/Bin");
const BinSchedule = require("../models/BinSchedule");
const Collector = require("../models/Collector");

const { protect, allowRoles } = require("../middleware/authMiddleware");

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

const MAX_BINS_PER_COLLECTOR = 2;

// Remove this bin from all collectors except the specified collector.
// This repairs stale assignments and is safe to repeat.
async function cleanupAssignedBin(binId, keepCollectorId = null) {
  if (typeof binId !== "string" || !binId.trim()) {
    throw new Error("A valid binId is required.");
  }

  const filter = keepCollectorId
    ? { _id: { $ne: keepCollectorId } }
    : {};

  await Collector.updateMany(
    filter,
    { $pull: { assignedBins: binId } }
  );
}

// Fixed-path routes FIRST (before /:id).
router.post("/heartbeat", heartbeat);
router.post("/dispose", dispose);

router.post("/auto-schedule", async (req, res) => {
  try {
    const count = await checkAndAutoSchedule();

    return res.json({
      success: true,
      message: `Auto-scheduled ${count} bin(s).`,
      count,
    });
  } catch (err) {
    console.error("[AutoSchedule] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Automatic scheduling failed.",
    });
  }
});

router.post("/update-location", async (req, res) => {
  try {
    const { binId, lat, lng } = req.body;

    if (!binId || lat === undefined || lng === undefined) {
      return res.status(400).json({
        success: false,
        message: "binId, lat, lng required",
      });
    }

    const latNum = Number(lat);
    const lngNum = Number(lng);

    if (
      !Number.isFinite(latNum) ||
      !Number.isFinite(lngNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lngNum < -180 ||
      lngNum > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid latitude and longitude are required.",
      });
    }

    const bin = await Bin.findOneAndUpdate(
      { binId },
      { $set: { lat: latNum, lng: lngNum } },
      { new: true, runValidators: true }
    );

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found",
      });
    }

    return res.json({
      success: true,
      message: "Location updated",
      data: { binId, lat: latNum, lng: lngNum },
    });
  } catch (err) {
    console.error("[UpdateBinLocation] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to update bin location.",
    });
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

    return res.json({ success: true, data: schedules });
  } catch (err) {
    console.error("[GetSchedules] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to load schedules.",
    });
  }
});

// Generic /:id routes AFTER fixed-path routes.
router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bin ID.",
      });
    }

    const bin = await Bin.findById(req.params.id);

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found",
      });
    }

    return res.json({ success: true, data: bin });
  } catch (err) {
    console.error("[GetBin] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve bin.",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bin ID.",
      });
    }

    const allowedFields = [
      "name",
      "type",
      "capacity",
      "location",
      "fill",
      "lastEmptied",
      "lat",
      "lng",
    ];

    const updates = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    const bin = await Bin.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found",
      });
    }

    return res.json({ success: true, data: bin });
  } catch (err) {
    console.error("[UpdateBin] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to update bin.",
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid bin ID.",
      });
    }

    const bin = await Bin.findById(req.params.id);

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found",
      });
    }

    // Cancel pending schedules and retain their history.
    await BinSchedule.updateMany(
      { binId: bin.binId, status: "pending" },
      { $set: { status: "cancelled" } }
    );

    // Remove stale assignment references before deleting the bin.
    await unassignBinFromCollector(bin.binId);
    await Bin.deleteOne({ _id: bin._id });

    return res.json({
      success: true,
      message: `${bin.binId} deleted successfully.`,
    });
  } catch (err) {
    console.error("[DeleteBin] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to delete bin.",
    });
  }
});

// Create a schedule for a bin.
router.post("/:binId/schedule", async (req, res) => {
  try {
    const { binId } = req.params;
    const { collector: collectorName, collectorId, date } = req.body;

    const bin = await Bin.findOne({ binId });

    if (!bin) {
      return res.status(404).json({
        success: false,
        message: "Bin not found",
      });
    }

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

    let scheduledAt = new Date();

    if (date !== undefined && date !== null && date !== "") {
      scheduledAt = new Date(date);

      if (Number.isNaN(scheduledAt.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid schedule date.",
        });
      }
    }

    let collector = null;

    if (collectorId) {
      if (!mongoose.Types.ObjectId.isValid(collectorId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid collector ID.",
        });
      }

      collector = await Collector.findOne({
        _id: collectorId,
        isActive: true,
      });

      if (!collector) {
        return res.status(404).json({
          success: false,
          message: "Selected collector not found or inactive.",
        });
      }
    } else if (collectorName) {
      collector = await Collector.findOne({
        name: collectorName,
        isActive: true,
      });
    } else {
      collector = await findBestCollector();
    }

    if (!collector) {
      return res.status(400).json({
        success: false,
        message: "No available collectors.",
      });
    }

    // Calculate workload using both stored assignments and pending schedules.
    const pendingSchedules = await BinSchedule.find({
      collector: collector._id,
      status: "pending",
    }).select("binId");

    const workload = new Set(
      (collector.assignedBins || []).map(String)
    );

    pendingSchedules.forEach((item) => {
      workload.add(String(item.binId));
    });

    // This bin may already appear in stale assignment data.
    workload.delete(binId);

    if (workload.size >= MAX_BINS_PER_COLLECTOR) {
      return res.status(409).json({
        success: false,
        message: `This collector has reached the ${MAX_BINS_PER_COLLECTOR}-bin limit. Choose another collector.`,
      });
    }

    // Create the schedule first; do not change existing assignment data
    // until schedule creation succeeds.
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
        status: "pending",
      });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: "A pending schedule already exists for this bin.",
        });
      }

      throw err;
    }

    try {
      await Collector.findByIdAndUpdate(
        collector._id,
        { $addToSet: { assignedBins: binId } }
      );

      // A bin must not remain assigned to another collector.
      await cleanupAssignedBin(binId, collector._id);
    } catch (assignmentError) {
      console.error(
        "[CreateSchedule] Assignment update failed:",
        assignmentError
      );

      // Preserve history, but prevent an unusable pending schedule.
      await BinSchedule.updateOne(
        { _id: schedule._id, status: "pending" },
        { $set: { status: "cancelled" } }
      );

      // Best-effort cleanup. This bin is no longer pending.
      await unassignBinFromCollector(binId).catch((cleanupError) => {
        console.error(
          "[CreateSchedule] Cleanup failed:",
          cleanupError
        );
      });

      throw assignmentError;
    }

    return res.status(201).json({
      success: true,
      message: `${binId} scheduled for ${collector.name}`,
      data: {
        collector: collector.name,
        collectorId: String(collector._id),
        date: schedule.scheduledAt,
        binId,
        scheduleId: String(schedule._id),
      },
    });
  } catch (err) {
    console.error("[CreateSchedule] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to create collection schedule.",
    });
  }
});

// Reassign an existing pending schedule to a different collector.
router.patch(
  "/:binId/schedule/reassign",
  protect,
  allowRoles("admin"),
  async (req, res) => {
    try {
      const { binId } = req.params;
      const { collectorId } = req.body;

      if (
        !collectorId ||
        !mongoose.Types.ObjectId.isValid(collectorId)
      ) {
        return res.status(400).json({
          success: false,
          message: "A valid replacement collector ID is required.",
        });
      }

      const schedule = await BinSchedule.findOne({
        binId,
        status: "pending",
      });

      if (!schedule) {
        return res.status(404).json({
          success: false,
          message: "No pending collection schedule exists for this bin.",
        });
      }

      if (!schedule.collector) {
        return res.status(409).json({
          success: false,
          message: "The existing schedule has no assigned collector.",
        });
      }

      const oldCollectorId = String(schedule.collector);

      if (oldCollectorId === String(collectorId)) {
        return res.status(400).json({
          success: false,
          message: "This collector is already assigned to the bin.",
        });
      }

      const replacementCollector = await Collector.findOne({
        _id: collectorId,
        isActive: true,
      });

      if (!replacementCollector) {
        return res.status(404).json({
          success: false,
          message: "Replacement collector not found or inactive.",
        });
      }

      const pendingSchedules = await BinSchedule.find({
        collector: replacementCollector._id,
        status: "pending",
      }).select("binId");

      const workload = new Set(
        (replacementCollector.assignedBins || []).map(String)
      );

      pendingSchedules.forEach((item) => {
        workload.add(String(item.binId));
      });

      // Reassigning this bin should not count it twice.
      workload.delete(binId);

      if (workload.size >= MAX_BINS_PER_COLLECTOR) {
        return res.status(409).json({
          success: false,
          message: `This collector has reached the ${MAX_BINS_PER_COLLECTOR}-bin limit.`,
        });
      }

      const replacementAlreadyHadBin = (
        replacementCollector.assignedBins || []
      ).some((assignedBin) => String(assignedBin) === binId);

      // Reserve the new assignment before changing the schedule.
      await Collector.findByIdAndUpdate(
        replacementCollector._id,
        { $addToSet: { assignedBins: binId } }
      );

      const updatedSchedule = await BinSchedule.findOneAndUpdate(
        {
          _id: schedule._id,
          status: "pending",
          collector: schedule.collector,
        },
        {
          $set: {
            collector: replacementCollector._id,
            collectorName: replacementCollector.name,
          },
        },
        { new: true, runValidators: true }
      );

      if (!updatedSchedule) {
        // Restore the replacement collector's previous state.
        if (!replacementAlreadyHadBin) {
          await Collector.findByIdAndUpdate(
            replacementCollector._id,
            { $pull: { assignedBins: binId } }
          );
        }

        return res.status(409).json({
          success: false,
          message: "The schedule changed before reassignment. Refresh and try again.",
        });
      }

      // The schedule now belongs to the replacement collector.
      // Remove the bin from all other collector assignment arrays.
      try {
        await cleanupAssignedBin(binId, replacementCollector._id);
      } catch (cleanupError) {
        console.error(
          "[ReassignCollector] Assignment cleanup failed:",
          cleanupError
        );

        // The schedule has changed, so report the partial failure clearly.
        return res.status(500).json({
          success: false,
          message:
            "The schedule was reassigned, but assignment cleanup failed. Check collector assignments before retrying.",
          data: {
            binId,
            collectorId: String(replacementCollector._id),
            collectorName: replacementCollector.name,
            scheduleId: String(updatedSchedule._id),
          },
        });
      }

      return res.json({
        success: true,
        message: `${binId} reassigned to ${replacementCollector.name}.`,
        data: {
          binId,
          scheduleId: String(updatedSchedule._id),
          collectorId: String(replacementCollector._id),
          collectorName: replacementCollector.name,
          scheduledAt: updatedSchedule.scheduledAt,
        },
      });
    } catch (err) {
      console.error("[ReassignCollector] Failed:", err);

      return res.status(500).json({
        success: false,
        message: "Failed to reassign collector. Check the server logs.",
      });
    }
  }
);

// Manually complete a pending collection.
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

    // completeScheduleForBin also cleans assignments; repeat safely here
    // to repair any stale references left by previous operations.
    await cleanupAssignedBin(binId);

    return res.json({
      success: true,
      message: `${binId} marked as collected. Assignments cleared; history preserved.`,
      data: schedule,
    });
  } catch (err) {
    console.error("[CompleteCollection] Failed:", err);

    return res.status(500).json({
      success: false,
      message: "Collection completion encountered an error. Check the server logs.",
    });
  }
});

module.exports = router;

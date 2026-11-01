
const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const Collector = require("../models/Collector");
const BinSchedule = require("../models/BinSchedule");

const MAX_BINS_PER_COLLECTOR = 2;

const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(notifications);
  } catch (err) {
    console.error("[Notifications] Fetch failed:", err.message);
    res.status(500).json({
      success: false,
      message: "Unable to load notifications.",
    });
  }
};

const markAsRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID.",
      });
    }

    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { $set: { read: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    res.json({ success: true, data: notification });
  } catch (err) {
    console.error("[Notifications] Mark-read failed:", err.message);
    res.status(500).json({
      success: false,
      message: "Unable to update notification.",
    });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { read: false },
      { $set: { read: true } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error("[Notifications] Mark-all-read failed:", err.message);
    res.status(500).json({
      success: false,
      message: "Unable to update notifications.",
    });
  }
};

const toggleFlag = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID.",
      });
    }

    const notification = await Notification.findById(req.params.id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    notification.flagged = !notification.flagged;
    await notification.save();

    res.json({ success: true, data: notification });
  } catch (err) {
    console.error("[Notifications] Flag failed:", err.message);
    res.status(500).json({
      success: false,
      message: "Unable to update notification.",
    });
  }
};

// Reassign a missed collection to another eligible collector.
const reassignMissedCollection = async (req, res) => {
  let reservedCollectorId = null;
  let reservedBinId = null;

  try {
    const { id } = req.params;
    const { collectorId } = req.body;

    if (
      !mongoose.isValidObjectId(id) ||
      !mongoose.isValidObjectId(collectorId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification or collector ID.",
      });
    }

    const notification = await Notification.findOne({
      _id: id,
      type: "missed_collection",
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Missed-collection notification not found.",
      });
    }

    if (notification.actionTaken === "reassigned") {
      return res.status(409).json({
        success: false,
        message: "This notification has already been resolved.",
      });
    }

    const scheduleId = notification.meta?.scheduleId;
    const binId = notification.meta?.binId;

    if (
      !scheduleId ||
      !binId ||
      !mongoose.isValidObjectId(scheduleId)
    ) {
      return res.status(400).json({
        success: false,
        message: "This notification has incomplete schedule information.",
      });
    }

    const schedule = await BinSchedule.findById(scheduleId);

    if (!schedule || schedule.status !== "pending") {
      return res.status(409).json({
        success: false,
        message: "This collection is no longer pending.",
      });
    }

    if (schedule.binId !== binId) {
      return res.status(409).json({
        success: false,
        message: "The schedule and notification do not match.",
      });
    }

    if (String(schedule.collector) === String(collectorId)) {
      return res.status(400).json({
        success: false,
        message: "Choose a different collector.",
      });
    }

    // Atomically reserve a slot and assign the bin to the replacement.
    // The database condition prevents the collector from exceeding
    // the configured assignment limit during concurrent requests.
    const replacement = await Collector.findOneAndUpdate(
      {
        _id: collectorId,
        isActive: true,
        assignedBins: { $ne: binId },
        $expr: {
          $lt: [
            { $size: { $ifNull: ["$assignedBins", []] } },
            MAX_BINS_PER_COLLECTOR,
          ],
        },
      },
      { $addToSet: { assignedBins: binId } },
      { new: true }
    ).select("_id name");

    if (!replacement) {
      return res.status(409).json({
        success: false,
        message:
          "The selected collector is inactive, already assigned this bin, or has reached the assignment limit.",
      });
    }

    reservedCollectorId = replacement._id;
    reservedBinId = binId;

    // Compare-and-set: only one admin request can replace the current
    // collector while this schedule remains pending.
    const updatedSchedule = await BinSchedule.findOneAndUpdate(
      {
        _id: schedule._id,
        status: "pending",
        collector: schedule.collector,
      },
      {
        $set: {
          collector: replacement._id,
          collectorName: replacement.name,
        },
      },
      { new: true, runValidators: true }
    );

    if (!updatedSchedule) {
      await Collector.updateOne(
        { _id: replacement._id },
        { $pull: { assignedBins: binId } }
      );

      reservedCollectorId = null;

      return res.status(409).json({
        success: false,
        message:
          "The schedule changed while you were reassigning it. Refresh and try again.",
      });
    }

    // Remove the bin from the former collector only after the schedule
    // has successfully been changed.
    await Collector.updateOne(
      { _id: schedule.collector },
      { $pull: { assignedBins: binId } }
    );

    const resolvedNotification = await Notification.findOneAndUpdate(
      {
        _id: notification._id,
        type: "missed_collection",
        actionTaken: null,
      },
      {
        $set: {
          actionTaken: "reassigned",
          resolvedAt: new Date(),
          resolvedBy: req.user.id || req.user._id,
          read: true,
          "meta.collectorId": String(replacement._id),
          "meta.collectorName": replacement.name,
        },
      },
      { new: true }
    );

    if (!resolvedNotification) {
      // The schedule has already changed. Do not undo a valid assignment
      // just because another request resolved the notification concurrently.
      console.error(
        "[Notifications] Schedule reassigned but notification resolution raced:",
        notification._id
      );
    }

    reservedCollectorId = null;

    return res.json({
      success: true,
      message: `Bin ${binId} reassigned to ${replacement.name}.`,
      data: {
        scheduleId: updatedSchedule._id,
        binId,
        collectorId: replacement._id,
        collectorName: replacement.name,
      },
    });
  } catch (err) {
    // Best-effort cleanup if a failure occurred after reserving a slot
    // but before successfully updating the schedule.
    if (reservedCollectorId && reservedBinId) {
      try {
        const scheduleNow = await BinSchedule.findOne({
          binId: reservedBinId,
          status: "pending",
          collector: reservedCollectorId,
        });

        if (!scheduleNow) {
          await Collector.updateOne(
            { _id: reservedCollectorId },
            { $pull: { assignedBins: reservedBinId } }
          );
        }
      } catch (cleanupErr) {
        console.error(
          "[Notifications] Assignment cleanup failed:",
          cleanupErr.message
        );
      }
    }

    console.error("[Notifications] Reassignment failed:", err.message);

    res.status(500).json({
      success: false,
      message: "Unable to reassign the collection. Please try again.",
    });
  }
};

const createNotification = async ({
  title,
  message,
  type = "system",
  meta = {},
  dedupe = null,
}) => {
  try {
    if (
      process.env.TEST_NOTIFICATION_FAILURE === "true" &&
      type === "household_flagged"
    ) {
      throw new Error("TC-25 simulated notification failure");
    }

    if (dedupe) {
      const exists = await Notification.findOne({
        ...dedupe,
        read: false,
      });

      if (exists) return exists;
    }

    return await Notification.create({
      title,
      message,
      type,
      meta,
    });
  } catch (err) {
    console.error("[Notifications] Create failed:", err.message);
    return null;
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  toggleFlag,
  reassignMissedCollection,
  createNotification,
};


const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: [
        "bin_critical",
        "household_flagged",
        "registration_request",
        "missed_collection",
        "system",
      ],
      default: "system",
      index: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    flagged: {
      type: Boolean,
      default: false,
    },
    meta: {
      binId: String,
      fillLevel: Number,

      householdId: String,
      householdName: String,
      stampNumber: String,
      logId: String,
      evidenceUrl: String,

      requestId: String,
      applicantName: String,

      // Used by missed-collection notifications
      scheduleId: String,
      collectorId: String,
      collectorName: String,
      scheduledAt: Date,
    },

    // Null until an admin successfully reassigns the schedule
    actionTaken: {
      type: String,
      enum: [null, "reassigned"],
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  { timestamps: true }
);

// One missed-collection notification per schedule.
// This protects against duplicate alerts when multiple backend instances
// run the checker simultaneously.
notificationSchema.index(
  { type: 1, "meta.scheduleId": 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: "missed_collection",
      "meta.scheduleId": { $type: "string" },
    },
  }
);

module.exports = mongoose.model("Notification", notificationSchema);

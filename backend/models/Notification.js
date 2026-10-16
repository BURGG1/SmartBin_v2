const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["bin_critical", "household_flagged", "registration_request", "missed_collection", "collection_done", "system"],
      default: "system",
    },
    read: { type: Boolean, default: false },
    flagged: { type: Boolean, default: false },
    meta: {
      // bin_critical
      binId: String,
      fillLevel: Number,
      // household_flagged
      householdId: String,
      householdName: String,
      stampNumber: String,
      logId: String,
      evidenceUrl: String,
      // collection_done / missed_collection
      collectorId: String,
      collectorName: String,
      // registration_request
      requestId: String,
      applicantName: String,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
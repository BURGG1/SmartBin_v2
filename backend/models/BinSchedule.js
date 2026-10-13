
const mongoose = require("mongoose");

const binScheduleSchema = new mongoose.Schema(
  {
    bin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bin",
      required: true,
    },
    binId: {
      type: String,
      required: true,
      trim: true,
    },
    collector: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Collector",
      required: true,
    },
    collectorName: {
      type: String,
      required: true,
    },
    scheduledAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "cancelled"],
      default: "pending",
      index: true,
    },
    triggeredBy: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    fillAtSchedule: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    completionMethod: {
      type: String,
      enum: ["auto", "manual"],
      default: null,
    },
    collectionDurationMs: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  { timestamps: true }
);

// Efficient schedule and history queries.
binScheduleSchema.index({ binId: 1, status: 1 });
binScheduleSchema.index({ collector: 1, status: 1 });
binScheduleSchema.index({ completedAt: -1 });

// Only one pending schedule per bin.
// Clean up any existing duplicate pending schedules before creating this index.
binScheduleSchema.index(
  { binId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "pending" },
  }
);

module.exports = mongoose.model("BinSchedule", binScheduleSchema);

const mongoose = require("mongoose");

const binScheduleSchema = new mongoose.Schema(
  {
    bin:       { type: mongoose.Schema.Types.ObjectId, ref: "Bin", required: true },
    binId:     { type: String, required: true },
    collector: { type: mongoose.Schema.Types.ObjectId, ref: "Collector", required: true },
    collectorName: { type: String, required: true },
    scheduledAt:   { type: Date, default: Date.now },
    completedAt:   { type: Date, default: null },
    status:        { type: String, enum: ["pending", "completed", "cancelled"], default: "pending" },
    triggeredBy:   { type: String, enum: ["auto", "manual"], default: "auto" },
    fillAtSchedule: { type: Number, default: 0 },
    // Set when the collector taps "Done Collection" in the app.
    // The schedule stays "pending" until the admin confirms it.
    collectorDone:   { type: Boolean, default: false },
    collectorDoneAt: { type: Date, default: null },
    completionMethod: { type: String, enum: ["manual"], default: undefined },
    collectionDurationMs: { type: Number, default: undefined },
    // Set when the admin moves a pending schedule to another collector.
    reassignedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

binScheduleSchema.index({ binId: 1, status: 1 });
binScheduleSchema.index({ collector: 1, status: 1 });
// A bin can only ever have ONE pending schedule. Stops the auto-scheduler,
// the manual route and reassignment from creating duplicates when they race.
binScheduleSchema.index(
  { binId: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);

module.exports = mongoose.model("BinSchedule", binScheduleSchema);
const mongoose = require("mongoose");

const rfidLogSchema = new mongoose.Schema(
  {
    rfid: { type: String, required: true, trim: true },
    household: { type: mongoose.Schema.Types.ObjectId, ref: "Household", default: null },
    binId: { type: String, default: null, trim: true },
    action: { type: String, enum: ["scan", "assign", "unassign", "dispose"], required: true },
    disposalOrder: { type: Number, default: null },
    // Only completed physical disposal cycles set this field.
    cycleId: { type: String, default: undefined, trim: true },
    flagged: { type: Boolean, default: false },
    flaggedAt: { type: Date, default: null },
    flaggedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Collector", default: null },
    evidencePhoto: { type: String, default: null },
    scannedAt: { type: Date, default: Date.now },
    note: { type: String, default: null },
  },
  { timestamps: true }
);

rfidLogSchema.index({ rfid: 1 });
rfidLogSchema.index({ scannedAt: -1 });
rfidLogSchema.index({ binId: 1 });
// Idempotency: one completed disposal record per bin/cycle.
rfidLogSchema.index(
  { binId: 1, cycleId: 1 },
  { unique: true, partialFilterExpression: { cycleId: { $type: "string" } } }
);

module.exports = mongoose.model("RfidLog", rfidLogSchema);

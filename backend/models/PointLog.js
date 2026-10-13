
const mongoose = require("mongoose");

const pointLogSchema = new mongoose.Schema(
  {
    household: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Household",
      required: true,
      index: true,
    },
    rule: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rule",
      default: null,
    },
    points: {
      type: Number,
      required: true,
      min: 1,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 0,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    // Set for automatic awards; old/manual logs can omit it.
    eventKey: {
      type: String,
      default: undefined,
    },
    awardedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

pointLogSchema.index(
  { eventKey: 1 },
  { unique: true, sparse: true }
);

module.exports = mongoose.model("PointLog", pointLogSchema);

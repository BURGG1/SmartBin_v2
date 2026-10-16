const mongoose = require("mongoose");

const disposalSchema = new mongoose.Schema(
  {
    household: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Household",
      required: true,
    },
    bin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bin",
      required: true,
    },
    rfid: {
      type: String,
      required: true,
    },
    binId: {
      type: String,
      required: true,
    },
    wasteType: {
      type: String,
      enum: ["Biodegradable", "Non-biodegradable", "Recyclable"],
    },
    pointsEarned: {
      type: Number,
      default: 0,
    },
    penalized: { type: Boolean, default: false },
    disposedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Disposal", disposalSchema);
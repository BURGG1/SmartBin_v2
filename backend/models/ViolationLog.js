// models/ViolationLog.js
const mongoose = require("mongoose");

const violationLogSchema = new mongoose.Schema(
  {
    household: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Household",
      required: true,
    },
    offenseNumber: { type: Number, required: true },   // 1, 2, or 3
    penaltyType: { type: String, required: true },      // "Point Deduction" | "Fine" | "Fine + Community Service"
    pointsDeducted: { type: Number, default: 0 },
    fineAmount: { type: Number, default: 0 },
    communityService: { type: String, default: null },  // null or "15 Days Community Service"
    note: { type: String, default: null },              // optional admin note
    issuedBy: { type: String, default: "System" },      // admin name or "System"
  },
  { timestamps: true }
);

module.exports = mongoose.model("ViolationLog", violationLogSchema);
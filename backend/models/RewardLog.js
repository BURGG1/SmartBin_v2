const mongoose = require("mongoose");

const rewardLogSchema = new mongoose.Schema(
  {
    household: { type: mongoose.Schema.Types.ObjectId, ref: "Household", required: true },
    reward: { type: mongoose.Schema.Types.ObjectId, ref: "Reward", required: true },
    rewardName: { type: String, required: true }, // snapshot — survives reward being edited/deleted later
    pointsSpent: { type: Number, required: true, min: 0 },

    // ── Redeem confirmation (receipt number) ──
    redeemed: { type: Boolean, default: false },
    receiptNumber: { type: String, default: null },
    redeemedAt: { type: Date, default: null },
    redeemedBy: { type: String, default: null },
  },
  { timestamps: true }
);

rewardLogSchema.index({ household: 1, createdAt: -1 });
rewardLogSchema.index({ household: 1, reward: 1, createdAt: -1 });

module.exports = mongoose.model("RewardLog", rewardLogSchema);
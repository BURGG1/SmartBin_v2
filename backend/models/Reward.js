const mongoose = require("mongoose");

const rewardSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    points: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Points must be a whole number.",
      },
    },

    stocks: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Stocks must be a whole number.",
      },
    },

    image: {
      type: String,
      default: "",
    },

    // 0 means unlimited claims.
    claimLimit: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "Claim limit must be a whole number.",
      },
    },

    // The period during which the limit applies.
    claimPeriod: {
      type: String,
      required: true,
      enum: ["day", "week", "month", "year", "lifetime"],
      default: "month",
    },
  },
  { timestamps: true }
);

/* ─────────────────────────────────────────────────────────────
   DELETE GUARD
   A reward can't be deleted while any household still has a
   redemption of it that is NOT confirmed yet (redeemed !== true).

   This lives on the model, so it works no matter which route or
   controller calls the delete.
   ───────────────────────────────────────────────────────────── */
async function assertNoPendingRedemptions(rewardIds) {
  // required here (not at the top) to avoid load-order problems between models
  const RewardLog = require("./RewardLog");

  const pending = await RewardLog.countDocuments({
    reward: { $in: rewardIds },
    redeemed: { $ne: true }, // false, missing, or null all count as "not yet redeemed"
  });

  if (pending > 0) {
    throw Object.assign(
      new Error(
        `Can't remove this reward. ${pending} redemption(s) are not yet fully redeemed.`
      ),
      { status: 409, code: "REWARD_HAS_PENDING_REDEMPTIONS" }
    );
  }
}

// Reward.findByIdAndDelete(id) and Reward.findOneAndDelete(filter)
rewardSchema.pre("findOneAndDelete", async function () {
  const doc = await this.model.findOne(this.getFilter()).select("_id").lean();
  if (doc) await assertNoPendingRedemptions([doc._id]);
});

// Reward.deleteOne(filter)
rewardSchema.pre("deleteOne", { document: false, query: true }, async function () {
  const doc = await this.model.findOne(this.getFilter()).select("_id").lean();
  if (doc) await assertNoPendingRedemptions([doc._id]);
});

// rewardDoc.deleteOne()
rewardSchema.pre("deleteOne", { document: true, query: false }, async function () {
  await assertNoPendingRedemptions([this._id]);
});

// Reward.deleteMany(filter)
rewardSchema.pre("deleteMany", async function () {
  const docs = await this.model.find(this.getFilter()).select("_id").lean();
  if (docs.length) await assertNoPendingRedemptions(docs.map((d) => d._id));
});

module.exports = mongoose.model("Reward", rewardSchema);
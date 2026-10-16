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

module.exports = mongoose.model("Reward", rewardSchema);
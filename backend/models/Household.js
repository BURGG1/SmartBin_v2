const mongoose = require("mongoose");

const householdSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: [true, "Fullname is required"], trim: true },
    birthday: { type: Date, default: null },
    familyMember: { type: Number, min: [1, "Family member count must be at least 1"], default: null },
    address: {
      houseNo: { type: String, trim: true, default: null },
      street: { type: String, trim: true, default: null },
    },
    contactNumber: { type: String, required: [true, "Contact number is required"], trim: true, sparse: true },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
      sparse: true,
    },
    rfid: { type: String, required: [true, "RFID is required"], unique: true, trim: true },
    password: { type: String, default: null },
    isActive: { type: Boolean, default: true },

    points: {
      total: { type: Number, default: 0 },
      thisMonth: { type: Number, default: 0 },
    },

    streak: {
      currentStreak: { type: Number, default: 0 },
      awardedStreaks: { type: [Number], default: [] },
      lastDisposalDate: { type: Date, default: null },
      lastDailyAward: { type: Date, default: null },   // ← add this
      lastWeeklyAward: { type: Date, default: null },
      lastMonthlyAward: { type: Date, default: null },
    },

    // ── Violation tracking ───────────────────────────
    violation: { type: Number, default: 0, min: 0 }, // 0 = no offense, resets after 3rd

    resetPasswordCodeHash: { type: String, default: null },
    resetPasswordExpires: { type: Date, default: null },
    resetPasswordAttempts: { type: Number, default: 0 },
    resetPasswordLockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

householdSchema.index({ fullname: "text" });

module.exports = mongoose.model("Household", householdSchema);
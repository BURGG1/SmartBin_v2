
const mongoose = require("mongoose");

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    lat: { type: Number },
    lng: { type: Number },
    lastSeen: { type: Date },

    assignedBin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Bin",
      default: null,
    },

    status: {
      type: String,
      enum: ["online", "offline"],
      default: "offline",
    },

    fillLevel: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },

    distanceCm: {
      type: Number,
      default: null,
    },

    lastFillUpdate: {
      type: Date,
      default: null,
    },

    // Device authentication
    authEnabled: {
      type: Boolean,
      default: false,
    },

    keyHash: {
      type: String,
      default: null,
      select: false,
    },

    encryptedSecret: {
      type: String,
      default: null,
      select: false,
    },

    keyVersion: {
      type: Number,
      default: 0,
    },

    provisionedAt: {
      type: Date,
      default: null,
    },

    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Device", deviceSchema);

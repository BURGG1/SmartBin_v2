const mongoose = require("mongoose");

const binSchema = new mongoose.Schema(
  {
    binId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["Biodegradable", "Non-biodegradable", "Recyclable"],
    },
    capacity: {
      type: String,
      required: true,
      enum: ["100L", "500L"],
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    fill: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    lastEmptied: {
      type: Date,
      default: null,
    },    
    lowSince: {
      type: Date,
      default: null,
    },
    lat: {
      type: Number,
      default: null,
    },
    lng: {
      type: Number,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["online", "offline"],
      default: "offline",
    },
    lastHeartbeat: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bin", binSchema);

const mongoose = require("mongoose");

const COMPONENT_STATUSES = [
  "working",
  "warning",
  "fault",
  "unknown",
];

const diagnosticComponentSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: COMPONENT_STATUSES,
      default: "unknown",
    },
    message: {
      type: String,
      default: "",
      maxlength: 240,
    },
  },
  { _id: false }
);

const diagnosticComponentsSchema = new mongoose.Schema(
  {
    wifi: { type: diagnosticComponentSchema, default: () => ({}) },
    rfid: { type: diagnosticComponentSchema, default: () => ({}) },
    fillSensor: { type: diagnosticComponentSchema, default: () => ({}) },
    objectSensor: { type: diagnosticComponentSchema, default: () => ({}) },
    gps: { type: diagnosticComponentSchema, default: () => ({}) },
    actuator: { type: diagnosticComponentSchema, default: () => ({}) },
    solenoid: { type: diagnosticComponentSchema, default: () => ({}) },
    backend: { type: diagnosticComponentSchema, default: () => ({}) },
  },
  { _id: false }
);

const diagnosticAlertSchema = new mongoose.Schema(
  {
    title: { type: String, default: "Component alert", maxlength: 100 },
    message: { type: String, default: "", maxlength: 300 },
    at: { type: Date, default: Date.now },
    key: { type: String, default: "", maxlength: 120 },
  },
  { _id: false }
);

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
    lastHeartbeat: {
      type: Date,
      default: null,
    },

    // Diagnostics are separate from heartbeat and scheduling.
    diagnostics: {
      overallStatus: {
        type: String,
        enum: COMPONENT_STATUSES,
        default: "unknown",
      },
      reportedAt: {
        type: Date,
        default: null,
      },
      components: {
        type: diagnosticComponentsSchema,
        default: () => ({}),
      },
      alerts: {
        type: [diagnosticAlertSchema],
        default: [],
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bin", binSchema);

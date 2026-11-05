
const mongoose = require("mongoose");

const deviceRequestNonceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
    },
    nonce: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
  },
  { timestamps: true }
);

deviceRequestNonceSchema.index(
  { deviceId: 1, nonce: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "DeviceRequestNonce",
  deviceRequestNonceSchema
);

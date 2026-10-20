const mongoose = require("mongoose");

const disposalSequenceSchema = new mongoose.Schema({
    binId: { type: String, required: true, unique: true, trim: true },
    value: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

module.exports = mongoose.model("DisposalSequence", disposalSequenceSchema);

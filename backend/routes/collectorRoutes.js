const express = require("express");
const router = express.Router();
const Collector = require("../models/Collector");
const { protect } = require("../middleware/authMiddleware");


router.get("/", protect, async (req, res) => {
  try {
    const collectors = await Collector.find().select("-password");
    res.json({ success: true, data: collectors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/collectors/:id/assign-bin
router.patch("/:id/assign-bin", protect, async (req, res) => {
  const { binId } = req.body;
  const collector = await Collector.findById(req.params.id);
  if (!collector) return res.status(404).json({ success: false, message: "Collector not found." });
  if (collector.assignedBins.length >= 2) {
    return res.status(409).json({ success: false, message: "Collector already has 2 bins assigned." });
  }
  collector.assignedBins.push(binId);
  await collector.save();
  res.json({ success: true, data: collector });
});

// GET /api/collectors/me — get logged-in collector's profile
router.get("/me", protect, async (req, res) => {
  try {
    const collector = await Collector.findById(req.user.id).select("-password");
    if (!collector) {
      return res.status(404).json({ success: false, message: "Collector not found." });
    }
    res.json({ success: true, data: collector });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
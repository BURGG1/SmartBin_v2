const express = require("express");
const router = express.Router();
const Collector = require("../models/Collector");
const Bin = require("../models/Bin");
const BinSchedule = require("../models/BinSchedule");
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

// ═══════════════════════════════════════════════════════════════
// GET /api/collectors/me/dashboard
// Everything the collector home screen needs in one call:
// profile summary, current assigned bins (with live fill + schedule
// time), recent completed collections, and today's collection count.
// ═══════════════════════════════════════════════════════════════
router.get("/me/dashboard", protect, async (req, res) => {
  try {
    const collector = await Collector.findById(req.user.id).select("-password");
    if (!collector) {
      return res.status(404).json({ success: false, message: "Collector not found." });
    }

    // ── Assigned bins: live bin data (location, current fill) joined
    // with this collector's pending schedule for each, if one exists.
    const [bins, pendingSchedules] = await Promise.all([
      Bin.find({ binId: { $in: collector.assignedBins } }),
      BinSchedule.find({ collector: collector._id, status: "pending" }),
    ]);

    const scheduleByBinId = new Map(pendingSchedules.map((s) => [s.binId, s]));

    const assignedBins = bins.map((bin) => {
      const schedule = scheduleByBinId.get(bin.binId);
      return {
        id: bin.binId,
        location: bin.location,
        fill: bin.fill ?? 0,
        scheduleDate: schedule
          ? new Date(schedule.scheduledAt).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            })
          : null,
        scheduleTime: schedule
          ? new Date(schedule.scheduledAt).toLocaleTimeString("en-US", {
              hour: "numeric", minute: "2-digit",
            })
          : null,
      };
    });

    // ── Recent activity: this collector's last 10 completed pickups,
    // with bin location populated from the schedule's bin reference.
    const recentSchedules = await BinSchedule.find({
      collector: collector._id,
      status: "completed",
    })
      .sort({ completedAt: -1 })
      .limit(10)
      .populate("bin", "location");

    const recentCollections = recentSchedules.map((s) => ({
      bin: s.binId,
      location: s.bin?.location ?? "—",
      date: s.completedAt
        ? new Date(s.completedAt).toLocaleDateString("en-US", {
            month: "short", day: "numeric", year: "numeric",
          })
        : "—",
      time: s.completedAt
        ? new Date(s.completedAt).toLocaleTimeString("en-US", {
            hour: "numeric", minute: "2-digit",
          })
        : "Pending",
      status: "Collected",
    }));

    // ── Collections completed today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const collectedToday = await BinSchedule.countDocuments({
      collector: collector._id,
      status: "completed",
      completedAt: { $gte: startOfDay, $lt: endOfDay },
    });

    res.json({
      success: true,
      data: {
        collector: {
          id: collector.employeeId,
          name: collector.name,
          assignedArea: collector.assignedBarangay,
          contact: collector.contact,
          collectedToday,
        },
        assignedBins,
        recentCollections,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
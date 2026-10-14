const router = require("express").Router();
const Household = require("../models/Household");
const ViolationLog = require("../models/ViolationLog");

router.get("/compliance", async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 6;
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - (months - 1));
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);

    const TZ = "Asia/Manila";

    // Step 1: distinct households with a violation, grouped by month (local timezone)
    const violationsByMonth = await ViolationLog.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: TZ } },
            household: "$household",
          },
        },
      },
      {
        $group: {
          _id: "$_id.month",
          nonCompliantHouseholds: { $sum: 1 },
        },
      },
    ]);

    // Step 2: build month keys using LOCAL date parts — no UTC conversion at all
    const monthKeys = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthKeys.push(key);
    }

    // Step 3: for each month, count households registered by that point, and compute %
    const results = [];
    for (const monthKey of monthKeys) {
      const [y, m] = monthKey.split("-").map(Number);
      const endOfMonth = new Date(y, m, 1); // first day of the NEXT month (local)

      const totalHouseholds = await Household.countDocuments({
        createdAt: { $lt: endOfMonth },
        isActive: true,
      });

      const violationEntry = violationsByMonth.find((v) => v._id === monthKey);

      // Math.min makes sure the violators can never be more than the total
      // (e.g. a household that was deactivated later but still has a violation)
      const nonCompliantHouseholds = Math.min(
        violationEntry ? violationEntry.nonCompliantHouseholds : 0,
        totalHouseholds
      );
      const compliantHouseholds = totalHouseholds - nonCompliantHouseholds;

      const nonCompliant = totalHouseholds > 0
        ? Math.round((nonCompliantHouseholds / totalHouseholds) * 100)
        : 0;
      const compliant = totalHouseholds > 0 ? 100 - nonCompliant : 0;

      results.push({
        month: new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short" }),
        compliant,
        nonCompliant,
        // NEW: the actual numbers, used by the chart tooltip
        compliantCount: compliantHouseholds,
        nonCompliantCount: nonCompliantHouseholds,
        total: totalHouseholds,
      });
    }

    res.json({ success: true, data: results });
  } catch (err) {
    console.error("Compliance analytics error:", err);
    res.status(500).json({ success: false, message: "Failed to compute compliance trend" });
  }
});

module.exports = router;
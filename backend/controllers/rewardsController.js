const mongoose = require("mongoose");
const Reward = require("../models/Reward");
const RewardLog = require("../models/RewardLog");
const Household = require("../models/Household");

// GET /api/rewards
const getAllRewards = async (req, res) => {
  try {
    const rewards = await Reward.find().sort({ createdAt: -1 });
    res.json({ success: true, data: rewards });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/rewards/:id/redeem
// body: { householdId }
const redeemReward = async (req, res) => {
  const { id } = req.params;
  const { householdId } = req.body;

  if (!householdId) {
    return res.status(400).json({ success: false, message: "householdId is required." });
  }
  if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(householdId)) {
    return res.status(400).json({ success: false, message: "Invalid id supplied." });
  }

  const session = await mongoose.startSession();
  try {
    let result;

    await session.withTransaction(async () => {
      const reward = await Reward.findById(id).session(session);
      if (!reward) {
        throw Object.assign(new Error("Reward not found."), { status: 404 });
      }

      const household = await Household.findById(householdId).session(session);
      if (!household) {
        throw Object.assign(new Error("Household not found."), { status: 404 });
      }

      if (reward.stocks < 1) {
        throw Object.assign(new Error("This reward is out of stock."), { status: 409 });
      }
      if ((household.points?.total ?? 0) < reward.points) {
        throw Object.assign(new Error("Not enough points to redeem this reward."), { status: 400 });
      }

      // Conditional atomic writes — guards against two people redeeming the
      // last unit, or a points balance changing between the checks above and here.
      const updatedReward = await Reward.findOneAndUpdate(
        { _id: id, stocks: { $gte: 1 } },
        { $inc: { stocks: -1 } },
        { new: true, session }
      );
      if (!updatedReward) {
        throw Object.assign(new Error("This reward just went out of stock."), { status: 409 });
      }

      const updatedHousehold = await Household.findOneAndUpdate(
        { _id: householdId, "points.total": { $gte: reward.points } },
        { $inc: { "points.total": -reward.points } },
        { new: true, session }
      );
      if (!updatedHousehold) {
        throw Object.assign(new Error("Not enough points to redeem this reward."), { status: 400 });
      }

      const [log] = await RewardLog.create(
        [
          {
            household: householdId,
            reward: reward._id,
            rewardName: reward.name,
            pointsSpent: reward.points,
          },
        ],
        { session }
      );

      result = { reward: updatedReward, household: updatedHousehold, log };
    });

    res.json({
      success: true,
      message: `Redeemed ${result.reward.name} for ${result.log.pointsSpent} points.`,
      data: result,
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// GET /api/rewards/logs?page=1&limit=10&search=
const getRewardLogs = async (req, res) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // ── Search by household name or household ID ("HH-XXXXXXXX") ──
    const query = {};
    const term = typeof search === "string" ? search.trim() : "";
    if (term) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const idPart = term.replace(/^HH-?/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const or = [{ fullname: { $regex: escaped, $options: "i" } }];
      if (idPart) {
        or.push({
          $expr: {
            $regexMatch: { input: { $toString: "$_id" }, regex: idPart, options: "i" },
          },
        });
      }

      const matched = await Household.find({ $or: or }).select("_id").lean();
      query.household = { $in: matched.map((h) => h._id) };
    }

    const [logs, total] = await Promise.all([
      RewardLog.find(query)
        .populate("household", "fullname _id")
        .populate("reward", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      RewardLog.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: logs.map((log) => ({
        _id:           log._id,
        date:          log.createdAt,
        rewardName:    log.rewardName,
        householdId:   log.household?._id
                         ? `HH-${log.household._id.toString().slice(-8).toUpperCase()}`
                         : "—",
        householdName: log.household?.fullname ?? "—",
        stockUpdate:   -1,
        pointsSpent:   log.pointsSpent,
        redeemed:      !!log.redeemed,
        receiptNumber: log.receiptNumber ?? null,
      })),
      pagination: {
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PATCH /api/rewards/logs/:logId/redeem
// body: { receiptNumber }
// Confirms (with a receipt number) that the household claimed this redemption.
// Does NOT touch points or stock — redeemReward already did that.
const redeemRewardLog = async (req, res) => {
  try {
    const { logId } = req.params;
    const receiptNumber = String(req.body.receiptNumber ?? "").trim();

    if (!mongoose.isValidObjectId(logId)) {
      return res.status(400).json({ success: false, message: "Invalid log id." });
    }
    if (!/^[A-Za-z0-9-]{3,}$/.test(receiptNumber)) {
      return res.status(400).json({ success: false, message: "Invalid receipt number." });
    }

    // Only succeeds if this log hasn't been redeemed yet
    const log = await RewardLog.findOneAndUpdate(
      { _id: logId, redeemed: { $ne: true } },
      { $set: { redeemed: true, receiptNumber, redeemedAt: new Date(), redeemedBy: req.user?.name ?? "Admin" } },
      { new: true }
    );
    if (!log) {
      return res.status(409).json({ success: false, message: "Log not found or already redeemed." });
    }

    res.json({ success: true, data: log });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { getAllRewards, redeemReward, getRewardLogs, redeemRewardLog };
const Household = require("../models/Household");
const RfidLog = require("../models/RfidLog");
const PointLog = require("../models/PointLog");
const RewardLog = require("../models/RewardLog");
const ViolationLog = require("../models/ViolationLog");
const { sendPasswordEmail } = require("../config/mailer");
const bcrypt = require("bcryptjs");

// ── Penalty config — single source of truth ──────────────────────────────────
const PENALTY_CONFIG = {
  1: { type: "Point Deduction", pointsDeducted: 500, fineAmount: 0, communityService: null },
  2: { type: "Fine", pointsDeducted: 0, fineAmount: 300, communityService: null },
  3: { type: "Fine + Community Service", pointsDeducted: 0, fineAmount: 800, communityService: "15 Days Community Service" },
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PH_MOBILE_REGEX = /^09\d{9}$/;

// generates a random 8-character password e.g. "Xk3#mP9q"
const generatePassword = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#";
  return Array.from({ length: 8 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
};

// Normalizes any of these into "09182345432":
// "9182345432"     -> "09182345432"
// "09182345432"    -> "09182345432"
// "+639182345432"  -> "09182345432"
// "639182345432"   -> "09182345432"
const normalizeContactNumber = (input) => {
  if (!input || typeof input !== "string") return null;

  let digits = input.replace(/\D/g, ""); // strip spaces, dashes, +, etc.

  if (digits.startsWith("63") && digits.length === 12) {
    digits = "0" + digits.slice(2); // 639182345432 -> 09182345432
  } else if (digits.length === 10 && digits.startsWith("9")) {
    digits = "0" + digits; // 9182345432 -> 09182345432
  }

  return digits;
};

// GET /api/households
const getAllHouseholds = async (req, res) => {
  try {
    const { search, page = 1, limit = 10, isActive } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { fullname: { $regex: search, $options: "i" } },
        { contactNumber: { $regex: search, $options: "i" } },
        { rfid: { $regex: search, $options: "i" } },
        { "address.houseNo": { $regex: search, $options: "i" } },
        { "address.street": { $regex: search, $options: "i" } },
      ];
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [households, total] = await Promise.all([
      Household.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Household.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: households,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/households/:id
const getHouseholdById = async (req, res) => {
  try {
    const household = await Household.findById(req.params.id);
    if (!household)
      return res.status(404).json({ success: false, message: "Household not found" });

    res.json({ success: true, data: household });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/households
const createHousehold = async (req, res) => {
  try {
    const { fullname, birthday, familyMember, address, contactNumber, email, rfid } = req.body;

    const existingRfid = await Household.findOne({ rfid });
    if (existingRfid) {
      return res.status(409).json({
        success: false,
        message: `RFID "${rfid}" is already assigned to another household`,
      });
    }

    const normalizedEmail = email ? email.trim().toLowerCase() : null;
    const normalizedContact = normalizeContactNumber(contactNumber);

    if (normalizedEmail) {
      if (!EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: "Invalid email format." });
      }
      const existingEmail = await Household.findOne({ email: normalizedEmail });
      if (existingEmail) {
        return res.status(409).json({
          success: false,
          message: "This email is already registered.",
        });
      }
    }

    if (normalizedContact) {
      if (!PH_MOBILE_REGEX.test(normalizedContact)) {
        return res.status(400).json({ success: false, message: "Invalid contact number format." });
      }
      const existingContact = await Household.findOne({ contactNumber: normalizedContact });
      if (existingContact) {
        return res.status(409).json({
          success: false,
          message: "This contact number is already registered.",
        });
      }
    }

    // Generate plain password then hash it
    const plainPassword = generatePassword();
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    const household = await Household.create({
      fullname,
      birthday: birthday || null,
      familyMember: familyMember || null,
      address: {
        houseNo: address?.houseNo || null,
        street: address?.street || null,
      },
      contactNumber: normalizedContact,
      email: normalizedEmail,
      rfid,
      password: hashedPassword, // store hashed
    });

    await RfidLog.create({
      rfid,
      household: household._id,
      action: "assign",
      note: `Assigned to ${fullname} during registration`,
    });

    // Send plain password to email
    if (normalizedEmail) {
      await sendPasswordEmail({ to: normalizedEmail, fullname, password: plainPassword });
    }

    res.status(201).json({
      success: true,
      message: normalizedEmail
        ? "Household registered. Login credentials sent to email."
        : "Household registered. No email — credentials not sent.",
      data: household,
    });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(409).json({ success: false, message: "This email is already registered." });
    }
    if (error.code === 11000 && error.keyPattern?.contactNumber) {
      return res.status(409).json({ success: false, message: "This contact number is already registered." });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/households/:id
const updateHousehold = async (req, res) => {
  try {
    const { fullname, birthday, familyMember, address, contactNumber, email, rfid, currentPassword, newPassword } = req.body;

    const household = await Household.findById(req.params.id);
    if (!household)
      return res.status(404).json({ success: false, message: "Household not found" });

    // Handle password change if requested
    if (currentPassword && newPassword) {
      const isMatch = await bcrypt.compare(currentPassword, household.password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: "Current password is incorrect." });
      }
      household.password = await bcrypt.hash(newPassword, 10);
    }

    // RFID reassignment check
    if (rfid && rfid !== household.rfid) {
      const conflict = await Household.findOne({ rfid, _id: { $ne: req.params.id } });
      if (conflict) {
        return res.status(409).json({
          success: false,
          message: `RFID "${rfid}" is already assigned to another household`,
        });
      }
      await RfidLog.create([
        { rfid: household.rfid, household: household._id, action: "unassign", note: `Replaced by new RFID ${rfid}` },
        { rfid, household: household._id, action: "assign", note: `Reassigned to ${fullname || household.fullname}` },
      ]);
    }

    // Email uniqueness (only if changing)
    let normalizedEmail;
    if (email !== undefined) {
      normalizedEmail = email ? email.trim().toLowerCase() : null;

      if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: "Invalid email format." });
      }

      if (normalizedEmail && normalizedEmail !== household.email) {
        const existingEmail = await Household.findOne({
          email: normalizedEmail,
          _id: { $ne: req.params.id },
        });
        if (existingEmail) {
          return res.status(409).json({ success: false, message: "This email is already registered." });
        }
      }
    }

    // Contact number uniqueness (only if changing)
    let normalizedContact;
    if (contactNumber !== undefined) {
      normalizedContact = normalizeContactNumber(contactNumber);

      if (normalizedContact && !PH_MOBILE_REGEX.test(normalizedContact)) {
        return res.status(400).json({ success: false, message: "Invalid contact number format." });
      }

      if (normalizedContact && normalizedContact !== household.contactNumber) {
        const existingContact = await Household.findOne({
          contactNumber: normalizedContact,
          _id: { $ne: req.params.id },
        });
        if (existingContact) {
          return res.status(409).json({ success: false, message: "This contact number is already registered." });
        }
      }
    }

    // Apply updates
    if (fullname) household.fullname = fullname;
    if (birthday) household.birthday = birthday;
    if (familyMember !== undefined) household.familyMember = familyMember;
    if (address) household.address = address;
    if (contactNumber !== undefined) household.contactNumber = normalizedContact;
    if (email !== undefined) household.email = normalizedEmail;
    if (rfid) household.rfid = rfid;

    await household.save();

    res.json({ success: true, message: "Household updated successfully", data: household });
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(409).json({ success: false, message: "This email is already registered." });
    }
    if (error.code === 11000 && error.keyPattern?.contactNumber) {
      return res.status(409).json({ success: false, message: "This contact number is already registered." });
    }
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: messages });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/households/:id (soft delete)
const deleteHousehold = async (req, res) => {
  try {
    const household = await Household.findById(req.params.id);
    if (!household)
      return res.status(404).json({ success: false, message: "Household not found" });

    household.isActive = false;
    await household.save();

    await RfidLog.create({
      rfid: household.rfid,
      household: household._id,
      action: "unassign",
      note: "Household deactivated",
    });

    res.json({ success: true, message: "Household deactivated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/households/count
const getHouseholdCount = async (req, res) => {
  try {
    const count = await Household.countDocuments({ isActive: true });
    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/households/check-email?email=someone@example.com
const checkEmailExists = async (req, res) => {
  try {
    const rawEmail = req.query.email;

    if (!rawEmail || typeof rawEmail !== "string") {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const email = rawEmail.trim().toLowerCase();

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, message: "Invalid email format." });
    }

    // Only active households count as a conflict — deactivated ones shouldn't
    // block re-registration under the same email. Drop the isActive filter
    // if you want deactivated accounts to still count.
    const existing = await Household.findOne({
      email,
      isActive: { $ne: false },
    }).select("_id");

    return res.json({ success: true, exists: !!existing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/households/check-contact?contactNumber=09123456789
const checkContactExists = async (req, res) => {
  try {
    const rawContact = req.query.contactNumber;

    if (!rawContact || typeof rawContact !== "string") {
      return res.status(400).json({ success: false, message: "Contact number is required." });
    }

    const contactNumber = normalizeContactNumber(rawContact);

    if (!PH_MOBILE_REGEX.test(contactNumber)) {
      return res.status(400).json({ success: false, message: "Invalid contact number format." });
    }

    const existing = await Household.findOne({
      contactNumber,
      isActive: { $ne: false },
    }).select("_id");

    return res.json({ success: true, exists: !!existing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/households/:id/award-points
const awardPoints = async (req, res) => {
  try {
    const { points, ruleId, reason, quantity } = req.body;  // ← add quantity

    if (!points || points < 1) {
      return res.status(400).json({ success: false, message: "Points must be at least 1." });
    }

    const household = await Household.findById(req.params.id);
    if (!household) {
      return res.status(404).json({ success: false, message: "Household not found." });
    }

    household.points.total += points;
    household.points.thisMonth += points;
    await household.save();

    await PointLog.create({
      household: household._id,
      rule: ruleId || null,
      points,
      quantity: quantity || 1,   // ← save quantity
      reason: reason || "Manual award",
    });

    res.json({
      success: true,
      message: `${points} points awarded to ${household.fullname}`,
      data: {
        totalPoints: household.points.total,
        thisMonth: household.points.thisMonth,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/households/:id/activity?page=1&limit=15&from=2026-01-01
const getHouseholdActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 15, from, to } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // ── Date filter ───────────────────────────────────────────────────────────
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = toDate;
    }

    // ── Point logs (earned) ───────────────────────────────────────────────────
    const pointQuery = { household: id };
    if (from || to) pointQuery.awardedAt = dateFilter;

    const pointLogs = await PointLog.find(pointQuery)
      .populate("rule", "name decs freq")
      .sort({ awardedAt: -1 })
      .lean();

    // ── Reward logs (redeemed) ────────────────────────────────────────────────
    const rewardQuery = { household: id };
    if (from || to) rewardQuery.createdAt = dateFilter;

    const rewardLogs = await RewardLog.find(rewardQuery)
      .populate("reward", "name points")
      .sort({ createdAt: -1 })
      .lean();

    // ── Build quantity label based on rule frequency ──────────────────────────
    const buildQuantityLabel = (qty, freq) => {
      const unitMap = {
        "per kilo": `${qty} kilo${qty !== 1 ? "s" : ""}`,
        "per brick": `${qty} brick${qty !== 1 ? "s" : ""}`,
        "per item": `${qty} item${qty !== 1 ? "s" : ""}`,
        "Per Collection": `${qty} collection${qty !== 1 ? "s" : ""}`,
        "per streak": `${qty} streak${qty !== 1 ? "s" : ""}`,
        "Weekly": `${qty} week${qty !== 1 ? "s" : ""}`,
        "Monthly": `${qty} month${qty !== 1 ? "s" : ""}`,
      };
      return unitMap[freq] ?? `${qty}×`;
    };

    // ── Merge and sort by date ────────────────────────────────────────────────
    const combined = [
      ...pointLogs.map((log) => ({
        _id: log._id,
        type: "Earned points",
        via: log.rule?.name ?? log.reason ?? "Points awarded",
        description: log.rule?.decs ?? log.reason ?? "—",
        amount: buildQuantityLabel(log.quantity ?? 1, log.rule?.freq ?? ""),
        date: log.awardedAt ?? log.createdAt,
        points: log.points,
      })),
      ...rewardLogs.map((log) => ({
        _id: log._id,
        type: "Redeemed Reward",
        via: log.rewardName,
        description: log.rewardName,
        amount: "1 reward",
        date: log.createdAt,
        points: -log.pointsSpent,
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    // ── Paginate ──────────────────────────────────────────────────────────────
    const total = combined.length;
    const paginated = combined.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      data: paginated,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/households/leaderboard
const getLeaderboard = async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const households = await Household.find({ isActive: true })
      .select("fullname address points streak")
      .sort({ "points.total": -1 })
      .limit(parseInt(limit))
      .lean();

    // ── Count disposals from RfidLog (action: "dispose") ─────────────────────
    // Same source as HouseholdRecordModal's disposal log tab
    const RfidLog = require("../models/RfidLog");

    const householdIds = households.map((h) => h._id);

    const disposalCounts = await RfidLog.aggregate([
      {
        $match: {
          household: { $in: householdIds },
          action: "dispose",
        },
      },
      {
        $group: {
          _id: "$household",
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = {};
    disposalCounts.forEach((d) => {
      countMap[d._id.toString()] = d.count;
    });

    const ranked = households.map((hh, index) => ({
      _id: hh._id,
      fullname: hh.fullname,
      address: [hh.address?.houseNo, hh.address?.street].filter(Boolean).join(", ") || "—",
      points: hh.points?.total ?? 0,
      thisMonth: hh.points?.thisMonth ?? 0,
      disposals: countMap[hh._id.toString()] ?? 0,
      streak: hh.streak?.currentStreak ?? 0,
      rank: index + 1,
    }));

    res.json({ success: true, data: ranked });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/households/:id/penalize
const penalizeHousehold = async (req, res) => {
  try {
    const { note, issuedBy } = req.body;

    const household = await Household.findById(req.params.id);
    if (!household) {
      return res.status(404).json({ success: false, message: "Household not found." });
    }
    if (!household.isActive) {
      return res.status(400).json({ success: false, message: "Cannot penalize an inactive household." });
    }

    // Compute new offense number (cycles: 0→1→2→3→1→2→3→...)
    const prevViolation = household.violation ?? 0;
    const newViolation = prevViolation >= 3 ? 1 : prevViolation + 1;
    const penalty = PENALTY_CONFIG[newViolation];

    // Apply point deduction (points can't go below 0)
    if (penalty.pointsDeducted > 0) {
      household.points.total = Math.max(0, (household.points.total ?? 0) - penalty.pointsDeducted);
      household.points.thisMonth = Math.max(0, (household.points.thisMonth ?? 0) - penalty.pointsDeducted);
    }

    household.violation = newViolation;
    await household.save();

    // Log the violation
    const log = await ViolationLog.create({
      household: household._id,
      offenseNumber: newViolation,
      penaltyType: penalty.type,
      pointsDeducted: penalty.pointsDeducted,
      fineAmount: penalty.fineAmount,
      communityService: penalty.communityService,
      note: note || null,
      issuedBy: issuedBy || "Admin",
    });

    return res.status(201).json({
      success: true,
      message: `Penalty applied: ${penalty.type} (Offense #${newViolation})`,
      data: {
        household: {
          _id: household._id,
          fullname: household.fullname,
          violation: household.violation,
          points: household.points,
        },
        penalty: {
          offenseNumber: newViolation,
          penaltyType: penalty.type,
          pointsDeducted: penalty.pointsDeducted,
          fineAmount: penalty.fineAmount,
          communityService: penalty.communityService,
        },
        log,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/households/:id/violations  — violation history
const getViolationLogs = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      ViolationLog.find({ household: req.params.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ViolationLog.countDocuments({ household: req.params.id }),
    ]);

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};


module.exports = {
  getAllHouseholds,
  getHouseholdById,
  createHousehold,
  penalizeHousehold,
  getViolationLogs,
  getLeaderboard,
  updateHousehold,
  deleteHousehold,
  getHouseholdCount,
  checkEmailExists,
  checkContactExists,
  awardPoints,
  getHouseholdActivity,
};
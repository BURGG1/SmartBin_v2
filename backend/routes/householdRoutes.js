
const express = require("express");
const router = express.Router();

const {
  getAllHouseholds,
  getHouseholdById,
  createHousehold,
  updateHousehold,
  deleteHousehold,
  getHouseholdCount,
  checkEmailExists,
  checkContactExists,
  awardPoints,
  getHouseholdActivity,
  getLeaderboard,
  penalizeHousehold,
  getViolationLogs,
  clearViolation,
  completeFirstLogin,
} = require("../controllers/householdController");

const {
  protect,
  allowRoles,
  allowSelfOrAdmin,
} = require("../middleware/authMiddleware");

// PUBLIC ROUTES: Registration and public leaderboard
router.get("/check-email", checkEmailExists);
router.get("/check-contact", checkContactExists);
router.get("/leaderboard", getLeaderboard);

// ALL ROUTES BELOW REQUIRE AUTHENTICATION
router.use(protect);

// ADMIN-ONLY HOUSEHOLD MANAGEMENT
router.route("/")
  .get(allowRoles("admin"), getAllHouseholds)
  .post(allowRoles("admin"), createHousehold);

router.get("/count", allowRoles("admin"), getHouseholdCount);

// ADMIN-ONLY ACTIONS
router.post("/:id/penalize", allowRoles("admin"), penalizeHousehold);
router.get("/:id/violations", allowRoles("admin"), getViolationLogs);

router.patch(
  "/:id/violations/:violationId/clear",
  allowRoles("admin"),
  clearViolation
);

router.post("/:id/award-points", allowRoles("admin"), awardPoints);

// HOUSEHOLD OWNER OR ADMIN
router.patch(
  "/:id/first-login-done",
  allowSelfOrAdmin,
  completeFirstLogin
);

router.get("/:id", allowSelfOrAdmin, getHouseholdById);
router.get("/:id/activity", allowSelfOrAdmin, getHouseholdActivity);

// ADMIN-ONLY ACCOUNT MODIFICATION
router.put("/:id", allowRoles("admin"), updateHousehold);
router.delete("/:id", allowRoles("admin"), deleteHousehold);

module.exports = router;

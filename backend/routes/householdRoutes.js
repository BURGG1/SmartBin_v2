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

const { protect, allowRoles, allowSelfOrAdmin} = require("../middleware/authMiddleware");

// Public endpoints needed for registration and public leaderboard
router.get("/check-email", checkEmailExists);
router.get("/check-contact", checkContactExists);
router.get("/leaderboard", getLeaderboard);

// All remaining routes require authentication
router.use(protect);

// Admin-only household management
router.route("/")
  .get(allowRoles("admin"), getAllHouseholds)
  .post(allowRoles("admin"), createHousehold);

router.get("/count", allowRoles("admin"), getHouseholdCount);

router.post("/:id/penalize", allowRoles("admin"), penalizeHousehold);
router.get("/:id/violations", allowRoles("admin"), getViolationLogs);
router.patch(
  "/:id/violations/:violationId/clear",
  allowRoles("admin"),
  clearViolation
);

router.patch("/:id/first-login-done", completeFirstLogin);

router.route("/:id")
  .get(getHouseholdById)
  .put(allowRoles("admin"), updateHousehold)
  .delete(allowRoles("admin"), deleteHousehold);

router.post("/:id/award-points", allowRoles("admin"), awardPoints);
router.get("/:id/activity", getHouseholdActivity);

module.exports = router;
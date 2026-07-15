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
} = require("../controllers/householdController");
const { protect, allowRoles } = require("../middleware/authMiddleware");

// All public for admin dashboard
router.route("/")
  .get(getAllHouseholds)
  .post(createHousehold);

router.get("/count", getHouseholdCount);
router.get("/check-email", checkEmailExists);      
router.get("/check-contact", checkContactExists); 
router.get("/leaderboard", getLeaderboard);

router.post("/:id/penalize",    penalizeHousehold);
router.get("/:id/violations",   getViolationLogs);


router.route("/:id")
.get(getHouseholdById)
.put(updateHousehold)
.delete(deleteHousehold);

router.post("/:id/award-points", awardPoints);
router.get("/:id/activity", getHouseholdActivity);  
        
module.exports = router;

const express = require("express");
const router = express.Router();

const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  toggleFlag,
  reassignMissedCollection,
} = require("../controllers/notificationController");

const {
  protect,
  allowRoles,
} = require("../middleware/authMiddleware");

// Admin-only notification management
router.use(protect, allowRoles("admin"));

router.get("/", getNotifications);

// Keep this before the /:id routes
router.patch("/read-all", markAllAsRead);

router.patch("/:id/read", markAsRead);
router.patch("/:id/flag", toggleFlag);
router.patch("/:id/reassign", reassignMissedCollection);

module.exports = router;

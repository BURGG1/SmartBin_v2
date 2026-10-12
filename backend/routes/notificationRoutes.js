const express = require("express");
const {
  getNotifications,
  markAsRead,
  markAllAsRead,
  toggleFlag,
} = require("../controllers/notificationController");
const { protect } = require("../middleware/authMiddleware"); // match your actual middleware name/path

const router = express.Router();

router.get("/", protect, getNotifications);
router.patch("/read-all", protect, markAllAsRead); // keep above /:id routes
router.patch("/:id/read", protect, markAsRead);
router.patch("/:id/flag", protect, toggleFlag);

module.exports = router;
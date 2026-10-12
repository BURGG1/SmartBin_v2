const Notification = require("../models/Notification");

const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markAsRead = async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany({ read: false }, { read: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const toggleFlag = async (req, res) => {
  try {
    const notif = await Notification.findById(req.params.id);
    if (!notif) return res.status(404).json({ message: "Not found" });
    notif.flagged = !notif.flagged;
    await notif.save();
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Call this from other controllers to create alerts
// dedupeKey: { type, "meta.binId": "BIN-001" } -> skip if an unread one already exists
const createNotification = async ({ title, message, type = "system", meta = {}, dedupe = null }) => {
  try {
    if (dedupe) {
      const exists = await Notification.findOne({ ...dedupe, read: false });
      if (exists) return exists;
    }
    return await Notification.create({ title, message, type, meta });
  } catch (err) {
    console.error("Notification create failed:", err.message);
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  markAllAsRead,
  toggleFlag,
  createNotification,
};
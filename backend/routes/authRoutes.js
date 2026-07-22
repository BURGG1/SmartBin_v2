const express = require("express");
const router = express.Router();
const { login, forgotPassword, resetPassword } = require("../controllers/authController");
const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require("../middleware/rateLimiter");
const { protect } = require("../middleware/authMiddleware");

router.post("/login", loginLimiter, login);
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);
router.post("/reset-password", resetPasswordLimiter, resetPassword);

// GET /api/auth/me — returns current logged-in user's data
router.get("/me", protect, async (req, res) => {
    try {
        const Household = require("../models/Household");
        const household = await Household.findById(req.user.id);
        if (!household) {
            return res.status(404).json({ success: false, message: "Household not found." });
        }
        res.json({ success: true, data: household });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
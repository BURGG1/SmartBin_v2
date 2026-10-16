const express = require("express");
const router = express.Router();
const Reward = require("../models/Reward");
const { getAllRewards, redeemReward, getRewardLogs, redeemRewardLog } = require("../controllers/rewardsController");
const { upload, cloudinary } = require("../middleware/upload");

// GET /api/rewards
router.get("/", getAllRewards);

// POST /api/rewards/:id/redeem
router.post("/:id/redeem", redeemReward);


// GET /api/rewards/logs
router.get("/logs", getRewardLogs);

// PATCH /api/rewards/logs/:logId/redeem
router.patch("/logs/:logId/redeem", redeemRewardLog);

// GET /api/rewards/:id
router.get("/:id", async (req, res) => {
    try {
        const reward = await Reward.findById(req.params.id);
        if (!reward) return res.status(404).json({ success: false, message: "Reward not found" });
        res.json({ success: true, data: reward });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// POST /api/rewards
router.post("/", upload.single("image"), async (req, res) => {
    try {
        const { name, points, stocks } = req.body;
        if (!name || points === undefined || stocks === undefined) {
            return res.status(400).json({ success: false, message: "Name, points, and stocks are required" });
        }

        // Cloudinary returns full URL in req.file.path
        const reward = await Reward.create({
            name,
            points:  Number(points),
            stocks:  Number(stocks),
            image:   req.file ? req.file.path : "",
        });

        res.status(201).json({ success: true, data: reward });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PUT /api/rewards/:id
router.put("/:id", upload.single("image"), async (req, res) => {
    try {
        const reward = await Reward.findById(req.params.id);
        if (!reward) return res.status(404).json({ success: false, message: "Reward not found" });

        const { name, points, stocks } = req.body;
        if (name !== undefined)   reward.name   = name;
        if (points !== undefined) reward.points = Number(points);
        if (stocks !== undefined) reward.stocks = Number(stocks);

        if (req.file) {
            // Delete old image from Cloudinary
            if (reward.image) {
                const publicId = reward.image.split("/").slice(-2).join("/").split(".")[0];
                await cloudinary.uploader.destroy(publicId);
            }
            reward.image = req.file.path;
        }

        const updated = await reward.save();
        res.json({ success: true, data: updated });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// DELETE /api/rewards/:id
router.delete("/:id", async (req, res) => {
    try {
        const reward = await Reward.findById(req.params.id);
        if (!reward) return res.status(404).json({ success: false, message: "Reward not found" });

        // Delete image from Cloudinary
        if (reward.image) {
            const publicId = reward.image.split("/").slice(-2).join("/").split(".")[0];
            await cloudinary.uploader.destroy(publicId);
        }

        await reward.deleteOne();
        res.json({ success: true, message: "Reward deleted" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
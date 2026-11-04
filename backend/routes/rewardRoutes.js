const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const { protect, allowRoles } = require("../middleware/authMiddleware");
const Reward = require("../models/Reward");

const {
    getAllRewards,
    redeemReward,
    getRewardLogs,
    redeemRewardLog,
} = require("../controllers/rewardsController");

const { upload, cloudinary } = require("../middleware/upload");

const VALID_CLAIM_PERIODS = [
    "day",
    "week",
    "month",
    "year",
    "lifetime",
];

// Validate non-negative whole numbers safely.
function parseNonNegativeInteger(value) {
    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {
        return null;
    }

    const parsed = Number(value);

    return Number.isSafeInteger(parsed) && parsed >= 0
        ? parsed
        : null;
}

// GET /api/rewards
// Public: View all rewards.
router.get("/", getAllRewards);

// GET /api/rewards/logs
// Admin only: View reward redemption logs.
router.get(
    "/logs",
    protect,
    allowRoles("admin"),
    getRewardLogs
);

// PATCH /api/rewards/logs/:logId/redeem
// Admin only: Process or confirm a reward redemption log.
router.patch(
    "/logs/:logId/redeem",
    protect,
    allowRoles("admin"),
    redeemRewardLog
);

// POST /api/rewards/:id/redeem
// Household only: Redeem a reward.
router.post(
    "/:id/redeem",
    protect,
    allowRoles("household"),
    redeemReward
);

// GET /api/rewards/:id
// Public: View a specific reward.
router.get("/:id", async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid reward ID.",
            });
        }

        const reward = await Reward.findById(req.params.id);

        if (!reward) {
            return res.status(404).json({
                success: false,
                message: "Reward not found.",
            });
        }

        return res.json({
            success: true,
            data: reward,
        });
    } catch (err) {
        console.error("Get reward error:", err);

        return res.status(500).json({
            success: false,
            message: "Failed to retrieve reward.",
        });
    }
});

// POST /api/rewards
// Admin only: Create a reward.
router.post(
    "/",
    protect,
    allowRoles("admin"),
    upload.single("image"),
    async (req, res) => {
        try {
            const { name, points, stocks, claimLimit, claimPeriod } = req.body;

            if (
                typeof name !== "string" ||
                !name.trim() ||
                points === undefined ||
                points === "" ||
                stocks === undefined ||
                stocks === ""
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Name, points, and stocks are required.",
                });
            }

            const parsedPoints = parseNonNegativeInteger(points);
            const parsedStocks = parseNonNegativeInteger(stocks);

            const parsedClaimLimit =
                claimLimit === undefined || claimLimit === ""
                    ? 0
                    : parseNonNegativeInteger(claimLimit);

            const parsedClaimPeriod = claimPeriod || "month";

            if (
                parsedPoints === null ||
                parsedStocks === null ||
                parsedClaimLimit === null
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Points, stocks, and claim limit must be non-negative whole numbers.",
                });
            }

            if (!VALID_CLAIM_PERIODS.includes(parsedClaimPeriod)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid claim period.",
                });
            }

            const reward = await Reward.create({
                name: name.trim(),
                points: parsedPoints,
                stocks: parsedStocks,
                claimLimit: parsedClaimLimit,
                claimPeriod: parsedClaimPeriod,
                image: req.file ? req.file.path : "",
            });

            return res.status(201).json({
                success: true,
                data: reward,
            });
        } catch (err) {
            console.error("Create reward error:", err);

            if (err.name === "ValidationError") {
                return res.status(400).json({
                    success: false,
                    message: err.message,
                });
            }

            return res.status(500).json({
                success: false,
                message: "Failed to create reward.",
            });
        }
    }
);

// PUT /api/rewards/:id
// Admin only: Update a reward.
router.put(
    "/:id",
    protect,
    allowRoles("admin"),
    upload.single("image"),
    async (req, res) => {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid reward ID.",
                });
            }

            const reward = await Reward.findById(req.params.id);

            if (!reward) {
                return res.status(404).json({
                    success: false,
                    message: "Reward not found.",
                });
            }

            const { name, points, stocks, claimLimit, claimPeriod } = req.body;

            if (name !== undefined) {
                if (typeof name !== "string" || !name.trim()) {
                    return res.status(400).json({
                        success: false,
                        message: "Reward name cannot be empty.",
                    });
                }

                reward.name = name.trim();
            }

            if (points !== undefined) {
                const parsedPoints = parseNonNegativeInteger(points);

                if (parsedPoints === null) {
                    return res.status(400).json({
                        success: false,
                        message: "Points must be a non-negative whole number.",
                    });
                }

                reward.points = parsedPoints;
            }

            if (stocks !== undefined) {
                const parsedStocks = parseNonNegativeInteger(stocks);

                if (parsedStocks === null) {
                    return res.status(400).json({
                        success: false,
                        message: "Stocks must be a non-negative whole number.",
                    });
                }

                reward.stocks = parsedStocks;
            }

            if (claimLimit !== undefined) {
                const parsedClaimLimit =
                    claimLimit === ""
                        ? null
                        : parseNonNegativeInteger(claimLimit);

                if (parsedClaimLimit === null) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Claim limit must be 0 or a positive whole number.",
                    });
                }

                reward.claimLimit = parsedClaimLimit;
            }

            if (claimPeriod !== undefined) {
                if (!VALID_CLAIM_PERIODS.includes(claimPeriod)) {
                    return res.status(400).json({
                        success: false,
                        message: "Invalid claim period.",
                    });
                }

                reward.claimPeriod = claimPeriod;
            }

            const oldImage = reward.image;

            if (req.file) {
                reward.image = req.file.path;
            }

            const updated = await reward.save();

            // Remove the old image only after saving the new reward data.
            if (req.file && oldImage && oldImage !== req.file.path) {
                try {
                    const publicId = getCloudinaryPublicId(oldImage);

                    if (publicId) {
                        await cloudinary.uploader.destroy(publicId);
                    }
                } catch (imageError) {
                    console.error(
                        "Failed to remove old reward image:",
                        imageError
                    );
                }
            }

            return res.json({
                success: true,
                data: updated,
            });
        } catch (err) {
            console.error("Update reward error:", err);

            if (err.name === "ValidationError") {
                return res.status(400).json({
                    success: false,
                    message: err.message,
                });
            }

            return res.status(500).json({
                success: false,
                message: "Failed to update reward.",
            });
        }
    }
);

// Extract Cloudinary public ID from a standard Cloudinary URL.
function getCloudinaryPublicId(imageUrl) {
    if (typeof imageUrl !== "string" || !imageUrl) {
        return null;
    }

    try {
        const url = new URL(imageUrl);

        if (
            !url.hostname.endsWith("cloudinary.com") ||
            !url.pathname.includes("/upload/")
        ) {
            return null;
        }

        const uploadPath = url.pathname.split("/upload/")[1];
        const parts = uploadPath.split("/");

        // Remove version segment, such as v1234567890.
        const versionIndex = parts.findIndex((part) =>
            /^v\d+$/.test(part)
        );

        const publicIdParts =
            versionIndex >= 0 ? parts.slice(versionIndex + 1) : parts;

        if (publicIdParts.length === 0) {
            return null;
        }

        const lastPart = publicIdParts[publicIdParts.length - 1];

        publicIdParts[publicIdParts.length - 1] =
            lastPart.replace(/\.[^.]+$/, "");

        return publicIdParts.join("/");
    } catch {
        return null;
    }
}

// DELETE /api/rewards/:id
// Admin only: Delete a reward.
router.delete(
    "/:id",
    protect,
    allowRoles("admin"),
    async (req, res) => {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid reward ID.",
                });
            }

            const reward = await Reward.findById(req.params.id);

            if (!reward) {
                return res.status(404).json({
                    success: false,
                    message: "Reward not found.",
                });
            }

            await reward.deleteOne();

            // Image cleanup is best-effort after database deletion.
            if (reward.image) {
                try {
                    const publicId = getCloudinaryPublicId(reward.image);

                    if (publicId) {
                        await cloudinary.uploader.destroy(publicId);
                    }
                } catch (imageError) {
                    console.error(
                        "Failed to remove deleted reward image:",
                        imageError
                    );
                }
            }

            return res.json({
                success: true,
                message: "Reward deleted.",
            });
        } catch (err) {
            console.error("Delete reward error:", err);

            return res.status(500).json({
                success: false,
                message: "Failed to delete reward.",
            });
        }
    }
);

module.exports = router;

const express = require("express");
const router = express.Router();
const Rule = require("../models/Rule");
const { upload, cloudinary } = require("../middleware/upload");

// GET /api/rules
router.get("/", async (req, res) => {
    try {
        const rules = await Rule.find().sort({ createdAt: -1 });

        res.json({
            success: true,
            data: rules
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

// GET /api/rules/:id
router.get("/:id", async (req, res) => {
    try {
        const rule = await Rule.findById(req.params.id);

        if (!rule) {
            return res.status(404).json({
                success: false,
                message: "Rule not found"
            });
        }

        res.json({
            success: true,
            data: rule
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

// POST /api/rules
router.post("/", upload.single("image"), async (req, res) => {
    try {
        const {
            name,
            decs,
            points,
            freq,
            auto,
            streakDays
        } = req.body;

        // Validate required fields
        if (!name || !decs || !points || !freq) {
            return res.status(400).json({
                success: false,
                message: "Name, description, points, and frequency are required"
            });
        }

        // Convert auto to boolean
        const isAuto = auto === "true" || auto === true;

        // Validate streakDays for per streak rules
        let parsedStreakDays = null;

        if (freq === "per streak") {
            parsedStreakDays = Number(streakDays);

            if (
                streakDays === undefined ||
                streakDays === null ||
                String(streakDays).trim() === "" ||
                !Number.isInteger(parsedStreakDays) ||
                parsedStreakDays < 1
            ) {
                return res.status(400).json({
                    success: false,
                    message: "streakDays must be a positive whole number for per streak rules."
                });
            }
        }

        // Create rule
        const rule = await Rule.create({
            name,
            decs,
            points,
            freq,
            auto: isAuto,
            streakDays: parsedStreakDays,
            image: req.file ? req.file.path : ""
        });

        res.status(201).json({
            success: true,
            data: rule
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

// PUT /api/rules/:id
router.put("/:id", upload.single("image"), async (req, res) => {
    try {
        const rule = await Rule.findById(req.params.id);

        if (!rule) {
            return res.status(404).json({
                success: false,
                message: "Rule not found"
            });
        }

        const {
            name,
            decs,
            points,
            freq,
            auto,
            streakDays
        } = req.body;

        // Update provided fields
        if (name !== undefined) rule.name = name;
        if (decs !== undefined) rule.decs = decs;
        if (points !== undefined) rule.points = points;
        if (freq !== undefined) rule.freq = freq;

        if (auto !== undefined) {
            rule.auto = auto === "true" || auto === true;
        }

        // Validate and update streakDays
        if (rule.freq === "per streak") {
            const valueToValidate =
                streakDays !== undefined
                    ? streakDays
                    : rule.streakDays;

            const parsedStreakDays = Number(valueToValidate);

            if (
                valueToValidate === undefined ||
                valueToValidate === null ||
                String(valueToValidate).trim() === "" ||
                !Number.isInteger(parsedStreakDays) ||
                parsedStreakDays < 1
            ) {
                return res.status(400).json({
                    success: false,
                    message: "streakDays must be a positive whole number for per streak rules."
                });
            }

            rule.streakDays = parsedStreakDays;
        } else {
            // Clear streakDays when the rule is not per streak
            rule.streakDays = null;
        }

        // Update image if a new image was uploaded
        if (req.file) {
            if (rule.image) {
                const publicId = rule.image
                    .split("/")
                    .slice(-2)
                    .join("/")
                    .split(".")[0];

                await cloudinary.uploader.destroy(publicId);
            }

            rule.image = req.file.path;
        }

        const updated = await rule.save();

        res.json({
            success: true,
            data: updated
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

// DELETE /api/rules/:id
router.delete("/:id", async (req, res) => {
    try {
        const rule = await Rule.findById(req.params.id);

        if (!rule) {
            return res.status(404).json({
                success: false,
                message: "Rule not found"
            });
        }

        // Delete image from Cloudinary
        if (rule.image) {
            const publicId = rule.image
                .split("/")
                .slice(-2)
                .join("/")
                .split(".")[0];

            await cloudinary.uploader.destroy(publicId);
        }

        await rule.deleteOne();

        res.json({
            success: true,
            message: "Rule deleted"
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
});

module.exports = router;

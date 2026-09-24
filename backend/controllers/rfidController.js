const Household      = require("../models/Household");
const RfidLog        = require("../models/RfidLog");
const Bin            = require("../models/Bin");
const { cloudinary } = require("../middleware/upload");
const { normalizeRfid } = require("../utils/normalize");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function logScan({ rfid, householdId = null, binId = null, action, note, disposalOrder = null }) {
    return RfidLog.create({
        rfid,
        household:    householdId,
        binId,
        action,
        note,
        disposalOrder,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BIN SCAN
//    POST /api/rfid/bin-scan  (also aliased to /scan and /scan-bin)
//    Called by ESP32 when a card is tapped at a physical bin.
//    Registered   → opens bin, logs disposal with disposal order
//    Unregistered → denies access, logs scan
// ─────────────────────────────────────────────────────────────────────────────
const binScan = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.body.rfid);
        const { binId, lat, lng } = req.body;

        // Validate
        if (!rfid) {
            return res.status(400).json({ success: false, message: "rfid is required." });
        }
        if (!binId) {
            return res.status(400).json({ success: false, message: "binId is required." });
        }

        // Verify bin exists
        const bin = await Bin.findOne({ binId, isActive: true });
        if (!bin) {
            return res.status(404).json({ success: false, message: `Bin ${binId} not found.` });
        }

        // Look up household
        const household = await Household.findOne({ rfid, isActive: true });

        // Unregistered card — deny access
        if (!household) {
            await logScan({
                rfid,
                binId,
                action: "scan",
                note:   `Unregistered RFID scanned at ${binId} — access denied`,
            });

            return res.status(404).json({
                success: false,
                message: "RFID not registered.",
                rfid,
            });
        }

        // Registered — compute disposal order for this bin
        const existingCount = await RfidLog.countDocuments({ binId, action: "dispose" });
        const disposalOrder = existingCount + 1;

        // Save GPS coords to bin if provided
        if (lat && lng) {
            await Bin.findOneAndUpdate({ binId }, { lat, lng });
        }

        await logScan({
            rfid,
            householdId:  household._id,
            binId,
            action:       "dispose",
            disposalOrder,
            note:         `${household.fullname} tapped at ${binId} (${bin.type})`,
        });

        return res.json({
            success: true,
            message: "Access granted. Bin opening.",
            data: {
                household:    household.fullname,
                binId,
                binType:      bin.type,
                disposalOrder,
                scannedAt:    new Date(),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. WEB SCAN
//    POST /api/rfid/web-scan
//    Called by the web dashboard admin desk reader.
//    Registered   → returns household info
//    Unregistered → returns RFID for pre-filling registration form
// ─────────────────────────────────────────────────────────────────────────────
const webScan = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.body.rfid);

        if (!rfid) {
            return res.status(400).json({ success: false, message: "rfid is required." });
        }

        const household = await Household.findOne({ rfid, isActive: true });

        // Unregistered — log and return RFID for form pre-fill
        if (!household) {
            await logScan({
                rfid,
                action: "scan",
                note:   "Unregistered RFID scanned at web desk — pending registration",
            });

            return res.status(404).json({
                success:     false,
                message:     "RFID not registered.",
                rfid,
                canRegister: true,
            });
        }

        // Registered — log and return household info
        await logScan({
            rfid,
            householdId: household._id,
            action:      "scan",
            note:        "Web desk scan — already registered",
        });

        return res.json({
            success: true,
            message: "RFID already registered.",
            data: {
                household: {
                    id:            household._id,
                    fullname:      household.fullname,
                    address:       household.address,
                    contactNumber: household.contactNumber,
                    email:         household.email,
                    rfid:          household.rfid,
                },
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. LATEST SCAN
//    GET /api/rfid/latest-scan
//    Web dashboard polls this to auto-fill the RFID field during registration.
//    Only returns scans from the last 5 seconds that are unregistered.
// ─────────────────────────────────────────────────────────────────────────────
const getLatestScan = async (req, res) => {
    try {
        const latest = await RfidLog.findOne({
            action:    "scan",
            household: null,
        }).sort({ scannedAt: -1 });

        if (!latest) {
            return res.json({ success: false, message: "No pending scan." });
        }

        const fiveSecondsAgo = new Date(Date.now() - 5000);
        if (latest.scannedAt < fiveSecondsAgo) {
            return res.json({ success: false, message: "No recent scan." });
        }

        return res.json({ success: true, rfid: latest.rfid });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. CHECK RFID AVAILABILITY
//    GET /api/rfid/check/:rfid
//    Used during registration to check if an RFID is already taken.
// ─────────────────────────────────────────────────────────────────────────────
const checkRfid = async (req, res) => {
    try {
        const rfid     = normalizeRfid(req.params.rfid);
        const existing = await Household.findOne({ rfid });

        if (existing) {
            return res.json({
                success:   true,
                available: false,
                message:   `RFID is already assigned to ${existing.fullname}`,
            });
        }

        return res.json({
            success:   true,
            available: true,
            message:   "RFID is available.",
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. ALL RFID LOGS
//    GET /api/rfid/logs
//    Paginated, filterable by rfid, action, binId.
// ─────────────────────────────────────────────────────────────────────────────
const getRfidLogs = async (req, res) => {
    try {
        const { rfid, action, binId, page = 1, limit = 20 } = req.query;

        const query = {};
        if (rfid)   query.rfid   = normalizeRfid(rfid);
        if (action) query.action = action;
        if (binId)  query.binId  = binId;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [logs, total] = await Promise.all([
            RfidLog.find(query)
                .populate("household", "fullname address contactNumber email")
                .sort({ scannedAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            RfidLog.countDocuments(query),
        ]);

        return res.json({
            success: true,
            data:    logs,
            pagination: {
                total,
                page:       parseInt(page),
                limit:      parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit)),
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. RFID HISTORY FOR ONE CARD
//    GET /api/rfid/logs/:rfid
//    Full scan history for a specific RFID card.
// ─────────────────────────────────────────────────────────────────────────────
const getRfidHistory = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.params.rfid);
        const logs = await RfidLog.find({ rfid })
            .populate("household", "fullname address contactNumber email")
            .sort({ scannedAt: -1 });

        return res.json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. FLAG A LOG ENTRY
//    PATCH /api/rfid/logs/:id/flag
//    Flags or unflags a disposal log with an optional Cloudinary evidence photo.
// ─────────────────────────────────────────────────────────────────────────────
const flagLog = async (req, res) => {
    try {
        const { flagged } = req.body;
        const log = await RfidLog.findById(req.params.id);

        if (!log) {
            return res.status(404).json({ success: false, message: "Log not found." });
        }

        log.flagged   = flagged === "true" || flagged === true;
        log.flaggedAt = log.flagged ? new Date() : null;

        if (log.flagged && req.file) {
            // Delete old evidence photo from Cloudinary if it exists
            if (log.evidencePhoto) {
                try {
                    const publicId = log.evidencePhoto
                        .split("/").slice(-2).join("/").split(".")[0];
                    await cloudinary.uploader.destroy(publicId);
                } catch (err) {
                    console.warn("[Cloudinary] Failed to delete old evidence:", err.message);
                }
            }
            // Save new Cloudinary URL
            log.evidencePhoto = req.file.path;
        }

        // Clear evidence photo when unflagging
        if (!log.flagged && log.evidencePhoto) {
            try {
                const publicId = log.evidencePhoto
                    .split("/").slice(-2).join("/").split(".")[0];
                await cloudinary.uploader.destroy(publicId);
            } catch (err) {
                console.warn("[Cloudinary] Failed to delete evidence on unflag:", err.message);
            }
            log.evidencePhoto = null;
        }

        await log.save();
        return res.json({ success: true, data: log });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    binScan,
    webScan,
    getLatestScan,
    checkRfid,
    getRfidLogs,
    getRfidHistory,
    flagLog,
};

const Household = require("../models/Household");
const RfidLog = require("../models/RfidLog");
const Bin = require("../models/Bin");
const Collector = require("../models/Collector");
const { cloudinary } = require("../middleware/upload");
const { createNotification } = require("./notificationController");
const { normalizeRfid } = require("../utils/normalize");
const { extractStampCandidates } = require("../utils/stampOCR");

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function logScan({
    rfid,
    householdId = null,
    binId = null,
    action,
    note,
    disposalOrder = null,
}) {
    return RfidLog.create({
        rfid,
        household: householdId,
        binId,
        action,
        note,
        disposalOrder,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. BIN SCAN
// POST /api/rfid/bin-scan
//
// Allows scanning even when a bin is offline or isActive === false.
// Only an active, registered household RFID is authorized.
// ─────────────────────────────────────────────────────────────────────────────

const binScan = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.body.rfid);
        const { binId, lat, lng } = req.body;
        if (!rfid) return res.status(400).json({ success: false, message: "rfid is required." });
        if (!binId) return res.status(400).json({ success: false, message: "binId is required." });

        const bin = await Bin.findOne({ binId }).lean();
        if (!bin) return res.status(404).json({ success: false, message: `Bin ${binId} not found.` });

        const household = await Household.findOne({ rfid, isActive: true });
        if (!household) {
            await logScan({ rfid, binId, action: "scan", note: `Unregistered or inactive RFID scanned at ${binId} — access denied` });
            return res.status(404).json({ success: false, message: "RFID not registered or inactive.", rfid });
        }

        if (lat !== undefined && lat !== null && lng !== undefined && lng !== null) {
            await Bin.findOneAndUpdate({ binId }, { $set: { lat, lng } });
        }

        // IMPORTANT: an RFID tap is authorization only. It must not create a dispose log
        // or advance the disposal order. The completed stamping cycle does that separately.
        await logScan({ rfid, householdId: household._id, binId, action: "scan", note: `${household.fullname} authorized bin access at ${binId} (${bin.type})` });
        return res.json({
            success: true,
            message: "Access granted. Bin opening.",
            data: { household: household.fullname, binId, binType: bin.type, scannedAt: new Date() },
        });
    } catch (error) {
        console.error("[binScan]", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/rfid/complete-disposal
// Idempotent: retrying the same cycleId returns the already-created disposal record.
const completeDisposal = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.body.rfid);
        const { binId, cycleId } = req.body;
        if (!rfid || !binId || !cycleId || typeof cycleId !== "string") {
            return res.status(400).json({ success: false, message: "rfid, binId and cycleId are required." });
        }
        if (cycleId.length > 64) return res.status(400).json({ success: false, message: "cycleId is too long." });

        const bin = await Bin.findOne({ binId }).lean();
        if (!bin) return res.status(404).json({ success: false, message: `Bin ${binId} not found.` });
        const household = await Household.findOne({ rfid, isActive: true });
        if (!household) return res.status(404).json({ success: false, message: "RFID not registered or inactive." });

        const existing = await RfidLog.findOne({ binId, cycleId }).lean();
        if (existing) {
            return res.json({ success: true, duplicate: true, message: "Disposal already recorded.", data: { cycleId, disposalOrder: existing.disposalOrder, logId: existing._id } });
        }

        // Use a dedicated atomic per-bin counter rather than countDocuments()+1.
        // The sequence may have gaps if simultaneous duplicate requests race, but orders
        // cannot be assigned the same value by this allocator.
        const DisposalSequence = require("../models/DisposalSequence");
        // Bootstrap the sequence from historical dispose logs the first time this
        // bin uses the new allocator, so deployment does not restart numbering at 1.
        const sequenceExists = await DisposalSequence.findOne({ binId }).lean();
        if (!sequenceExists) {
            const latestExisting = await RfidLog.findOne({ binId, action: "dispose" })
                .sort({ disposalOrder: -1 })
                .select("disposalOrder")
                .lean();
            const startingValue = latestExisting && Number.isFinite(latestExisting.disposalOrder)
                ? latestExisting.disposalOrder
                : 0;
            try {
                await DisposalSequence.updateOne(
                    { binId },
                    { $setOnInsert: { binId, value: startingValue } },
                    { upsert: true }
                );
            } catch (bootstrapError) {
                // Another completion request may have initialized the same bin.
                if (!bootstrapError || bootstrapError.code !== 11000) throw bootstrapError;
            }
        }
        const sequence = await DisposalSequence.findOneAndUpdate(
            { binId },
            { $inc: { value: 1 } },
            { new: true }
        );
        const disposalOrder = sequence.value;
        try {
            const log = await RfidLog.create({
                rfid, household: household._id, binId, action: "dispose", disposalOrder,
                cycleId,
                note: `${household.fullname} completed stamping cycle ${cycleId} at ${binId}`,
            });
            return res.status(201).json({ success: true, duplicate: false, message: "Completed disposal recorded.", data: { cycleId, disposalOrder, logId: log._id } });
        } catch (createError) {
            // A concurrent retry may have won the unique cycleId index.
            if (createError && createError.code === 11000) {
                const duplicate = await RfidLog.findOne({ binId, cycleId }).lean();
                if (duplicate) return res.json({ success: true, duplicate: true, message: "Disposal already recorded.", data: { cycleId, disposalOrder: duplicate.disposalOrder, logId: duplicate._id } });
            }
            throw createError;
        }
    } catch (error) {
        console.error("[completeDisposal]", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. WEB SCAN
// POST /api/rfid/web-scan
// ─────────────────────────────────────────────────────────────────────────────

const webScan = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.body.rfid);

        if (!rfid) {
            return res.status(400).json({
                success: false,
                message: "rfid is required.",
            });
        }

        const household = await Household.findOne({
            rfid,
            isActive: true,
        });

        if (!household) {
            await logScan({
                rfid,
                action: "scan",
                note: "Unregistered RFID scanned at web desk — pending registration",
            });

            return res.status(404).json({
                success: false,
                message: "RFID not registered.",
                rfid,
                canRegister: true,
            });
        }

        await logScan({
            rfid,
            householdId: household._id,
            action: "scan",
            note: "Web desk scan — already registered",
        });

        return res.json({
            success: true,
            message: "RFID already registered.",
            data: {
                household: {
                    id: household._id,
                    fullname: household.fullname,
                    address: household.address,
                    contactNumber: household.contactNumber,
                    email: household.email,
                    rfid: household.rfid,
                },
            },
        });
    } catch (error) {
        console.error("[webScan]", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. LATEST SCAN
// GET /api/rfid/latest-scan
// ─────────────────────────────────────────────────────────────────────────────

const getLatestScan = async (req, res) => {
    try {
        const latest = await RfidLog.findOne({
            action: "scan",
            household: null,
        }).sort({ scannedAt: -1 });

        if (!latest) {
            return res.json({
                success: false,
                message: "No pending scan.",
            });
        }

        const fiveSecondsAgo = new Date(Date.now() - 5000);

        if (latest.scannedAt < fiveSecondsAgo) {
            return res.json({
                success: false,
                message: "No recent scan.",
            });
        }

        return res.json({
            success: true,
            rfid: latest.rfid,
        });
    } catch (error) {
        console.error("[getLatestScan]", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. CHECK RFID AVAILABILITY
// GET /api/rfid/check/:rfid
// ─────────────────────────────────────────────────────────────────────────────

const checkRfid = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.params.rfid);
        const existing = await Household.findOne({ rfid });

        if (existing) {
            return res.json({
                success: true,
                available: false,
                message: `RFID is already assigned to ${existing.fullname}`,
            });
        }

        return res.json({
            success: true,
            available: true,
            message: "RFID is available.",
        });
    } catch (error) {
        console.error("[checkRfid]", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. ALL RFID LOGS
// GET /api/rfid/logs
// ─────────────────────────────────────────────────────────────────────────────

const getRfidLogs = async (req, res) => {
    try {
        const {
            rfid,
            action,
            binId,
            page = 1,
            limit = 20,
        } = req.query;

        const query = {};

        if (rfid) query.rfid = normalizeRfid(rfid);
        if (action) query.action = action;
        if (binId) query.binId = binId;

        const parsedPage = Math.max(1, parseInt(page, 10) || 1);
        const parsedLimit = Math.max(1, parseInt(limit, 10) || 20);
        const skip = (parsedPage - 1) * parsedLimit;

        const [logs, total] = await Promise.all([
            RfidLog.find(query)
                .populate(
                    "household",
                    "fullname address contactNumber email violation"
                )
                .sort({ scannedAt: -1 })
                .skip(skip)
                .limit(parsedLimit),

            RfidLog.countDocuments(query),
        ]);

        return res.json({
            success: true,
            data: logs,
            pagination: {
                total,
                page: parsedPage,
                limit: parsedLimit,
                totalPages: Math.ceil(total / parsedLimit),
            },
        });
    } catch (error) {
        console.error("[getRfidLogs]", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. RFID HISTORY FOR ONE CARD
// GET /api/rfid/logs/:rfid
// ─────────────────────────────────────────────────────────────────────────────

const getRfidHistory = async (req, res) => {
    try {
        const rfid = normalizeRfid(req.params.rfid);

        const logs = await RfidLog.find({ rfid })
            .populate(
                "household",
                "fullname address contactNumber email violation"
            )
            .sort({ scannedAt: -1 });

        return res.json({
            success: true,
            data: logs,
        });
    } catch (error) {
        console.error("[getRfidHistory]", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 7. FLAG A LOG ENTRY
// PATCH /api/rfid/logs/:id/flag
// ─────────────────────────────────────────────────────────────────────────────

const flagLog = async (req, res) => {
    try {
        const { flagged } = req.body;
        const log = await RfidLog.findById(req.params.id);

        if (!log) {
            return res.status(404).json({
                success: false,
                message: "Log not found.",
            });
        }

        log.flagged = flagged === "true" || flagged === true;
        log.flaggedAt = log.flagged ? new Date() : null;

        if (log.flagged && req.file) {
            if (log.evidencePhoto) {
                await destroyEvidence(log.evidencePhoto);
            }

            log.evidencePhoto = req.file.path;
        }

        if (!log.flagged && log.evidencePhoto) {
            await destroyEvidence(log.evidencePhoto);
            log.evidencePhoto = null;
        }

        await log.save();

        return res.json({
            success: true,
            data: log,
        });
    } catch (error) {
        console.error("[flagLog]", error);

        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// 8. STAMP SCAN / FLAG — COLLECTOR MOBILE APP
// ─────────────────────────────────────────────────────────────────────────────

const STAMP_RE = /^\d{1,6}$/;

const toPreview = (log) => ({
    logId: log._id,
    stampNumber: String(log.disposalOrder).padStart(6, "0"),
    binId: log.binId,
    household: log.household
        ? { fullname: log.household.fullname }
        : null,
    scannedAt: log.scannedAt,
    flagged: !!log.flagged,
    flaggedAt: log.flaggedAt,
});

async function destroyEvidence(url) {
    try {
        const publicId = url
            .split("/")
            .slice(-2)
            .join("/")
            .split(".")[0];

        await cloudinary.uploader.destroy(publicId);
    } catch (error) {
        console.warn(
            "[Cloudinary] Failed to delete evidence:",
            error.message
        );
    }
}

async function assertAssignedBin(userId, binId) {
    const collector = await Collector.findById(userId)
        .select("assignedBins isActive");

    if (!collector || collector.isActive === false) {
        return {
            status: 403,
            message: "Collector account is not active.",
        };
    }

    if (!collector.assignedBins.includes(binId)) {
        return {
            status: 403,
            message: "This bin is not assigned to you.",
        };
    }

    return null;
}

async function findBag(binId, orders) {
    const logs = await RfidLog.find({
        binId,
        action: "dispose",
        disposalOrder: { $in: orders },
    })
        .sort({ scannedAt: -1 })
        .limit(5)
        .populate("household", "fullname");

    if (logs.length === 0) {
        return {
            status: 404,
            message: "Trash bag record not found.",
        };
    }

    if (new Set(logs.map((log) => log.disposalOrder)).size > 1) {
        return {
            status: 422,
            message:
                "More than one stamp number detected. Retake the photo closer to the stamp.",
        };
    }

    if (logs.length > 1) {
        return {
            status: 409,
            message:
                "Duplicate stamp number on this bin. Please report it to the admin.",
        };
    }

    return { log: logs[0] };
}

// Middleware: validates stamp, checks assignment, loads req.bagLog.
const prepareBag = async (req, res, next) => {
    try {
        const binId = String(req.params.binId || "").trim();
        const { stamp } = req.params;

        if (!binId || !STAMP_RE.test(stamp)) {
            return res.status(400).json({
                success: false,
                message:
                    "Enter a valid stamp number (up to 6 digits).",
            });
        }

        const denied = await assertAssignedBin(req.user.id, binId);

        if (denied) {
            return res.status(denied.status).json({
                success: false,
                message: denied.message,
            });
        }

        const found = await findBag(binId, [
            parseInt(stamp, 10),
        ]);

        if (found.status) {
            return res.status(found.status).json({
                success: false,
                message: found.message,
            });
        }

        req.bagLog = found.log;
        return next();
    } catch (error) {
        console.error("[prepareBag]", error);

        return res.status(500).json({
            success: false,
            message: "Could not look up that bag.",
        });
    }
};

const rejectIfAlreadyFlagged = (req, res, next) => {
    if (req.bagLog.flagged) {
        return res.status(409).json({
            success: false,
            message: "This bag has already been flagged.",
        });
    }

    return next();
};

// GET /api/rfid/stamp/:binId/:stamp
const getBagByStamp = (req, res) => {
    return res.json({
        success: true,
        data: toPreview(req.bagLog),
    });
};

// POST /api/rfid/stamp/scan
const scanStampImage = async (req, res) => {
    try {
        const binId = String(req.body?.binId || "").trim();

        if (!binId) {
            return res.status(400).json({
                success: false,
                message: "binId is required.",
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "photo is required.",
            });
        }

        const denied = await assertAssignedBin(req.user.id, binId);

        if (denied) {
            return res.status(denied.status).json({
                success: false,
                message: denied.message,
            });
        }

        const candidates = await extractStampCandidates(req.file.buffer);

        if (candidates.length === 0) {
            return res.status(422).json({
                success: false,
                message:
                    "Couldn't read a 6-digit number. Move closer, avoid glare, or type it in.",
            });
        }

        const found = await findBag(
            binId,
            candidates.map((candidate) => parseInt(candidate, 10))
        );

        if (found.status) {
            return res.status(found.status).json({
                success: false,
                message: found.message,
            });
        }

        return res.json({
            success: true,
            data: toPreview(found.log),
        });
    } catch (error) {
        console.error("[scanStampImage]", error);

        return res.status(500).json({
            success: false,
            message:
                "Could not read the stamp. Please try again.",
        });
    }
};

// PATCH /api/rfid/stamp/:binId/:stamp/flag
const flagBagByStamp = async (req, res) => {
    const discardUpload = async () => {
        if (req.file?.path) {
            await destroyEvidence(req.file.path);
        }
    };

    try {
        const update = {
            flagged: true,
            flaggedAt: new Date(),
            flaggedBy: req.user.id,
        };

        if (req.file) {
            update.evidencePhoto = req.file.path;
        }

        // Atomic update: only one request can flag the bag.
        const updated = await RfidLog.findOneAndUpdate(
            {
                _id: req.bagLog._id,
                flagged: { $ne: true },
            },
            { $set: update },
            { new: true }
        ).populate("household", "fullname householdId");

        if (!updated) {
            await discardUpload();

            return res.status(409).json({
                success: false,
                message: "This bag has already been flagged.",
            });
        }

        const preview = toPreview(updated);
        const household = updated.household;

        const householdId = String(
            household?.householdId ?? household?._id ?? "Unknown"
        );

        await createNotification({
            title: "Household flagged: segregation anomaly",
            message:
                `Household ${householdId} (${household?.fullname ?? "Unknown"}) ` +
                `was flagged for bag #${preview.stampNumber} at ${updated.binId}.`,
            type: "household_flagged",
            meta: {
                householdId,
                householdName: household?.fullname,
                stampNumber: preview.stampNumber,
                binId: updated.binId,
                logId: String(updated._id),
                evidenceUrl: updated.evidencePhoto || undefined,
            },
        });

        return res.json({
            success: true,
            data: preview,
        });
    } catch (error) {
        await discardUpload();
        console.error("[flagBagByStamp]", error);

        return res.status(500).json({
            success: false,
            message:
                "Could not flag this bag. Please try again.",
        });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    binScan,
    completeDisposal,
    webScan,
    getLatestScan,
    checkRfid,
    getRfidLogs,
    getRfidHistory,
    flagLog,
    prepareBag,
    rejectIfAlreadyFlagged,
    getBagByStamp,
    scanStampImage,
    flagBagByStamp,
};

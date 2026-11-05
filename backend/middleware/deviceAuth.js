
const Device = require("../models/Device");
const DeviceRequestNonce = require("../models/DeviceRequestNonce");
const {
    decryptSecret,
    createSignature,
    safeCompare,
} = require("../services/deviceCredentialService");

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

const deviceAuth = async (req, res, next) => {
    try {
        const deviceId = req.get("x-device-id");
        const timestamp = req.get("x-device-timestamp");
        const nonce = req.get("x-device-nonce");
        const signature = req.get("x-device-signature");

        if (!deviceId || !timestamp || !nonce || !signature) {
            return res.status(401).json({
                success: false,
                message: "Device authentication headers are required.",
            });
        }

        if (
            !/^\d{13}$/.test(timestamp) ||
            !/^[a-f0-9-]{16,64}$/i.test(nonce)
        ) {
            return res.status(401).json({
                success: false,
                message: "Invalid device authentication headers.",
            });
        }

        const requestTime = Number(timestamp);

        if (
            !Number.isSafeInteger(requestTime) ||
            Math.abs(Date.now() - requestTime) > TIMESTAMP_WINDOW_MS
        ) {
            return res.status(401).json({
                success: false,
                message: "Device request timestamp expired.",
            });
        }

        const device = await Device.findOne({
            deviceId: deviceId.trim(),
            authEnabled: true,
            revokedAt: null,
        }).select("+encryptedSecret");

        if (!device || !device.encryptedSecret) {
            return res.status(401).json({
                success: false,
                message: "Device is not authorized.",
            });
        }

        const secret = decryptSecret(device.encryptedSecret);

        const expectedSignature = createSignature(
            secret,
            req.method,
            req.originalUrl.split("?")[0],
            timestamp,
            nonce,
            req.rawBody || ""
        );

        if (!safeCompare(signature, expectedSignature)) {
            return res.status(401).json({
                success: false,
                message: "Invalid device signature.",
            });
        }

        try {
            await DeviceRequestNonce.create({
                deviceId: device.deviceId,
                nonce,
                expiresAt: new Date(Date.now() + TIMESTAMP_WINDOW_MS * 2),
            });
        } catch (error) {
            if (error.code === 11000) {
                return res.status(401).json({
                    success: false,
                    message: "Duplicate device request detected.",
                });
            }

            throw error;
        }

        req.device = device;
        return next();
    } catch (error) {
        console.error("[DeviceAuth] Authentication failed:", error.message);

        return res.status(500).json({
            success: false,
            message: "Device authentication could not be completed.",
        });
    }

    const Bin = require("../models/Bin");

    const requireMatchingDeviceId = (req, res, next) => {
        if (
            !req.body ||
            String(req.body.deviceId || "").trim() !== req.device.deviceId
        ) {
            return res.status(403).json({
                success: false,
                message: "Device ID does not match authenticated device.",
            });
        }

        return next();
    };

    const requireAssignedBin = async (req, res, next) => {
        try {
            if (!req.device.assignedBin || !req.body.binId) {
                return res.status(403).json({
                    success: false,
                    message: "Device is not assigned to this bin.",
                });
            }

            const bin = await Bin.findById(req.device.assignedBin).select("binId");

            if (!bin || bin.binId !== String(req.body.binId).trim()) {
                return res.status(403).json({
                    success: false,
                    message: "Device is not authorized for this bin.",
                });
            }

            return next();
        } catch (error) {
            console.error("[AssignedBinCheck]", error.message);

            return res.status(500).json({
                success: false,
                message: "Could not verify device bin assignment.",
            });
        }
    };

    module.exports.requireMatchingDeviceId = requireMatchingDeviceId;
    module.exports.requireAssignedBin = requireAssignedBin;

};

module.exports = deviceAuth;

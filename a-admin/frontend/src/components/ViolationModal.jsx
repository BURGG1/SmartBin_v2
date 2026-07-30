// components/ViolationModal.jsx
import { X, Check, ImageOff } from "lucide-react";
import { useState, useEffect } from "react";
import ConfirmationModal from "./confirmationModal";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config";

const PROVISION = {
    title: "Improper waste segregation",
};

const PENALTY_CONFIG = {
    1: { type: "Point Deduction", pointsDeducted: 500, fineAmount: 0, communityService: null },
    2: { type: "Fine", pointsDeducted: 0, fineAmount: 300, communityService: null },
    3: { type: "Fine + Community Service", pointsDeducted: 0, fineAmount: 800, communityService: "15 Days Community Service" },
};

export default function ViolationModal({ isOpen, onClose, household, onPenalized }) {
    const [active, setActive] = useState(false);
    const [decision, setDecision] = useState(null); // "approve" | "decline"
    const [showToast, setShowToast] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [resultPenalty, setResultPenalty] = useState(null);

    // Reset state whenever modal opens
    useEffect(() => {
        if (isOpen) {
            setActive(false);
            setDecision(null);
            setError("");
            setResultPenalty(null);
        }
    }, [isOpen]);

    if (!isOpen || !household) return null;

    // `household` here is the RfidLog document (see CounterInfoModal's
    // setActiveHH(log)) — its `.household` field is the populated
    // Household sub-document, and `_id`/`evidencePhoto` live on the log
    // itself, not nested.
    const currentViolation = household?.household?.violation ?? household?.violation ?? 0;
    const nextOffense = currentViolation >= 3 ? 1 : currentViolation + 1;
    const penalty = PENALTY_CONFIG[nextOffense];
    const evidenceImage = household?.evidencePhoto ?? null;
    const logId = household?._id;

    const openConfirm = (type) => {
        setDecision(type);
        setActive(true);
    };

    const handleConfirm = async () => {
        setLoading(true);
        setError("");

        // Decline: unflag the log via the same endpoint used to flag it.
        // The backend already clears evidencePhoto and deletes the
        // Cloudinary image whenever flagged is set to false.
        if (decision === "decline") {
            try {
                const token = sessionStorage.getItem("token");
                const formData = new FormData();
                formData.append("flagged", "false");

                const res = await fetch(`${BASE_URL}/api/rfid/logs/${logId}/flag`, {
                    method: "PATCH",
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    body: formData, // no Content-Type — browser sets the multipart boundary
                });

                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.message || "Failed to decline report.");
                }

                setActive(false);
                setShowToast(true);

                // Let the parent refresh its log list so the row stops
                // showing red/flagged and the image is gone from the UI.
                if (onPenalized) onPenalized(data.data);

                setTimeout(() => onClose(), 1800);
            } catch (err) {
                setError(err.message);
                setActive(false);
            } finally {
                setLoading(false);
            }
            return;
        }

        // Approve: apply the actual penalty
        try {
            const token = sessionStorage.getItem("token");
            const householdId = household?.household?._id ?? household?._id;

            const res = await fetch(`${BASE_URL}/api/households/${householdId}/penalize`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({ issuedBy: "Admin" }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                throw new Error(data.message || "Failed to apply penalty.");
            }

            setResultPenalty(data.data.penalty);
            setActive(false);
            setShowToast(true);

            if (onPenalized) onPenalized(data.data.household);

            setTimeout(() => onClose(), 1800);
        } catch (err) {
            setError(err.message);
            setActive(false);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-lg flex flex-col overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h2 className="text-xl font-bold">{household.household?.fullname ?? household.fullname ?? "Household"}</h2>
                    <button onClick={onClose} disabled={loading}>
                        <X className="cursor-pointer text-gray-500 hover:text-gray-800" />
                    </button>
                </div>

                {/* BODY */}
                <div className="overflow-y-auto flex flex-col">

                    {/* Evidence Image */}
                    <div className="w-full h-56 bg-gray-100 border-b flex items-center justify-center overflow-hidden">
                        {evidenceImage ? (
                            <a
                                href={evidenceImage}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full h-full block"
                            >
                                <img
                                    src={evidenceImage}
                                    alt="Reported violation evidence"
                                    className="w-full h-full object-cover cursor-pointer"
                                />
                            </a>
                        ) : (
                            <div className="flex flex-col items-center text-gray-400">
                                <ImageOff className="w-10 h-10 mb-2" />
                                <span className="text-sm">No evidence photo submitted</span>
                            </div>
                        )}
                    </div>

                    <div className="px-6 py-6 flex flex-col gap-6">

                        {/* Combined Info Card */}
                        <div className="bg-gray-50 p-4 rounded-lg border flex flex-col gap-5">

                            {/* Violation */}
                            <div>
                                <h3 className="font-semibold mb-2">Violation</h3>
                                <p className="text-gray-600">{PROVISION.title}</p>
                            </div>

                            {/* Offense level */}
                            <div className="bg-blue-50 p-4 rounded-lg border">
                                <p className="font-semibold">Offense Level: {nextOffense}</p>
                                <p className="text-sm text-gray-600">
                                    Current violations: {currentViolation} — this will be offense #{nextOffense}
                                    {currentViolation >= 3 && (
                                        <span className="ml-1 text-orange-600 font-medium">(reset from 3rd offense)</span>
                                    )}
                                </p>
                            </div>

                            {/* Penalty */}
                            <div className="bg-red-100 p-4 rounded-lg border border-red-200">
                                <h3 className="font-semibold text-red-700 mb-3">Penalty Details</h3>
                                <div className="flex flex-col gap-2 text-sm">
                                    <p><strong>Type:</strong> {penalty.type}</p>
                                    {penalty.pointsDeducted > 0 && (
                                        <p><strong>Points Deducted:</strong> -{penalty.pointsDeducted}</p>
                                    )}
                                    {penalty.fineAmount > 0 && (
                                        <p><strong>Fine:</strong> ₱{penalty.fineAmount}</p>
                                    )}
                                    {penalty.communityService && (
                                        <p><strong>Community Service:</strong> {penalty.communityService}</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Error */}
                        {error && (
                            <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-700">
                                {error}
                            </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => openConfirm("decline")}
                                disabled={loading}
                                className="flex-1 flex items-center justify-center gap-2 border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                                Decline
                            </button>
                            <button
                                onClick={() => openConfirm("approve")}
                                disabled={loading}
                                className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            >
                                <Check className="w-4 h-4" />
                                {loading ? "Applying..." : "Approve"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <ConfirmationModal
                isOpen={active}
                onClose={() => setActive(false)}
                onConfirm={handleConfirm}
            />

            <SuccessToast
                show={showToast}
                onClose={() => setShowToast(false)}
                message={
                    decision === "decline"
                        ? "Violation report declined."
                        : resultPenalty
                            ? `Penalty applied: ${resultPenalty.penaltyType} (Offense #${resultPenalty.offenseNumber})`
                            : "Penalty successfully assigned!"
                }
            />
        </div >
    );
}
// components/ViolationModal.jsx
import { X } from "lucide-react";
import { useState, useEffect } from "react";
import ConfirmationModal from "./confirmationModal";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config";

const PROVISION = {
    title: "Mixing of segregated waste once it has already been separated",
};

const PENALTY_CONFIG = {
    1: { type: "Point Deduction", pointsDeducted: 500, fineAmount: 0, communityService: null },
    2: { type: "Fine", pointsDeducted: 0, fineAmount: 300, communityService: null },
    3: { type: "Fine + Community Service", pointsDeducted: 0, fineAmount: 800, communityService: "15 Days Community Service" },
};

export default function ViolationModal({ isOpen, onClose, household, onPenalized }) {
    const [active, setActive] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [resultPenalty, setResultPenalty] = useState(null);

    // Reset state whenever modal opens
    useEffect(() => {
        if (isOpen) {
            setActive(false);
            setError("");
            setResultPenalty(null);
        }
    }, [isOpen]);

    if (!isOpen || !household) return null;

    // Compute what offense this WILL be (same logic as backend)
    const currentViolation = household?.household?.violation ?? household?.violation ?? 0;
    const nextOffense = currentViolation >= 3 ? 1 : currentViolation + 1;
    const penalty = PENALTY_CONFIG[nextOffense];

    const handleConfirm = async () => {
        setLoading(true);
        setError("");
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

            // Notify parent to refresh household data
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
                <div className="overflow-y-auto px-6 py-6 flex flex-col gap-6">

                    {/* Violation */}
                    <div className="bg-gray-50 p-4 rounded-lg border">
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

                    {/* Error */}
                    {error && (
                        <div className="bg-red-50 border border-red-300 rounded-lg p-3 text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    {/* Action button */}
                    <button
                        onClick={() => setActive(true)}
                        disabled={loading}
                        className="bg-red-600 text-white py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? "Applying..." : "Assign Penalty"}
                    </button>
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
                    resultPenalty
                        ? `Penalty applied: ${resultPenalty.penaltyType} (Offense #${resultPenalty.offenseNumber})`
                        : "Penalty successfully assigned!"
                }
            />
        </div>
    );
}
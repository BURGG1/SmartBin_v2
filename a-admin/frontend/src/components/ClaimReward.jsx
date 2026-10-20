import { X, Asterisk } from "lucide-react";
import { useState, useEffect } from "react";
import BASE_URL from "../config";

export default function ClaimReward({ isOpen, onClose, record, onRedeemed }) {
    const [code, setCode] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    // Fresh form every time the modal opens for a (new) record
    useEffect(() => {
        if (isOpen) {
            setCode("");
            setError("");
            setSubmitting(false);
        }
    }, [isOpen, record]);

    if (!isOpen || !record) return null;

    const id = record._id ?? record.id;

    const handleClaim = async () => {
        if (submitting) return; // double-submit guard

        const trimmed = code.trim();
        if (!trimmed) {
            setError("Please enter the receipt / coupon code.");
            return;
        }

        setSubmitting(true);
        setError("");
        try {
            // NOTE: adjust this endpoint path to match your actual backend route
            const res = await fetch(`${BASE_URL}/api/rewards/logs/${id}/redeem`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ receiptNumber: trimmed }),
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok || !data.success) {
                setError(data.message || "Could not redeem this reward.");
                return;
            }

            onRedeemed?.(record); // parent disables the row + re-syncs
            onClose();
        } catch {
            setError("Network error. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-lg overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h2 className="text-lg font-bold">Claim Reward</h2>
                    <button onClick={onClose} disabled={submitting}>
                        <X className="text-gray-500 hover:text-gray-800 cursor-pointer" />
                    </button>
                </div>

                {/* BODY */}
                <div className="p-6 flex flex-col gap-4">

                    <div className="flex flex-col items-center">
                        <div className="flex items-center">
                            <h3 className="text-lg font-semibold">{record.rewardName}</h3>
                            <Asterisk className="text-red-500 w-3 h-3" />
                        </div>
                        <p className="text-sm text-gray-500">
                            {record.householdName} ({record.householdId})
                        </p>
                    </div>

                    {/* RECEIPT / COUPON INPUT */}
                    <div className="flex flex-col gap-1">
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleClaim()}
                            placeholder="Enter the coupon code"
                            disabled={submitting}
                            autoFocus
                            className="w-full px-3 py-2 border rounded-lg"
                        />
                        {error && <p className="text-sm text-red-500">{error}</p>}
                    </div>

                    {/* BUTTONS */}
                    <div className="flex gap-2 mt-4">
                        <button
                            onClick={handleClaim}
                            disabled={submitting}
                            className="flex-1 bg-green-600 cursor-pointer text-white py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                        >
                            {submitting ? "Claiming..." : "Claim"}
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}
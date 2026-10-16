import { X, Gift } from "lucide-react";
import { useState, useEffect } from "react";
import BASE_URL from "../config";

// Receipt numbers: letters, digits and dashes only, at least 3 characters.
const RECEIPT_PATTERN = /^[A-Za-z0-9-]{3,}$/;

// `record` is the reward log row the admin clicked "Redeemed reward" on.
export default function RedeemRewardModal({ isOpen, onClose, record, onRedeemed }) {
    const [receiptNumber, setReceiptNumber] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");

    const recordId = record?._id ?? record?.id;

    // Start fresh every time the modal opens for a record
    useEffect(() => {
        if (isOpen) {
            setReceiptNumber("");
            setError("");
            setSubmitting(false);
        }
    }, [isOpen, recordId]);

    if (!isOpen || !record) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (submitting) return;

        const receipt = receiptNumber.trim();
        if (!receipt) {
            setError("Receipt number is required.");
            return;
        }
        if (!RECEIPT_PATTERN.test(receipt)) {
            setError("Receipt number must be at least 3 characters (letters, numbers and dashes only).");
            return;
        }

        setSubmitting(true);
        setError("");
        try {
            const token = sessionStorage.getItem("token");
            // NOTE: adjust this endpoint path to match your actual backend route
            const res = await fetch(`${BASE_URL}/api/rewards/logs/${recordId}/redeem`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    ...(token && { Authorization: `Bearer ${token}` }),
                },
                body: JSON.stringify({ receiptNumber: receipt }),
            });
            const data = await res.json();

            if (data.success) {
                await onRedeemed?.(record, data);
                onClose();
            } else {
                setError(data.message || "Failed to redeem reward.");
            }
        } catch (err) {
            setError("Network error. Could not redeem reward.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-md rounded-2xl shadow-lg overflow-hidden">
                {/* HEADER */}
                <div className="flex justify-between items-center px-5 py-3 border-b">
                    <h3 className="text-gray-700 text-sm font-semibold flex items-center gap-2">
                        <Gift size={16} />
                        Redeem Reward
                    </h3>
                    <button onClick={onClose} disabled={submitting}>
                        <X className="w-5 h-5 text-gray-500 cursor-pointer hover:text-gray-800" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                    {/* Record summary */}
                    <div className="bg-gray-100 rounded-lg px-4 py-3 text-sm space-y-0.5">
                        <p>Reward: <span className="font-semibold">{record.rewardName ?? "—"}</span></p>
                        <p>Resident: <span className="font-semibold">{record.householdName ?? "—"}</span></p>
                        <p>Household ID: <span className="font-semibold">{record.householdId ?? "—"}</span></p>
                    </div>

                    {/* Receipt input */}
                    <div className="space-y-1">
                        <label htmlFor="redeemReceiptNumber" className="text-sm text-gray-700">
                            Receipt number <span className="text-red-500">*</span>
                        </label>
                        <input
                            id="redeemReceiptNumber"
                            type="text"
                            value={receiptNumber}
                            onChange={(e) => {
                                setReceiptNumber(e.target.value);
                                if (error) setError("");
                            }}
                            placeholder="Enter receipt number for this redemption"
                            autoFocus
                            disabled={submitting}
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                        />
                        <p className="text-xs text-gray-500">
                            Confirms that the household has claimed this reward.
                        </p>
                        {error && <p className="text-xs text-red-500">{error}</p>}
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="px-4 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || !receiptNumber.trim()}
                            className="px-4 py-1.5 rounded-lg bg-green-600 text-white text-sm hover:bg-green-700 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting ? "Redeeming..." : "Confirm & Redeem"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
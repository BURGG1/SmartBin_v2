
import { useState, useEffect } from "react";
import { X, Camera, Asterisk, Gift } from "lucide-react";
import { createReward, updateReward } from "../api/rewardAPI";

export default function RewardFormModal({
    isOpen,
    onClose,
    edit,
    rewardData,
    onSaved,
}) {
    const [name, setName] = useState("");
    const [points, setPoints] = useState("");
    const [stocks, setStocks] = useState("");
    const [imageFile, setImageFile] = useState(null);
    const [saving, setSaving] = useState(false);
    const [claimLimit, setClaimLimit] = useState("0");
    const [claimPeriod, setClaimPeriod] = useState("month");

    const inputClass =
        "w-full px-3 py-2 text-black rounded-lg border border-gray-200 focus:ring-2 focus:ring-green-500 focus:border-transparent";

    // Fill the form when editing, clear it when adding
    useEffect(() => {
        if (!isOpen) return;

        if (edit && rewardData) {
            setName(rewardData.name ?? "");
            setPoints(String(rewardData.points ?? ""));
            setStocks(String(rewardData.stocks ?? ""));
            setClaimLimit(String(rewardData.claimLimit ?? 0));
            setClaimPeriod(rewardData.claimPeriod ?? "month");
        } else {
            setName("");
            setPoints("");
            setStocks("");
            setClaimLimit("0");
            setClaimPeriod("month");
        }

        setImageFile(null);
    }, [isOpen, edit, rewardData]);

    const handleSave = async () => {
        const parsedPoints = Number(points);
        const parsedStocks = Number(stocks);
        const parsedClaimLimit = Number(claimLimit);

        if (!name.trim() || points === "" || stocks === "") {
            alert("Name, points, and stock are required.");
            return;
        }

        if (
            !Number.isSafeInteger(parsedPoints) ||
            parsedPoints < 0 ||
            !Number.isSafeInteger(parsedStocks) ||
            parsedStocks < 0
        ) {
            alert("Points and stock must be non-negative whole numbers.");
            return;
        }

        if (
            claimLimit.trim() === "" ||
            !Number.isSafeInteger(parsedClaimLimit) ||
            parsedClaimLimit < 0
        ) {
            alert("Claim limit must be 0 or a positive whole number.");
            return;
        }

        const validPeriods = [
            "day",
            "week",
            "month",
            "year",
            "lifetime",
        ];

        if (!validPeriods.includes(claimPeriod)) {
            alert("Please select a valid claim period.");
            return;
        }

        try {
            setSaving(true);

            const payload = {
                name: name.trim(),
                points: parsedPoints,
                stocks: parsedStocks,
                claimLimit: parsedClaimLimit,
                claimPeriod,
                imageFile,
            };

            if (edit) {
                if (!rewardData?._id) {
                    throw new Error("Reward ID is missing.");
                }

                await updateReward(rewardData._id, payload);
            } else {
                await createReward(payload);
            }

            await onSaved?.();
            onClose();
        } catch (err) {
            console.error("Failed to save reward:", err);
            alert(
                err.message ||
                    `Failed to ${edit ? "update" : "add"} reward.`
            );
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-lg overflow-hidden">
                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h3 className="text-md font-semibold flex items-center gap-2">
                        <Gift className="text-green-600" size={18} />
                        {edit ? "Update Reward" : "Add New Reward"}
                    </h3>

                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        aria-label="Close modal"
                    >
                        <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                    </button>
                </div>

                {/* BODY */}
                <div className="p-6 space-y-4">
                    {/* IMAGE UPLOAD */}
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <label className="inline-flex w-fit items-center gap-2 cursor-pointer text-white bg-green-600 px-3 py-2 rounded-lg hover:bg-green-700 transition">
                            <Camera size={16} />
                            Upload Image

                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                disabled={saving}
                                onChange={(e) =>
                                    setImageFile(e.target.files?.[0] || null)
                                }
                            />
                        </label>

                        {imageFile && (
                            <span className="text-sm text-gray-500 truncate">
                                {imageFile.name}
                            </span>
                        )}
                    </div>

                    {/* REWARD NAME */}
                    <div>
                        <div className="flex items-center gap-1 mb-1">
                            <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                            <label
                                htmlFor="reward-name"
                                className="text-sm font-medium text-gray-700"
                            >
                                Name
                            </label>
                        </div>

                        <input
                            id="reward-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={inputClass}
                            placeholder="Name"
                            maxLength={150}
                            disabled={saving}
                        />
                    </div>

                    {/* POINTS AND STOCK */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <div className="flex items-center gap-1 mb-1">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <label
                                    htmlFor="reward-points"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    Points
                                </label>
                            </div>

                            <input
                                id="reward-points"
                                value={points}
                                onChange={(e) => setPoints(e.target.value)}
                                className={inputClass}
                                placeholder="Points"
                                type="number"
                                min="0"
                                step="1"
                                disabled={saving}
                            />
                        </div>

                        <div>
                            <div className="flex items-center gap-1 mb-1">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <label
                                    htmlFor="reward-stocks"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    Stock
                                </label>
                            </div>

                            <input
                                id="reward-stocks"
                                value={stocks}
                                onChange={(e) => setStocks(e.target.value)}
                                className={inputClass}
                                placeholder="Stock"
                                type="number"
                                min="0"
                                step="1"
                                disabled={saving}
                            />
                        </div>
                    </div>

                    {/* CLAIM LIMIT AND CLAIM PERIOD */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <div className="flex items-center gap-1 mb-1">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <label
                                    htmlFor="reward-claim-limit"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    Claim Limit
                                </label>
                            </div>

                            <input
                                id="reward-claim-limit"
                                value={claimLimit}
                                onChange={(e) =>
                                    setClaimLimit(e.target.value)
                                }
                                className={inputClass}
                                placeholder="0 = Unlimited"
                                type="number"
                                min="0"
                                step="1"
                                disabled={saving}
                            />

                            <p className="mt-1 text-xs text-gray-500">
                                Enter 0 for unlimited claims.
                            </p>
                        </div>

                        <div>
                            <div className="flex items-center gap-1 mb-1">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <label
                                    htmlFor="reward-claim-period"
                                    className="text-sm font-medium text-gray-700"
                                >
                                    Claim Period
                                </label>
                            </div>

                            <select
                                id="reward-claim-period"
                                value={claimPeriod}
                                onChange={(e) =>
                                    setClaimPeriod(e.target.value)
                                }
                                className={inputClass}
                                disabled={saving}
                            >
                                <option value="day">Per Day</option>
                                <option value="week">Per Week</option>
                                <option value="month">Per Month</option>
                                <option value="year">Per Year</option>
                                <option value="lifetime">Lifetime</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="bg-gray-600 cursor-pointer text-white p-2 px-5 rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-green-600 cursor-pointer text-white p-2 px-5 rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                    >
                        {saving
                            ? "Saving..."
                            : edit
                              ? "Update Reward"
                              : "Add Reward"}
                    </button>
                </div>
            </div>
        </div>
    );
}

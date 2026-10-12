import { useState, useEffect } from "react";
import { X, Camera, Asterisk, Gift } from "lucide-react";
import { createReward, updateReward } from "../api/rewardAPI";

export default function RewardFormModal({ isOpen, onClose, edit, rewardData, onSaved }) {
    const [name, setName] = useState("");
    const [points, setPoints] = useState("");
    const [stocks, setStocks] = useState("");
    const [imageFile, setImageFile] = useState(null);
    const [saving, setSaving] = useState(false);

    // Fill the form when editing, clear it when adding
    useEffect(() => {
        if (!isOpen) return;
        if (edit && rewardData) {
            setName(rewardData.name ?? "");
            setPoints(rewardData.points ?? "");
            setStocks(rewardData.stocks ?? "");
        } else {
            setName("");
            setPoints("");
            setStocks("");
        }
        setImageFile(null);
    }, [isOpen, edit, rewardData]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!name || points === "" || stocks === "") {
            alert("Name, points, and stock are required");
            return;
        }
        try {
            setSaving(true);
            const payload = { name, points, stocks, imageFile };
            if (edit) {
                await updateReward(rewardData._id, payload);
            } else {
                await createReward(payload);
            }
            await onSaved?.();
            onClose();
        } catch (err) {
            console.error(err);
            alert(`Failed to ${edit ? "update" : "add"} reward`);
        } finally {
            setSaving(false);
        }
    };

    const inputClass =
        "w-full px-3 py-2 text-black rounded-lg border border-gray-200 focus:ring-2 focus:ring-green-500 focus:border-transparent";

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-lg overflow-hidden">
                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <h3 className="text-md font-semibold flex items-center gap-2">
                        <Gift className="text-green-600" size={18} />
                        {edit ? "Update Reward" : "Add New Reward"}
                    </h3>
                    <button onClick={onClose} disabled={saving}>
                        <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                    </button>
                </div>

                {/* BODY */}
                <div className="p-6 space-y-4">
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                        <label className="inline-flex w-fit items-center gap-2 cursor-pointer text-white bg-green-600 px-3 py-2 rounded-lg hover:bg-green-700 transition">
                            <Camera size={16} />
                            Upload Image
                            <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => setImageFile(e.target.files[0] || null)}
                            />
                        </label>
                        {imageFile && (
                            <span className="text-sm text-gray-500 truncate">{imageFile.name}</span>
                        )}
                    </div>

                    <div className="flex items-center">
                        <Asterisk className="text-red-500 w-4 h-4" />
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={inputClass}
                            placeholder="Name"
                        />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="flex items-center">
                            <Asterisk className="text-red-500 w-4 h-4" />
                            <input
                                value={points}
                                onChange={(e) => setPoints(e.target.value)}
                                className={inputClass}
                                placeholder="Points"
                                type="number"
                                step="0.01"
                            />
                        </div>
                        <div className="flex items-center">
                            <Asterisk className="text-red-500 w-4 h-4" />
                            <input
                                value={stocks}
                                onChange={(e) => setStocks(e.target.value)}
                                className={inputClass}
                                placeholder="Stock"
                                type="number"
                            />
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t">
                    <button
                        onClick={onClose}
                        disabled={saving}
                        className="bg-gray-600 cursor-pointer text-white p-2 px-5 rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="bg-green-600 cursor-pointer text-white p-2 px-5 rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                    >
                        {saving ? "Saving..." : edit ? "Update Reward" : "Add Reward"}
                    </button>
                </div>
            </div>
        </div>
    );
}
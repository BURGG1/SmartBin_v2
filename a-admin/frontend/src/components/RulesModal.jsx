import {
    X,
    Asterisk,
    Gavel,
    Plus,
    Camera,
} from "lucide-react";
import { useState, useEffect } from "react";
import ConfirmationModal from "./confirmationModal";
import { createRule, updateRule } from "../api/rulesAPI";

export default function RulesModal({ isOpen, onClose, edit, ruleData, onSaved }) {

    const [active, setActive] = useState(false);

    const [ruleName, setRuleName] = useState("");
    const [desc, setDesc] = useState("");
    const [eqPoints, setEqPoints] = useState("");
    const [freq, setFreq] = useState("");
    const [auto, setAuto] = useState(false);
    const [imageFile, setImageFile] = useState(null);
    const [streakDays, setStreakDays] = useState("");  // ← added

    const clearForm = () => {
        setRuleName("");
        setDesc("");
        setEqPoints("");
        setFreq("");
        setAuto(false);
        setImageFile(null);
        setStreakDays("");  // ← added
    };

    useEffect(() => {
        if (!isOpen) return;

        if (edit && ruleData) {
            setRuleName(ruleData.name || "");
            setDesc(ruleData.decs || "");
            setEqPoints(ruleData.points || "");
            setFreq(ruleData.freq || "");
            setAuto(!!ruleData.auto);
            setImageFile(null);
            setStreakDays(ruleData.streakDays?.toString() || "");  // ← added
        } else {
            clearForm();
        }
    }, [isOpen, edit, ruleData]);

    if (!isOpen) return null;

    const isFormValid = () => {
        if (!ruleName || !desc || !eqPoints || !freq) {
            alert("Name, description, points, and frequency are required");
            return false;
        }
        // ← added
        if (freq === "per streak" && !streakDays) {
            alert("Please enter the number of streak days.");
            return false;
        }
        return true;
    };

    const handleRequestConfirm = () => {
        if (!isFormValid()) return;
        setActive(true);
    };

    const handleAddRule = async () => {
        try {
            await createRule({
                name: ruleName,
                decs: desc,
                points: eqPoints,
                freq,
                auto,
                streakDays: freq === "per streak" ? parseInt(streakDays) : null,  // ← added
                imageFile,
            });
            onSaved && onSaved();
            clearForm();
            setActive(false);
            onClose();
        } catch (err) {
            console.error(err);
            alert("Failed to add rule");
        }
    };

    const handleUpdateRule = async () => {
        try {
            await updateRule(ruleData._id, {
                name: ruleName,
                decs: desc,
                points: eqPoints,
                freq,
                auto,
                streakDays: freq === "per streak" ? parseInt(streakDays) : null,  // ← added
                imageFile,
            });
            onSaved && onSaved();
            setActive(false);
            onClose();
        } catch (err) {
            console.error(err);
            alert("Failed to update rule");
        }
    };

    const handleConfirm = () => {
        if (edit) {
            handleUpdateRule();
        } else {
            handleAddRule();
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-lg flex flex-col overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-4 sm:px-6 py-4">
                    <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                        <Gavel className="text-green-600" />
                        {edit ? "Update Rule" : "Add New Rule"}
                    </h2>
                    <button onClick={onClose}>
                        <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                    </button>
                </div>

                <section className="bg-white rounded-xl pt-0 p-6 shadow overflow-y-auto">

                    {/* Image Upload */}
                    <div className="mb-4 flex flex-col md:flex-row gap-3 items-center">
                        <label className="flex items-center gap-2 cursor-pointer text-white bg-green-600 px-3 py-2 rounded-lg hover:bg-green-700 transition">
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
                            <span className="text-sm text-gray-500">{imageFile.name}</span>
                        )}
                        {!imageFile && edit && ruleData?.image && (
                            <span className="text-sm text-gray-500">
                                Current image kept unless you upload a new one
                            </span>
                        )}
                    </div>

                    <div className="grid grid-cols-1 gap-3">

                        {/* Name */}
                        <div className="flex items-center">
                            <Asterisk className="text-red-500 w-4 h-4" />
                            <input
                                value={ruleName}
                                onChange={(e) => setRuleName(e.target.value)}
                                className="w-full px-3 py-2 text-black rounded-lg border"
                                placeholder="Name"
                            />
                        </div>

                        {/* Description */}
                        <div className="flex items-center">
                            <Asterisk className="text-red-500 w-4 h-4" />
                            <textarea
                                value={desc}
                                onChange={(e) => setDesc(e.target.value)}
                                className="w-full px-3 py-2 text-black rounded-lg border"
                                placeholder="Description"
                            />
                        </div>

                        {/* Points */}
                        <div className="flex items-center">
                            <Asterisk className="text-red-500 w-4 h-4" />
                            <input
                                value={eqPoints}
                                onChange={(e) => setEqPoints(e.target.value)}
                                className="w-full px-3 py-2 text-black rounded-lg border"
                                placeholder="Points (e.g. 30 or 50-200)"
                            />
                        </div>

                        {/* Frequency */}
                        <div className="flex items-center">
                            <Asterisk className="text-red-500 w-4 h-4" />
                            <select
                                value={freq}
                                onChange={(e) => {
                                    setFreq(e.target.value);
                                    if (["per streak", "Daily", "Weekly", "Monthly"].includes(e.target.value)) {
                                        setAuto(true);
                                    }
                                }}
                                className="w-full py-2 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
                            >
                                <option value="">Frequency</option>
                                <option value="Daily">Daily (every day)</option>
                                <option value="Weekly">Weekly (7 days)</option>
                                <option value="Monthly">Monthly (30 days)</option>
                                <option value="Per Collection">Per Collection</option>
                                <option value="per kilo">Per kilo</option>
                                <option value="per streak">Per streak (custom days)</option>
                                <option value="per item">Per item</option>
                                <option value="per brick">Per brick</option>
                            </select>
                        </div>

                        {/* Streak Days — only visible when per streak is selected */}
                        {freq === "per streak" && (
                            <div className="flex items-center">
                                <Asterisk className="text-red-500 w-4 h-4" />
                                <input
                                    type="number"
                                    value={streakDays}
                                    onChange={(e) => setStreakDays(e.target.value)}
                                    className="w-full px-3 py-2 text-black rounded-lg border"
                                    placeholder="Number of streak days (e.g. 10 or 30)"
                                    min="1"
                                />
                            </div>
                        )}

                        {/* Info banner for auto frequencies */}
                        {["per streak", "Daily", "Weekly", "Monthly"].includes(freq) && (
                            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
                                This rule will be <strong>automatically awarded</strong> by the system
                                {freq === "per streak" && streakDays && (
                                    <span> when a household reaches a <strong>{streakDays}-day streak</strong></span>
                                )}
                                {freq === "Daily" && <span> every day a household disposes waste</span>}
                                {freq === "Weekly" && <span> every <strong>7 consecutive days</strong> of disposal</span>}
                                {freq === "Monthly" && <span> every <strong>30 consecutive days</strong> of disposal</span>}
                                .
                            </div>
                        )}

                        {/* Auto checkbox */}
                        <label className="flex items-center gap-2 text-sm text-gray-600 px-1">
                            <input
                                type="checkbox"
                                checked={auto}
                                onChange={(e) => setAuto(e.target.checked)}
                            />
                            Auto-awarded (system tracks this automatically)
                        </label>

                    </div>

                    {/* Buttons */}
                    <div className="mt-3 flex justify-end gap-2">
                        {edit ? (
                            <div className="flex gap-2 items-center">
                                <button
                                    onClick={handleRequestConfirm}
                                    className="cursor-pointer mt-auto bg-green-600 flex items-center justify-center gap-1 text-white rounded-lg p-2 hover:bg-green-700 transition"
                                >
                                    Update Rule
                                </button>
                                <button
                                    onClick={onClose}
                                    className="cursor-pointer mt-auto bg-gray-600 flex items-center justify-center gap-1 text-white rounded-lg p-2 hover:bg-gray-700 transition"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={handleRequestConfirm}
                                className="cursor-pointer mt-auto bg-green-600 flex items-center justify-center gap-1 text-white rounded-lg p-2 hover:bg-green-700 transition"
                            >
                                <Plus size={16} />
                                Add New Rule
                            </button>
                        )}
                    </div>
                </section>

                <ConfirmationModal
                    isOpen={active}
                    onClose={() => setActive(false)}
                    onConfirm={handleConfirm}
                />
            </div>
        </div>
    );
}
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

// Small helper so every field gets the same label style (with the red
// asterisk for required fields).
function FieldLabel({ htmlFor, children, required = true }) {
    return (
        <label htmlFor={htmlFor} className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-0.5">
            {required && <Asterisk className="text-red-500 w-3.5 h-3.5" />}
            {children}
        </label>
    );
}

export default function RulesModal({ isOpen, onClose, edit, ruleData, onSaved }) {

    const [active, setActive] = useState(false);

    const [ruleName, setRuleName] = useState("");
    const [desc, setDesc] = useState("");
    const [eqPoints, setEqPoints] = useState("");
    const [freq, setFreq] = useState("");
    const [auto, setAuto] = useState(false);
    const [imageFile, setImageFile] = useState(null);
    const [streakDays, setStreakDays] = useState("");

    const clearForm = () => {
        setRuleName("");
        setDesc("");
        setEqPoints("");
        setFreq("");
        setAuto(false);
        setImageFile(null);
        setStreakDays("");
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
            setStreakDays(ruleData.streakDays?.toString() || "");
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
                streakDays: freq === "per streak" ? parseInt(streakDays) : null,
                imageFile,
            });
            onSaved && onSaved();
            clearForm();
            setActive(false);
            onClose();
        } catch (err) {
            console.error(err);
            alert("Failed to add activity");
        }
    };

    const handleUpdateRule = async () => {
        try {
            await updateRule(ruleData._id, {
                // The name is locked when editing: always send the original one
                name: ruleData.name,
                decs: desc,
                points: eqPoints,
                freq,
                auto,
                streakDays: freq === "per streak" ? parseInt(streakDays) : null,
                imageFile,
            });
            onSaved && onSaved();
            setActive(false);
            onClose();
        } catch (err) {
            console.error(err);
            alert("Failed to update activity");
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
                <div className="flex justify-between items-start px-4 sm:px-6 py-4">
                    <div className="mb-2">
                        <h2 className="text-lg font-semibold flex items-center gap-2">
                            <Gavel className="text-green-600" />
                            {edit ? "Update Activity" : "Add New Activity"}
                        </h2>
                        {/* Name can't be edited, so it's shown as plain text instead of a field */}
                        {edit && ruleData?.name && (
                            <p className="text-sm text-gray-500 mt-1">
                                Editing: <span className="font-medium text-gray-700">{ruleData.name}</span>
                            </p>
                        )}
                    </div>
                    <button onClick={onClose}>
                        <X className="text-gray-500 hover:text-red-400 cursor-pointer" />
                    </button>
                </div>

                <section className="bg-white rounded-xl pt-0 px-6 pb-4 shadow overflow-y-auto">

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

                    <div className="grid grid-cols-1 gap-2">

                        {/* Name — only when adding; removed when editing */}
                        {!edit && (
                            <div>
                                <FieldLabel htmlFor="activity-name">Activity Name</FieldLabel>
                                <input
                                    id="activity-name"
                                    value={ruleName}
                                    onChange={(e) => setRuleName(e.target.value)}
                                    className="w-full px-3 py-1.5 text-black rounded-lg border"
                                    placeholder="Name"
                                />
                            </div>
                        )}

                        {/* Description */}
                        <div>
                            <FieldLabel htmlFor="activity-desc">Description</FieldLabel>
                            <textarea
                                id="activity-desc"
                                rows={2}
                                value={desc}
                                onChange={(e) => setDesc(e.target.value)}
                                className="w-full px-3 py-1.5 text-black rounded-lg border"
                                placeholder="Description"
                            />
                        </div>

                        {/* Points */}
                        <div>
                            <FieldLabel htmlFor="activity-points">Points</FieldLabel>
                            <input
                                id="activity-points"
                                value={eqPoints}
                                onChange={(e) => setEqPoints(e.target.value)}
                                className="w-full px-3 py-1.5 text-black rounded-lg border"
                                placeholder="Points (e.g. 30 or 50-200)"
                            />
                        </div>

                        {/* Frequency */}
                        <div>
                            <FieldLabel htmlFor="activity-freq">Frequency</FieldLabel>
                            <select
                                id="activity-freq"
                                value={freq}
                                onChange={(e) => {
                                    setFreq(e.target.value);
                                    if (["per streak", "Daily", "Weekly", "Monthly"].includes(e.target.value)) {
                                        setAuto(true);
                                    }
                                }}
                                className="w-full px-3 py-1.5 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
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
                            <div>
                                <FieldLabel htmlFor="activity-streak">Streak Days</FieldLabel>
                                <input
                                    id="activity-streak"
                                    type="number"
                                    value={streakDays}
                                    onChange={(e) => setStreakDays(e.target.value)}
                                    className="w-full px-3 py-1.5 text-black rounded-lg border"
                                    placeholder="Number of streak days (e.g. 10 or 30)"
                                    min="1"
                                />
                            </div>
                        )}

                        {/* Info banner for auto frequencies */}
                        {["per streak", "Daily", "Weekly", "Monthly"].includes(freq) && (
                            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">
                                This activity will be <strong>automatically awarded</strong> by the system
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
                                    Update Activity
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
                                Add New Activity
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
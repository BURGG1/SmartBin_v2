import { X, Asterisk } from "lucide-react";
import { useState, useEffect } from "react";
import ConfirmationModal from "./confirmationModal";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config";

export default function AssignPointsModal({ isOpen, onClose, household, onAwarded }) {
    const [rules, setRules] = useState([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [selectedRule, setSelectedRule] = useState(null);
    const [quantity, setQuantity] = useState(1);
    const [awarding, setAwarding] = useState(false);
    const [error, setError] = useState("");
    const [active, setActive] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [awardedAmount, setAwardedAmount] = useState(0);

    // ── Fetch non-auto rules from database ────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        setSelectedRule(null);
        setQuantity(1);
        setError("");

        const fetchRules = async () => {
            setRulesLoading(true);
            try {
                const res = await fetch(`${BASE_URL}/api/rules`);
                const json = await res.json();
                const all = Array.isArray(json) ? json : json.data ?? [];

                // Only show rules that are NOT auto-awarded
                const manual = all.filter((r) => !r.auto);
                setRules(manual);

                // Auto-select first rule
                if (manual.length > 0) setSelectedRule(manual[0]);
            } catch (err) {
                console.error("Failed to fetch rules:", err);
                setError("Failed to load rules.");
            } finally {
                setRulesLoading(false);
            }
        };

        fetchRules();
    }, [isOpen]);

    if (!isOpen) return null;

    // ── Points calculation ────────────────────────────────────────────────────
    const rulePoints = parseInt(selectedRule?.points) || 0;
    const awardedPoints = rulePoints * quantity;
    const currentTotal = household?.points?.total ?? 0;
    const newTotal = currentTotal + awardedPoints;
    const calculation = selectedRule
        ? `${rulePoints} × ${quantity} = ${awardedPoints}`
        : "—";

    // ── Confirm award ─────────────────────────────────────────────────────────
    const handleConfirm = async () => {
        if (!selectedRule || !household?._id) return;

        setAwarding(true);
        setError("");

        const resultPoints = awardedPoints;


        try {
            const res = await fetch(
                `${BASE_URL}/api/households/${household._id}/award-points`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        points: awardedPoints,
                        ruleId: selectedRule._id,
                        reason: `${selectedRule.name} — ${quantity} × ${rulePoints} pts (manual award)`,
                        quantity,
                    }),
                }
            );

            const data = await res.json();

            if (!res.ok || !data.success) {
                setError(data.message || "Failed to award points.");
                setActive(false);
                return;
            }
            setAwardedAmount(resultPoints);
            setActive(false);
            setShowToast(true);
            setQuantity(1);
            onAwarded && onAwarded();
        } catch (err) {
            setError("Cannot connect to server.");
            setActive(false);
        } finally {
            setAwarding(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-lg flex flex-col overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-4 sm:px-6 py-2 border-b">
                    <div>
                        <h2 className="text-lg sm:text-xl font-bold">Assign Points</h2>
                        {household && (
                            <p className="text-sm text-gray-500">
                                To: <span className="font-medium text-gray-700">{household.fullname}</span>
                                {" "}— Current: <span className="font-medium text-green-600">{currentTotal} pts</span>
                            </p>
                        )}
                    </div>
                    <button onClick={onClose}>
                        <X className="text-gray-500 hover:text-gray-800 cursor-pointer" />
                    </button>
                </div>

                {/* BODY */}
                <div className="overflow-y-auto px-4 sm:px-6 py-5">
                    <div className="flex flex-col gap-4">

                        {/* Rule selector */}
                        <div className="flex flex-col">
                            <label className="font-semibold flex items-center gap-1 mb-1">
                                Select Rule
                                <Asterisk className="text-red-500 w-3 h-3" />
                            </label>

                            {rulesLoading ? (
                                <p className="text-gray-400 text-sm">Loading rules...</p>
                            ) : rules.length === 0 ? (
                                <p className="text-gray-400 text-sm">No manual rules available.</p>
                            ) : (
                                <select
                                    value={selectedRule?._id ?? ""}
                                    onChange={(e) => {
                                        const found = rules.find(r => r._id === e.target.value);
                                        setSelectedRule(found ?? null);
                                        setQuantity(1);
                                        setError("");
                                    }}
                                    className="w-full py-2 px-3 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
                                >
                                    {rules.map((rule, idx) => (
                                        <option key={rule._id} value={rule._id}>
                                            Rule {idx + 1} — {rule.name} ({rule.points} pts / {rule.freq})
                                        </option>
                                    ))}
                                </select>
                            )}
                        </div>

                        {/* Selected rule card */}
                        {selectedRule && (
                            <div className="relative bg-gray-50 rounded-xl flex flex-col shadow-lg overflow-hidden">
                                {selectedRule.image ? (
                                    <img
                                        src={selectedRule.image}
                                        alt={selectedRule.name}
                                        className="w-full h-40 object-cover"
                                    />
                                ) : (
                                    <div className="w-full h-40 bg-gray-200 flex items-center justify-center text-gray-400">
                                        No image
                                    </div>
                                )}

                                <div className="flex flex-col p-4 gap-1">
                                    <div className="flex justify-between items-center">
                                        <h1 className="text-lg font-bold">{selectedRule.name}</h1>
                                        <p className="text-sm text-gray-400 font-semibold px-3 py-1 rounded-full border">
                                            {selectedRule.freq}
                                        </p>
                                    </div>
                                    <p className="text-gray-500 text-sm">{selectedRule.decs}</p>
                                </div>

                                <div className="bg-white absolute top-2 right-2 rounded-lg p-2 shadow-md">
                                    <h2 className="flex flex-col text-center text-green-500 font-bold text-xl">
                                        +{selectedRule.points}
                                        <span className="text-gray-500 text-sm font-semibold">points</span>
                                    </h2>
                                </div>
                            </div>
                        )}

                        {/* Quantity */}
                        <div className="flex flex-col">
                            <label className="font-semibold">Quantity</label>
                            <input
                                value={quantity}
                                onChange={(e) => {
                                    const val = Math.max(1, parseInt(e.target.value) || 1);
                                    setQuantity(val);
                                }}
                                type="number"
                                min="1"
                                className="mt-1 px-3 py-2 rounded-lg border w-full focus:ring-2 focus:ring-green-500"
                            />
                        </div>

                        {/* Points summary */}
                        <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                            <div className="flex justify-between pb-3 border-b border-green-200 mb-3">
                                <div>
                                    <p className="text-sm text-gray-500">Current Points</p>
                                    <p className="font-bold text-xl">{currentTotal}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm text-gray-500">Points to Award</p>
                                    <p className="text-green-600 font-bold text-2xl">+{awardedPoints}</p>
                                </div>
                            </div>
                            <div className="flex justify-between">
                                <p className="text-xs text-gray-400">Calculation: {calculation}</p>
                                <div className="text-right">
                                    <p className="text-sm text-gray-500">New Total</p>
                                    <p className="text-green-600 font-bold text-xl">{newTotal}</p>
                                </div>
                            </div>
                        </div>

                        {/* Error */}
                        {error && <p className="text-red-500 text-sm">{error}</p>}

                        {/* Submit */}
                        <button
                            onClick={() => setActive(true)}
                            disabled={!selectedRule || awarding || rulesLoading}
                            className="mt-2 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        >
                            {awarding ? "Awarding..." : "Assign Points"}
                        </button>
                    </div>
                </div>

                {/* Confirmation Modal */}
                <ConfirmationModal
                    isOpen={active}
                    onClose={() => setActive(false)}
                    onConfirm={handleConfirm}
                />

                <SuccessToast
                    show={showToast}
                    onClose={() => setShowToast(false)}
                    message={`${awardedAmount} points awarded to ${household?.fullname}!`}
                />
            </div>
        </div>
    );
}
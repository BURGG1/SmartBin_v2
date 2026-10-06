import { X, Pin, Search } from "lucide-react";
import { useState, useEffect } from "react";
import BASE_URL from "../config";

export default function AwardModal({ isOpen, onClose, rule, onAwarded }) {

    const [households, setHouseholds]       = useState([]);
    const [loadingHH, setLoadingHH]         = useState(true);
    const [selectedId, setSelectedId]       = useState(null);   // single selection
    const [selectedHH, setSelectedHH]       = useState(null);   // full object
    const [search, setSearch]               = useState("");
    const [location, setLocation]           = useState("all");
    const [quantity, setQuantity]           = useState(1);
    const [awarding, setAwarding]           = useState(false);
    const [error, setError]                 = useState("");
    const [success, setSuccess]             = useState("");

    // ── Fetch all active households ───────────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        setSelectedId(null);
        setSelectedHH(null);
        setSearch("");
        setLocation("all");
        setQuantity(1);
        setError("");
        setSuccess("");

        const fetchHouseholds = async () => {
            setLoadingHH(true);
            try {
                const res  = await fetch(`${BASE_URL}/api/households?limit=500`);
                const data = await res.json();
                if (data.success) setHouseholds(data.data);
            } catch (err) {
                console.error("Failed to fetch households:", err);
                setError("Failed to load households.");
            } finally {
                setLoadingHH(false);
            }
        };

        fetchHouseholds();
    }, [isOpen]);

    if (!isOpen || !rule) return null;

    // ── Points calculation ────────────────────────────────────────────────────
    const rulePoints   = parseInt(rule.points) || 0;
    const awardedPoints = rulePoints * quantity;
    const currentTotal  = selectedHH?.points?.total ?? 0;
    const newTotal      = currentTotal + awardedPoints;
    const calculation   = `${rulePoints} × ${quantity} = ${awardedPoints}`;

    // ── Filtered households ───────────────────────────────────────────────────
    const filteredHouseholds = households.filter((h) => {
        const matchSearch =
            h.fullname?.toLowerCase().includes(search.toLowerCase()) ||
            h._id?.toLowerCase().includes(search.toLowerCase()) ||
            h.contactNumber?.includes(search);

        const street = h.address?.street?.toLowerCase() ?? "";
        const matchLocation =
            location === "all" ||
            street.includes(location.toLowerCase());

        return matchSearch && matchLocation;
    });

    // ── Select household ──────────────────────────────────────────────────────
    const handleSelect = (hh) => {
        setSelectedId(hh._id);
        setSelectedHH(hh);
        setError("");
        setSuccess("");
    };

    // ── Award points ──────────────────────────────────────────────────────────
    const handleAward = async () => {
        if (!selectedId) {
            setError("Please select a household first.");
            return;
        }
        if (quantity < 1) {
            setError("Quantity must be at least 1.");
            return;
        }

        setAwarding(true);
        setError("");
        setSuccess("");

        try {
            const res = await fetch(
                `${BASE_URL}/api/households/${selectedId}/award-points`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        points: awardedPoints,
                        ruleId: rule._id,
                        reason: `${rule.name} — ${quantity} × ${rulePoints} pts (manual award)`,
                        quantity: quantity,
                    }),
                }
            );

            const data = await res.json();

            if (!res.ok || !data.success) {
                setError(data.message || "Failed to award points.");
                return;
            }

            setSuccess(
                `✅ ${awardedPoints} points awarded to ${selectedHH.fullname}! New total: ${data.data.totalPoints}`
            );

            // Update local state so total reflects new value immediately
            setSelectedHH((prev) => ({
                ...prev,
                points: { ...prev.points, total: data.data.totalPoints },
            }));
            setHouseholds((prev) =>
                prev.map((h) =>
                    h._id === selectedId
                        ? { ...h, points: { ...h.points, total: data.data.totalPoints } }
                        : h
                )
            );

            onAwarded && onAwarded();
        } catch (err) {
            setError("Cannot connect to server.");
        } finally {
            setAwarding(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white h-auto max-h-[650px] w-full max-w-5xl rounded-2xl shadow-lg flex flex-col">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-3 border-b">
                    <h2 className="text-md text-gray-600 font-semibold">Assign Points</h2>
                    <button onClick={onClose}>
                        <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                    </button>
                </div>

                {/* RULE INFO + FILTERS */}
                <div className="w-full flex flex-col gap-4 px-4 py-3 border-b lg:flex-row">
                    <div className="flex-1">
                        <h2 className="text-md font-bold md:text-lg">{rule.name}</h2>
                        <p className="text-sm text-gray-500">{rule.decs}</p>
                        <p className="text-green-500 font-bold mt-1">
                            {rule.points} points{" "}
                            <span className="text-gray-400 font-normal text-sm">— {rule.freq}</span>
                        </p>
                    </div>

                    <div className="flex flex-col gap-2 w-auto">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Search household"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10 pr-4 py-2 border rounded-lg w-full sm:w-64 focus:ring-2 focus:ring-green-500"
                            />
                        </div>

                        {/* Location filter
                        <div className="relative">
                            <Pin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <select
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                className="pl-10 pr-4 py-2 border rounded-lg w-full sm:w-64 focus:ring-2 focus:ring-green-500 bg-white"
                            >
                                <option value="all">All Locations</option>
                                <option value="Rizal">Rizal Street</option>
                                <option value="Mabini">Mabini Street</option>
                                <option value="Bonifacio">Bonifacio Street</option>
                            </select>
                        </div> */}
                    </div>
                </div>

                {/* TABLE */}
                <div className="flex-1 overflow-y-auto overflow-x-auto">
                    {loadingHH ? (
                        <p className="text-center text-gray-400 py-8">Loading households...</p>
                    ) : (
                        <table className="w-full text-sm text-center">
                            <thead className="bg-gray-100 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-center">Household ID</th>
                                    <th className="px-4 py-3 text-center">Name</th>
                                    <th className="px-4 py-3 text-center">Address</th>
                                    <th className="px-4 py-3 text-center">Contact</th>
                                    <th className="px-4 py-3 text-center">Email</th>
                                    <th className="px-4 py-3 text-center">Points</th>
                                    <th className="px-4 py-3 text-center">Select</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredHouseholds.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="text-center py-8 text-gray-400">
                                            No households found.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredHouseholds.map((hh) => (
                                        <tr
                                            key={hh._id}
                                            onClick={() => handleSelect(hh)}
                                            className={`cursor-pointer hover:bg-gray-50 ${
                                                selectedId === hh._id ? "bg-green-50" : ""
                                            }`}
                                        >
                                            <td className="px-4 py-3 font-mono text-xs text-center">
                                                {hh._id.slice(-8).toUpperCase()}
                                            </td>
                                            <td className="px-4 py-3 font-medium text-center">{hh.fullname}</td>
                                            <td className="px-4 py-3 text-gray-500 text-center">
                                                {[hh.address?.houseNo, hh.address?.street]
                                                    .filter(Boolean)
                                                    .join(", ") || "—"}
                                            </td>
                                            <td className="px-4 py-3 text-center">+63 {hh.contactNumber}</td>
                                            <td className="px-4 py-3 text-center">{hh.email || "—"}</td>
                                            <td className="px-4 py-3 font-bold text-green-600 text-center">
                                                {hh.points?.total ?? 0}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <input
                                                    type="radio"
                                                    name="selectedHousehold"
                                                    checked={selectedId === hh._id}
                                                    onChange={() => handleSelect(hh)}
                                                    className="accent-green-600 w-4 h-4"
                                                />
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* POINTS SUMMARY + AWARD */}
                <div className="flex flex-col justify-between border-t p-4 gap-4 lg:flex-row">

                    {/* Points preview */}
                    <div className="flex-1 bg-green-50 border border-green-200 p-4 rounded-lg">
                        <div className="flex justify-between pb-3 border-b border-green-200 mb-3">
                            <div>
                                <p className="text-sm text-gray-500">Selected</p>
                                <p className="font-semibold">{selectedHH?.fullname ?? "—"}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-gray-500">Current Points</p>
                                <p className="font-bold text-xl">{currentTotal}</p>
                            </div>
                        </div>

                        <div className="flex justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Points to Award</p>
                                <p className="text-green-600 font-bold text-2xl">+{awardedPoints}</p>
                            </div>
                            <div className="text-right">
                                <p className="text-sm text-gray-500">New Total</p>
                                <p className="text-green-600 font-bold text-2xl">{newTotal}</p>
                            </div>
                        </div>

                        <p className="text-xs text-gray-400 mt-2">Calculation: {calculation}</p>
                    </div>

                    {/* Quantity + Submit */}
                    <div className="flex-1 flex flex-col gap-3">
                        <div>
                            <label className="font-semibold text-sm">Quantity</label>
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

                        {error && <p className="text-red-500 text-sm">{error}</p>}
                        {success && <p className="text-green-600 text-sm">{success}</p>}

                        <button
                            onClick={handleAward}
                            disabled={awarding || !selectedId}
                            className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {awarding ? "Awarding..." : "Assign Points"}
                        </button>
                    </div>
                </div>

            </div>
        </div>
    );
}
import { useState, useRef, useEffect } from "react";
import Navbar from "../../components/Navbar";
import NavigationShell from "../../navigation/mainNav";
import Footer from "../../components/Footer";
import BASE_URL from "../../config";
import Pagination from "../../components/Pagination";
import useDebounce from "../../hooks/useDebounce";

import {
    CheckCircle,
    AlertTriangle,
    XCircle,
    MapPin,
    Search,
    Asterisk,
    Plus,
    Filter,
} from "lucide-react";

import ConfirmationModal from "../../components/confirmationModal";
import CounterInfoModal from "../../components/CounterInfoModal";

const API = `${BASE_URL}/api/bins`;
const BINS_PER_PAGE = 6;

const statusColors = {
    good: {
        border: "border-green-300",
        badge: "bg-green-100 text-green-700",
        bar: "bg-green-600",
        icon: CheckCircle,
        iconColor: "text-green-600",
    },
    warning: {
        border: "border-yellow-300",
        badge: "bg-yellow-100 text-yellow-700",
        bar: "bg-yellow-500",
        icon: AlertTriangle,
        iconColor: "text-yellow-600",
    },
    critical: {
        border: "border-red-300",
        badge: "bg-red-100 text-red-700",
        bar: "bg-red-600",
        icon: XCircle,
        iconColor: "text-red-600",
    },
};

const typeColors = {
    Biodegradable: "bg-green-600",
    "Non-biodegradable": "bg-orange-600",
    Recyclable: "bg-blue-600",
};

function getStatusFromFill(fill) {
    if (fill >= 90) return "critical";
    if (fill >= 61) return "warning";
    return "good";
}

export default function WasteBin() {

    // Modals
    const [openConModal, setOpenConModal] = useState(false);
    const [activeBin, setActiveBin] = useState(null);
    const [openCounterModal, setOpenCounterModal] = useState(false);

    // Pending bin
    const [pendingBin, setPendingBin] = useState(null);

    // Add form
    const [binName, setBinName] = useState("");
    const [category, setCategory] = useState("");
    const [capacity, setCapacity] = useState("");
    const [location, setLocation] = useState("");
    const [lat, setLat] = useState("");
    const [lng, setLng] = useState("");
    const [addError, setAddError] = useState("");
    const [adding, setAdding] = useState(false);
    const [devices, setDevices] = useState([]);
    const [deviceId, setDeviceId] = useState("");

    // Table
    const [binsData, setBinsData] = useState([]);
    const [binsTotal, setBinsTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [binsError, setBinsError] = useState("");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebounce(search, 400);
    const [filter, setFilter] = useState("all");

    // Inline edit
    const inputRef = useRef(null);
    const [editingId, setEditingId] = useState(null);
    const [editedLocation, setEditedLocation] = useState("");
    const [saving, setSaving] = useState(false);

    // ── Pagination (server-side) ──
    const [binPage, setBinPage] = useState(1);

    useEffect(() => {
        fetchDevices();
    }, []);

    async function fetchBins(signal) {
        setLoading(true);
        setBinsError("");
        try {
            const params = new URLSearchParams({
                search: debouncedSearch,
                type: filter === "all" ? "" : filter,
                page: binPage,
                limit: BINS_PER_PAGE,
            });
            const res = await fetch(`${API}?${params}`, { signal });
            const data = await res.json();
            if (data.success) {
                setBinsData(data.data.map(normaliseBin));
                // Backend must return `total` = count of ALL bins matching
                // the search/type filter, not just this page's length.
                setBinsTotal(data.total ?? data.data.length);
            } else {
                setBinsError("Failed to load bins.");
            }
        } catch (err) {
            if (err.name === "AbortError") return;
            console.error("Failed to fetch bins:", err);
            setBinsError("Failed to load bins. Is the server running?");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        const controller = new AbortController();
        fetchBins(controller.signal);
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch, filter, binPage]);

    // Reset to page 1 whenever the search or filter changes
    useEffect(() => {
        setBinPage(1);
    }, [debouncedSearch, filter]);

    // If the total shrinks below the current page, step back.
    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(binsTotal / BINS_PER_PAGE));
        if (binPage > totalPages) setBinPage(totalPages);
    }, [binsTotal, binPage]);

    async function fetchDevices() {
        try {
            const res = await fetch(`${BASE_URL}/api/devices/available`);
            const data = await res.json();
            if (data.success) setDevices(data.data);
        } catch (err) {
            console.error("Failed to fetch devices:", err);
        }
    }

    function normaliseBin(doc) {
        return {
            _id: doc._id,
            id: doc.binId,
            name: doc.name,
            type: doc.type,
            capacity: doc.capacity,
            location: doc.location,
            fill: doc.fill ?? 0,
            lastEmptied: doc.lastEmptied ? new Date(doc.lastEmptied) : null,
            lat: doc.lat,
            lng: doc.lng,
            status: doc.status ?? "offline",
        };
    }

    function handleAddBin() {
        setAddError("");
        if (!binName.trim() || !category || !capacity || !location || !deviceId) {
            setAddError("All fields, including the bin device, are required.");
            return;
        }
        setPendingBin({
            name: binName.trim(),
            type: category,
            capacity,
            location,
            deviceId,
        });
        setOpenConModal(true);
    }

    async function handleConfirmAdd() {
        if (!pendingBin) {
            setOpenConModal(false);
            return;
        }

        setAdding(true);
        try {
            const res = await fetch(API, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: pendingBin.name,
                    type: pendingBin.type,
                    capacity: pendingBin.capacity,
                    location: pendingBin.location,
                    deviceId: pendingBin.deviceId,
                }),
            });
            const data = await res.json();

            if (data.success) {
                setBinName("");
                setCategory("");
                setCapacity("");
                setLocation("");
                setDeviceId("");
                setPendingBin(null);
                fetchDevices(); // refresh so the just-assigned device drops out of the list
                fetchBins(); // re-pull from the server instead of hand-patching local state
            } else {
                setAddError(data.message || "Failed to add bin.");
            }
        } catch (err) {
            setAddError("Network error. Please try again.");
        } finally {
            setAdding(false);
            setOpenConModal(false);
        }
    }

    function handleCancelModal() {
        setOpenConModal(false);
        setPendingBin(null);
    }

    async function handleSave(item) {
        if (!editedLocation.trim()) return;
        setSaving(true);
        try {
            const res = await fetch(`${API}/${item._id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ location: editedLocation }),
            });
            const data = await res.json();

            if (data.success) {
                setEditingId(null);
                fetchBins(); // reflect the server's actual saved value
            }
        } catch (err) {
            console.error("Save failed:", err);
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(item) {
        if (!window.confirm(`Delete ${item.id}?`)) return;
        try {
            const res = await fetch(`${API}/${item._id}`, { method: "DELETE" });
            const data = await res.json();
            if (data.success) {
                fetchBins();
            }
        } catch (err) {
            console.error("Delete failed:", err);
        }
    }

    useEffect(() => {
        if (editingId && inputRef.current) inputRef.current.focus();
    }, [editingId]);

    // Only pad the table out to a fixed number of rows once there's more
    // than one page — on a single page, let the table hug its real content.
    const binTotalPages = Math.max(1, Math.ceil(binsTotal / BINS_PER_PAGE));
    const binEmptyRows = binTotalPages > 1
        ? Math.max(0, BINS_PER_PAGE - binsData.length)
        : 0;

    return (
        <div className="flex-1">
            <Navbar />
            <div className="flex flex-col min-h-screen bg-gray-50 md:flex-row">
                <div className="flex gap-4">
                    <NavigationShell />
                    <div className="py-2 md:hidden">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
                            Waste bin Segregation Management
                        </h1>
                        <p className="text-gray-500 text-xs sm:text-lg">
                            Handle and Manage Smart bin Information
                        </p>
                    </div>
                </div>

                <main className="w-full p-4 sm:p-6 space-y-6">

                    <div className="hidden md:block">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
                            Waste bin Segregation Management
                        </h1>
                        <p className="text-gray-500 text-xs sm:text-lg">
                            Handle and Manage Smart bin Information
                        </p>
                    </div>

                    {/* ── Add Bin ───────────────────────────────────────────── */}
                    <section className="bg-white rounded-xl p-6 shadow">
                        <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
                            <Plus className="text-green-600" />
                            Add Bin Information
                        </h2>

                        {addError && (
                            <p className="mb-3 text-sm text-red-600">{addError}</p>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

                            {/* Bin Name */}
                            <div className="flex items-center">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <input
                                    type="text"
                                    value={binName}
                                    onChange={(e) => setBinName(e.target.value)}
                                    className="ml-2 px-3 py-2 rounded-lg border w-full"
                                    placeholder="Bin Name.."
                                />
                            </div>

                            {/* Bin Type */}
                            <div className="flex items-center">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <select
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value)}
                                    className="ml-2 w-full py-2 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="">Bin Type</option>
                                    <option value="Biodegradable">Biodegradable</option>
                                    <option value="Non-biodegradable">Non-Biodegradable</option>
                                </select>
                            </div>

                            {/* Capacity */}
                            <div className="flex items-center">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <select
                                    value={capacity}
                                    onChange={(e) => setCapacity(e.target.value)}
                                    className="ml-2 w-full py-2 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="">Capacity</option>
                                    <option value="100L">100L</option>
                                    <option value="500L">500L</option>
                                </select>
                            </div>

                            {/* Location */}
                            <div className="flex items-center">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <select
                                    value={location}
                                    onChange={(e) => setLocation(e.target.value)}
                                    className="ml-2 w-full py-2 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="">Bin Location</option>
                                    <option value="Rizal St.">Rizal St.</option>
                                    <option value="Mabini St.">Mabini St.</option>
                                    <option value="Bonifacio St.">Bonifacio St.</option>
                                </select>
                            </div>

                            {/* Bin Device */}
                            <div className="flex items-center">
                                <Asterisk className="text-red-500 w-4 h-4 shrink-0" />
                                <select
                                    value={deviceId}
                                    onChange={(e) => setDeviceId(e.target.value)}
                                    className="ml-2 w-full py-2 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
                                >
                                    <option value="">Select Bin Device (e.g. BIN-001)</option>
                                    {devices.map((d) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {d.deviceId} ({d.lat?.toFixed(5)}, {d.lng?.toFixed(5)})
                                        </option>
                                    ))}
                                </select>
                            </div>

                        </div>

                        <div className="mt-3 flex justify-end gap-2">
                            <button
                                onClick={handleAddBin}
                                disabled={adding}
                                className="cursor-pointer px-5 mt-auto bg-green-600 flex items-center justify-center gap-1 text-white rounded-lg p-2 hover:bg-green-700 transition disabled:opacity-50"
                            >
                                {adding ? "Adding..." : "Add"}
                            </button>
                        </div>
                    </section>

                    {/* ── Bin Information Table ─────────────────────────────── */}
                    <section className="bg-white rounded-2xl shadow p-6">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                            <h2 className="text-lg md:text-xl font-bold text-gray-900">
                                Bin Information
                            </h2>

                            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Search Bin ID..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        className="pl-10 pr-4 py-2 border rounded-lg w-full sm:w-64 focus:ring-2 focus:ring-green-500"
                                    />
                                </div>

                                <div className="relative">
                                    <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <select
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value)}
                                        className="pl-10 pr-4 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-green-500"
                                    >
                                        <option value="all">Category</option>
                                        <option value="Biodegradable">Biodegradable</option>
                                        <option value="Non-biodegradable">Non-Biodegradable</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            {loading ? (
                                <p className="text-center text-gray-400 py-8">Loading bins...</p>
                            ) : binsError ? (
                                <div className="text-center py-8">
                                    <p className="text-red-500 mb-2">{binsError}</p>
                                    <button
                                        onClick={() => fetchBins()}
                                        className="text-sm text-gray-600 underline cursor-pointer"
                                    >
                                        Retry
                                    </button>
                                </div>
                            ) : binsData.length === 0 ? (
                                <p className="text-center text-gray-400 py-8">No bins found.</p>
                            ) : (
                                <table className="w-full min-w-[800px]">
                                    <thead className="bg-gray-50 text-left">
                                        <tr>
                                            <th className="px-4 py-3 text-sm font-semibold">Bin ID</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Bin Name</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Bin Type</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Capacity</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Location</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {binsData.map((item) => (
                                            <tr key={item._id} className="hover:bg-gray-50 text-sm md:text-[16px]">
                                                <td className="px-4 py-3">{item.id}</td>
                                                <td className="px-4 py-3 font-medium">{item.name}</td>
                                                <td className="px-4 py-3 font-medium">{item.type}</td>
                                                <td className="px-4 py-3 text-gray-600">{item.capacity}</td>

                                                <td className="px-4 py-3 w-30">
                                                    <input
                                                        className="outline-none pl-2 border-b border-transparent focus:border-gray-300 rounded"
                                                        type="text"
                                                        ref={editingId === item._id ? inputRef : null}
                                                        value={editingId === item._id ? editedLocation : item.location}
                                                        disabled={editingId !== item._id}
                                                        onChange={(e) => setEditedLocation(e.target.value)}
                                                    />
                                                </td>

                                                <td className="px-4 py-3">
                                                    <div className="flex flex-row gap-2">
                                                        {editingId === item._id ? (
                                                            <button
                                                                className="bg-blue-600 cursor-pointer text-white px-3 py-1 rounded-lg disabled:opacity-50"
                                                                disabled={saving}
                                                                onClick={() => handleSave(item)}
                                                            >
                                                                {saving ? "Saving..." : "Save"}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="bg-green-600 text-white cursor-pointer px-3 py-1 rounded-lg"
                                                                onClick={() => {
                                                                    setEditingId(item._id);
                                                                    setEditedLocation(item.location);
                                                                }}
                                                            >
                                                                Edit
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {Array.from({ length: binEmptyRows }).map((_, i) => (
                                            <tr key={`bin-empty-${i}`} aria-hidden="true">
                                                <td className="px-4 py-3" colSpan={6}>&nbsp;</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {!loading && !binsError && (
                            <Pagination
                                currentPage={binPage}
                                totalItems={binsTotal}
                                itemsPerPage={BINS_PER_PAGE}
                                onPageChange={setBinPage}
                            />
                        )}
                    </section>

                    {/* ── Counter Section ───────────────────────────────────── */}
                    {/* Reuses the same paginated `binsData` as the table above —
                        rendering every bin here unbounded was the same
                        real-world scaling problem the table had. */}
                    <section className="bg-white rounded-xl p-6 shadow">
                        <h2 className="text-lg md:text-xl font-bold text-gray-900">
                            Counter Information
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-5">
                            {binsData.map((bin) => {
                                const status = getStatusFromFill(bin.fill);
                                const style = statusColors[status];

                                return (
                                    <div
                                        key={bin._id}
                                        className="bg-white rounded-xl border p-6 shadow-md"
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-bold">{bin.id} - {bin.name}</h3>
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium ${bin.status === "online"
                                                            ? "bg-green-100 text-green-700"
                                                            : "bg-gray-100 text-gray-500"
                                                        }`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${bin.status === "online" ? "bg-green-500" : "bg-gray-400"
                                                            }`} />
                                                        {bin.status === "online" ? "Online" : "Offline"}
                                                    </span>
                                                </div>
                                                <p className="flex items-center gap-1 text-sm text-gray-500">
                                                    <MapPin size={14} />
                                                    {bin.location}
                                                </p>
                                            </div>
                                        </div>

                                        <span
                                            className={`mt-3 inline-block px-3 py-1 text-xs text-white rounded-full ${typeColors[bin.type] ?? "bg-gray-500"}`}
                                        >
                                            {bin.type}
                                        </span>

                                        <div className="mt-4 text-sm space-y-1">
                                            <p>
                                                Last Collected:{" "}
                                                <strong>
                                                    {bin.lastEmptied
                                                        ? bin.lastEmptied.toLocaleString()
                                                        : "—"}
                                                </strong>
                                            </p>
                                        </div>

                                        <button
                                            onClick={() => {
                                                setActiveBin(bin);
                                                setOpenCounterModal(true);
                                            }}
                                            className="w-full mt-4 bg-gray-900 cursor-pointer text-white py-2 rounded-lg hover:bg-gray-800 flex items-center justify-center gap-2"
                                        >
                                            View
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                </main>
            </div>

            <ConfirmationModal
                isOpen={openConModal}
                onClose={handleCancelModal}
                onConfirm={handleConfirmAdd}
            />

            <CounterInfoModal
                isOpen={openCounterModal}
                onClose={() => setOpenCounterModal(false)}
                bin={activeBin}
            />

            <Footer />
        </div>
    );
}
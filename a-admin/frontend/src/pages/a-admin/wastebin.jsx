import { useState, useRef, useEffect } from "react";
import Navbar from "../../components/Navbar";
import NavigationShell from "../../navigation/mainNav";
import Footer from "../../components/Footer";
import BASE_URL from "../../config";
import Pagination from "../../components/Pagination";
import useDebounce from "../../hooks/useDebounce";
import BinDiagnosticsModal from "../../components/BinDiagnosticsModal";

import {
    CheckCircle,
    AlertTriangle,
    XCircle,
    HelpCircle,
    MapPin,
    Search,
    Asterisk,
    Eye,
    Plus,
    Filter,
    Pencil,
    X,
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

// ── Diagnostics summary (card header) ────────────────────────────────────────
const DIAG_STATUSES = {
    working: { label: "Working", Icon: CheckCircle, style: "bg-green-50 text-green-700", text: "text-green-700", icon: "text-green-600", border: "border-green-300" },
    warning: { label: "Warning", Icon: AlertTriangle, style: "bg-amber-50 text-amber-800", text: "text-amber-700", icon: "text-amber-500", border: "border-amber-300" },
    fault: { label: "Fault", Icon: XCircle, style: "bg-red-50 text-red-700", text: "text-red-700", icon: "text-red-600", border: "border-red-300" },
    unknown: { label: "Cannot verify", Icon: HelpCircle, style: "bg-gray-100 text-gray-600", text: "text-gray-600", icon: "text-gray-500", border: "border-gray-300" },
};

function formatDiagDate(value) {
    if (!value) return "No report received";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Invalid date" : date.toLocaleString();
}

async function fetchDiagnosticsReport(binId, signal) {
    const token = sessionStorage.getItem("token");
    const response = await fetch(
        `${BASE_URL}/api/bins/${encodeURIComponent(binId)}/diagnostics`,
        {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            headers: {
                Accept: "application/json",
                "Cache-Control": "no-cache",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal,
        }
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body.message || `Request failed (${response.status})`);
    }
    const data = body.data;
    if (data?.diagnostics) {
        return {
            ...data.diagnostics,
            name: data.name,
            stale: data.diagnostics.stale ?? false,
        };
    }
    return data?.components ? data : null;
}

function BinDiagnosticsCard({ bin, onOpen }) {
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const binId = bin?.binId || bin?.id;

    useEffect(() => {
        if (!binId) {
            setLoading(false);
            setError("This bin has no binId.");
            return undefined;
        }
        const controller = new AbortController();
        setLoading(true);
        setError("");

        fetchDiagnosticsReport(binId, controller.signal)
            .then((data) => setReport(data))
            .catch((err) => {
                if (err.name === "AbortError") return;
                setError(err.message || "Unable to load diagnostics.");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, [binId]);

    const overall = DIAG_STATUSES[report?.overallStatus] || DIAG_STATUSES.unknown;
    const OverallIcon = overall.Icon;

    return (
        <div className={`bg-white rounded-xl border ${overall.border} p-6 shadow-md flex flex-col`}>
            {/* Header: title + subtitle on the left, status icon on the right */}
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="font-bold">Bin Diagnostics</h3>
                    <p className="mt-1 text-sm text-gray-500">
                        {binId} · {report?.name || bin.name || "SmartBin"}
                    </p>
                </div>
                <OverallIcon size={24} className={`shrink-0 ${overall.icon}`} />
            </div>

            {/* Status summary */}
            <div className="mt-6 text-sm">
                {loading ? (
                    <p className="text-gray-500">Loading diagnostics…</p>
                ) : error ? (
                    <p className="text-red-600">{error}</p>
                ) : (
                    <>
                        <p className={`text-base font-semibold ${overall.text}`}>
                            Status: {overall.label}
                        </p>
                        <p className="mt-1">
                            Last report: {formatDiagDate(report?.reportedAt)}
                        </p>
                        {report?.stale && (
                            <p className="mt-1 font-medium">
                                Report is stale. Current component health cannot be confirmed.
                            </p>
                        )}
                        {!report?.reportedAt && (
                            <p className="mt-1">
                                The ESP32 has not submitted a report yet.
                            </p>
                        )}
                    </>
                )}
            </div>

            <div className="mt-auto pt-6">
                <button
                    onClick={onOpen}
                    className="w-full bg-blue-600 cursor-pointer text-white py-2 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2"
                >
                    <AlertTriangle size={16} />
                    Diagnostics
                </button>
            </div>
        </div>
    );
}

export default function WasteBin() {

    // Modals
    const [openConModal, setOpenConModal] = useState(false);
    const [activeBin, setActiveBin] = useState(null);
    const [openCounterModal, setOpenCounterModal] = useState(false);
    const [openAddModal, setOpenAddModal] = useState(false);
    const [openDiagnosticsModal, setOpenDiagnosticsModal] = useState(false);

    // Pending bin
    const [pendingBin, setPendingBin] = useState(null);

    // Add form
    const [binName, setBinName] = useState("");
    const [category, setCategory] = useState("");
    const [capacity, setCapacity] = useState("");
    const [location, setLocation] = useState("");
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
    const nameInputRef = useRef(null);
    const [editingBin, setEditingBin] = useState(null); // bin currently open in the edit modal
    const [editedName, setEditedName] = useState("");
    const [editedLocation, setEditedLocation] = useState("");
    const [editError, setEditError] = useState("");
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

    function closeAddModal() {
        if (adding) return;
        setOpenAddModal(false);
        setAddError("");
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
                setOpenAddModal(false);
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

    function openEditModal(item) {
        setEditingBin(item);
        setEditedName(item.name);
        setEditedLocation(item.location);
        setEditError("");
    }

    function closeEditModal() {
        if (saving) return;
        setEditingBin(null);
        setEditError("");
    }

    async function handleSave() {
        if (!editingBin) return;
        if (!editedName.trim() || !editedLocation.trim()) {
            setEditError("Bin name and location are required.");
            return;
        }
        setSaving(true);
        setEditError("");
        try {
            const res = await fetch(`${API}/${editingBin._id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: editedName.trim(),
                    location: editedLocation.trim(),
                }),
            });
            const data = await res.json();

            if (data.success) {
                setEditingBin(null);
                fetchBins(); // reflect the server's actual saved value
            } else {
                setEditError(data.message || "Failed to save changes.");
            }
        } catch (err) {
            console.error("Save failed:", err);
            setEditError("Network error. Please try again.");
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
        if (editingBin && nameInputRef.current) nameInputRef.current.focus();
    }, [editingBin]);

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

                                <button
                                    title="Add new bin"
                                    onClick={() => {
                                        setAddError("");
                                        setOpenAddModal(true);
                                    }}
                                    className="cursor-pointer inline-flex items-center justify-center gap-1.5 bg-green-600 text-white font-medium px-4 py-2 rounded-lg hover:bg-green-700 transition whitespace-nowrap"
                                >
                                    <Plus size={18} />
                                    Add new bin
                                </button>
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
                                    <thead className="bg-gray-50 text-center">
                                        <tr>
                                            <th className="px-4 py-3 text-sm font-semibold">Bin ID</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Bin Name</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Bin Type</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Capacity</th>
                                            <th className="px-4 py-3 text-sm font-semibold">Location</th>
                                            <th className="px-6 py-3 text-sm font-semibold">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {binsData.map((item) => (
                                            <tr key={item._id} className="text-center hover:bg-gray-50 text-sm md:text-[16px]">
                                                <td className="px-4 py-3">{item.id}</td>

                                                <td className="px-4 py-3 font-medium">{item.name}</td>
                                                <td className="px-4 py-3 font-medium">{item.type}</td>
                                                <td className="px-4 py-3 text-gray-600">{item.capacity}</td>

                                                <td className="px-4 py-3">{item.location}</td>

                                                <td className="flex justify-center px-3 py-3">
                                                    <button
                                                        className="flex justify-center items-center gap-1 bg-green-600 text-white cursor-pointer px-3 py-1 rounded-lg hover:bg-green-700 transition"
                                                        onClick={() => openEditModal(item)}
                                                    >
                                                        <Pencil size={14} />
                                                        Edit
                                                    </button>
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


                                        <div className="mt-4">
                                            <button
                                                onClick={() => {
                                                    setActiveBin(bin);
                                                    setOpenCounterModal(true);
                                                }}
                                                className="w-full bg-gray-900 cursor-pointer text-white py-2 rounded-lg hover:bg-gray-800 flex items-center justify-center gap-2"
                                            >
                                                <Eye size={16} />
                                                View
                                            </button>
                                        </div>

                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {/* ── Diagnostics Section ───────────────────────────────── */}
                    {/* Each card shows the diagnostics header summary (overall
                        status, last report, stale note); the button opens the
                        full modal. */}
                    <section className="bg-white rounded-xl p-6 shadow">
                        <h2 className="text-lg md:text-xl font-bold text-gray-900">
                            Bin Diagnostics
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-5">
                            {binsData.map((bin) => (
                                <BinDiagnosticsCard
                                    key={`diag-${bin._id}`}
                                    bin={bin}
                                    onOpen={() => {
                                        setActiveBin(bin);
                                        setOpenDiagnosticsModal(true);
                                    }}
                                />
                            ))}
                        </div>
                    </section>

                </main>
            </div>

            {/* ── Add Bin Information Modal ─────────────────────────────── */}
            {openAddModal && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-lg overflow-hidden max-h-[90vh] flex flex-col">

                        {/* HEADER */}
                        <div className="flex justify-between items-center px-6 py-4 border-b">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <Plus className="text-green-600" />
                                Add Bin Information
                            </h3>
                            <button onClick={closeAddModal} disabled={adding}>
                                <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                            </button>
                        </div>

                        {/* BODY */}
                        <div className="p-6 overflow-y-auto">
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
                                        className="ml-2 px-3 py-2 rounded-lg border w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
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
                                        <option value="Purok 1">Purok 1</option>
                                        <option value="Purok 2">Purok 2</option>
                                        <option value="Purok 3">Purok 3</option>
                                        <option value="Purok 4">Purok 4</option>
                                        <option value="Purok 5">Purok 5</option>
                                        <option value="Purok 6">Purok 6</option>
                                        <option value="Purok 7">Purok 7</option>
                                        <option value="Purok 8">Purok 8</option>
                                        <option value="Purok 9">Purok 9</option>
                                    </select>
                                </div>

                                {/* Bin Device */}
                                <div className="flex items-center md:col-span-2">
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
                        </div>

                        {/* FOOTER */}
                        <div className="flex justify-end gap-2 px-6 py-4 border-t">
                            <button
                                onClick={closeAddModal}
                                disabled={adding}
                                className="cursor-pointer bg-gray-600 text-white px-5 py-2 rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddBin}
                                disabled={adding}
                                className="cursor-pointer px-5 bg-green-600 flex items-center justify-center gap-1 text-white rounded-lg py-2 hover:bg-green-700 transition disabled:opacity-50"
                            >
                                <Plus size={16} />
                                {adding ? "Adding..." : "Add"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Edit Bin Modal ────────────────────────────────────────── */}
            {editingBin && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-lg overflow-hidden max-h-[90vh] flex flex-col">

                        {/* HEADER */}
                        <div className="flex justify-between items-center px-6 py-4 border-b">
                            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <Pencil size={18} className="text-green-600" />
                                Edit {editingBin.id}
                            </h3>
                            <button onClick={closeEditModal} disabled={saving}>
                                <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                            </button>
                        </div>

                        {/* BODY */}
                        <div className="p-6 overflow-y-auto space-y-4">
                            {editError && (
                                <p className="text-sm text-red-600">{editError}</p>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Bin Name
                                </label>
                                <input
                                    ref={nameInputRef}
                                    type="text"
                                    value={editedName}
                                    onChange={(e) => setEditedName(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                                    className="px-3 py-2 rounded-lg border w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    placeholder="Bin Name.."
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Location
                                </label>
                                <input
                                    type="text"
                                    value={editedLocation}
                                    onChange={(e) => setEditedLocation(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                                    className="px-3 py-2 rounded-lg border w-full focus:ring-2 focus:ring-green-500 focus:border-transparent"
                                    placeholder="Bin Location.."
                                />
                            </div>
                        </div>

                        {/* FOOTER */}
                        <div className="flex justify-end gap-2 px-6 py-4 border-t">
                            <button
                                onClick={closeEditModal}
                                disabled={saving}
                                className="cursor-pointer bg-gray-600 text-white px-5 py-2 rounded-lg hover:bg-gray-700 transition disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="cursor-pointer bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                            >
                                {saving ? "Saving..." : "Save"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Rendered after the add modal so it stacks on top */}
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


            <BinDiagnosticsModal
                isOpen={openDiagnosticsModal}
                onClose={() => setOpenDiagnosticsModal(false)}
                bin={activeBin}
            />


            <Footer />
        </div>
    );
}
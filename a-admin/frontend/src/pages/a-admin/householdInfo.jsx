import { useState, useEffect } from "react";
import Navbar from "../../components/Navbar";
import NavigationShell from "../../navigation/mainNav";
import Footer from "../../components/Footer";
import AddHousehold from "../../components/AddHouseholdModal";
import Pagination from "../../components/Pagination";
import useDebounce from "../../hooks/useDebounce";

import {
    MailPlus,
    Search,
    Plus,
    Home,
    Eye,
    AlertCircle,
} from "lucide-react";
import BASE_URL from "../../config";
import HouseholdRecordModal from "../../components/HHrecordModal";
import ConfirmationModal from "../../components/confirmationModal";
import AssignRFIDModal from "../../components/AssignRFID";

const REQUESTS_PER_PAGE = 10;
const HOUSEHOLDS_PER_PAGE = 10;

// Normalize a name so "  Juan   Dela Cruz " and "juan dela cruz" match.
const normalizeName = (name) =>
    (name || "").trim().replace(/\s+/g, " ").toLowerCase();

function RequestTab() {
    const [requests, setRequests] = useState([]);
    const [requestTotal, setRequestTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [requestError, setRequestError] = useState("");
    const [active, setActive] = useState(false);
    const [openRFIDmodal, setopenRFIDmodal] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState(null);

    const [declineActive, setDeclineActive] = useState(false);
    const [selectedDeclineId, setSelectedDeclineId] = useState(null);

    // ── Reason shown when a decline is not allowed ──
    // { title: string, message: string } | null
    const [declineNotice, setDeclineNotice] = useState(null);

    // ── Duplicate detection ──
    // IDs of pending requests whose name already exists in registered households.
    // Decline is only allowed for these.
    const [duplicateIds, setDuplicateIds] = useState(new Set());
    const [checkingDuplicates, setCheckingDuplicates] = useState(false);

    // ── Pagination (server-side) ──
    const [requestPage, setRequestPage] = useState(1);

    const fetchRequests = async (signal) => {
        setLoading(true);
        setRequestError("");
        try {
            const params = new URLSearchParams({
                status: "pending",
                page: requestPage,
                limit: REQUESTS_PER_PAGE,
            });
            const res = await fetch(`${BASE_URL}/api/requests?${params}`, { signal });
            const data = await res.json();
            if (data.success) {
                setRequests(data.data);
                // Backend should return a `total` count of ALL matching
                // pending requests (not just this page) so the pager knows
                // how many pages exist.
                setRequestTotal(data.total ?? data.data.length);
            } else {
                setRequestError("Failed to load requests.");
            }
        } catch (err) {
            if (err.name === "AbortError") return;
            console.error(err);
            setRequestError("Cannot connect to server.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        fetchRequests(controller.signal);
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestPage]);

    // Check each request on the current page against registered households.
    useEffect(() => {
        if (requests.length === 0) {
            setDuplicateIds(new Set());
            return;
        }

        const controller = new AbortController();

        const checkDuplicates = async () => {
            setCheckingDuplicates(true);
            try {
                const results = await Promise.all(
                    requests.map(async (req) => {
                        const target = normalizeName(req.fullname);
                        if (!target) return null;
                        try {
                            const params = new URLSearchParams({
                                search: req.fullname.trim(),
                                page: 1,
                                limit: 50,
                            });
                            const res = await fetch(
                                `${BASE_URL}/api/households?${params}`,
                                { signal: controller.signal }
                            );
                            const data = await res.json();
                            if (!data.success) return null;

                            // Exact (normalized) name match only — the search
                            // endpoint may return partial matches.
                            const isDuplicate = data.data.some(
                                (h) => normalizeName(h.fullname) === target
                            );
                            return isDuplicate ? req._id : null;
                        } catch (err) {
                            if (err.name === "AbortError") throw err;
                            return null;
                        }
                    })
                );
                if (!controller.signal.aborted) {
                    setDuplicateIds(new Set(results.filter(Boolean)));
                }
            } catch (err) {
                if (err.name === "AbortError") return;
                console.error(err);
                setDuplicateIds(new Set());
            } finally {
                if (!controller.signal.aborted) setCheckingDuplicates(false);
            }
        };

        checkDuplicates();
        return () => controller.abort();
    }, [requests]);

    // If an approve/decline shrinks the total below the current page,
    // step back to the last valid page.
    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(requestTotal / REQUESTS_PER_PAGE));
        if (requestPage > totalPages) setRequestPage(totalPages);
    }, [requestTotal, requestPage]);

    // Only pad the table out to a fixed number of rows once there's more
    // than one page — on a single page, let the table hug its real content.
    const requestTotalPages = Math.max(1, Math.ceil(requestTotal / REQUESTS_PER_PAGE));
    const requestEmptyRows = requestTotalPages > 1
        ? Math.max(0, REQUESTS_PER_PAGE - requests.length)
        : 0;

    const handleApprove = (item) => {
        setSelectedRequest(item);
        setActive(true);
    };

    const handleConfirmApprove = () => {
        setActive(false);
        setopenRFIDmodal(true);
    };

    const handleDeclineClick = (item) => {
        // Still verifying — we can't say yet whether it's a duplicate.
        if (checkingDuplicates) {
            setDeclineNotice({
                title: "Please wait",
                message:
                    "We're still checking whether this name is already registered. Try again in a moment.",
            });
            return;
        }

        // Decline is only allowed for duplicate registrations.
        if (!duplicateIds.has(item._id)) {
            setDeclineNotice({
                title: "Unable to decline this request",
                message: `A request can only be declined if it is a duplicate registration. No existing household is registered under the name "${item.fullname}", so this request can't be declined.`,
            });
            return;
        }

        setSelectedDeclineId(item._id);
        setDeclineActive(true);
    };

    const handleConfirmDecline = async () => {
        if (!selectedDeclineId) return;

        // Safety check in case state changed while the modal was open.
        if (!duplicateIds.has(selectedDeclineId)) {
            setDeclineActive(false);
            setSelectedDeclineId(null);
            setDeclineNotice({
                title: "Unable to decline this request",
                message:
                    "This request is no longer detected as a duplicate registration, so it can't be declined.",
            });
            return;
        }

        try {
            await fetch(`${BASE_URL}/api/requests/${selectedDeclineId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "declined" }),
            });
            fetchRequests();
        } catch (err) {
            alert("Cannot connect to server.");
        } finally {
            setDeclineActive(false);
            setSelectedDeclineId(null);
        }
    };

    const handleRFIDAssigned = async (rfid) => {
        if (!selectedRequest) return;

        try {
            const response = await fetch(`${BASE_URL}/api/households`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fullname: selectedRequest.fullname,
                    familyMember: selectedRequest.familyMember || null,
                    address: {
                        houseNo: selectedRequest.address?.houseNo || null,
                        street: selectedRequest.address?.street || null,
                    },
                    email: selectedRequest.email || null,
                    contactNumber: selectedRequest.contactNumber || "N/A",
                    rfid: rfid,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                alert(data.message || "Failed to register household.");
                return;
            }

            await fetch(`${BASE_URL}/api/requests/${selectedRequest._id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "approved" }),
            });

            alert("Household registered successfully!");

        } catch (err) {
            alert("Cannot connect to server.");
            return;
        }

        setopenRFIDmodal(false);
        setSelectedRequest(null);
        fetchRequests();
    };

    return (
        <section className="w-full bg-white rounded-2xl shadow p-6">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                <h2 className="text-lg md:text-xl font-bold text-gray-900">
                    Household Registration Request
                </h2>
            </div>

            {loading && <p className="text-center text-gray-400 py-8">Loading requests...</p>}

            {!loading && requestError && (
                <div className="text-center py-8">
                    <p className="text-red-500 mb-2">{requestError}</p>
                    <button
                        onClick={() => fetchRequests()}
                        className="text-sm text-gray-600 underline cursor-pointer"
                    >
                        Retry
                    </button>
                </div>
            )}

            {!loading && !requestError && (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[800px]">
                        <thead className="bg-gray-50 text-center">
                            <tr>
                                <th className="px-4 py-3 text-sm font-semibold">Name</th>
                                <th className="px-4 py-3 text-sm font-semibold">Address</th>
                                <th className="px-4 py-3 text-sm font-semibold">Email</th>
                                <th className="px-4 py-3 text-sm font-semibold">Contact Number</th>
                                <th className="px-4 py-3 text-sm font-semibold">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="text-center py-8 text-gray-400">
                                        No pending requests.
                                    </td>
                                </tr>
                            ) : (
                                <>
                                    {requests.map((item) => {
                                        const isDuplicate = duplicateIds.has(item._id);

                                        return (
                                            <tr key={item._id} className="hover:bg-gray-50 text-center">
                                                <td className="px-4 py-3 font-medium">
                                                    {item.fullname}
                                                    {isDuplicate && (
                                                        <span className="ml-2 text-xs font-normal bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
                                                            Already registered
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-gray-600">
                                                    {[item.address?.houseNo, item.address?.street]
                                                        .filter(Boolean)
                                                        .join(", ") || "—"}
                                                </td>
                                                <td className="px-4 py-3">{item.email || "—"}</td>
                                                <td className="px-4 py-3">{item.contactNumber || "—"}</td>
                                                <td className="flex flex-row justify-center items-center gap-2 py-3">
                                                    <button
                                                        onClick={() => handleApprove(item)}
                                                        className="cursor-pointer bg-green-600 text-white px-3 py-1 rounded-lg"
                                                    >
                                                        Approve
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeclineClick(item)}
                                                        className="cursor-pointer bg-red-600 text-white px-3 py-1 rounded-lg hover:bg-red-700"
                                                    >
                                                        Decline
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {Array.from({ length: requestEmptyRows }).map((_, i) => (
                                        <tr key={`request-empty-${i}`} aria-hidden="true">
                                            <td className="px-4 py-3" colSpan={5}>&nbsp;</td>
                                        </tr>
                                    ))}
                                </>
                            )}
                        </tbody>
                    </table>

                    <Pagination
                        currentPage={requestPage}
                        totalItems={requestTotal}
                        itemsPerPage={REQUESTS_PER_PAGE}
                        onPageChange={setRequestPage}
                    />
                </div>
            )}

            <ConfirmationModal
                isOpen={active}
                onClose={() => setActive(false)}
                onConfirm={handleConfirmApprove}
            />

            <AssignRFIDModal
                isOpen={openRFIDmodal}
                onClose={() => {
                    setopenRFIDmodal(false);
                    setSelectedRequest(null);
                }}
                onAssign={handleRFIDAssigned}
            />

            <ConfirmationModal
                isOpen={declineActive}
                onClose={() => {
                    setDeclineActive(false);
                    setSelectedDeclineId(null);
                }}
                onConfirm={handleConfirmDecline}
            />

            {/* ── Reason why a decline is not allowed ── */}
            {declineNotice && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
                    onClick={() => setDeclineNotice(null)}
                >
                    <div
                        role="alertdialog"
                        aria-modal="true"
                        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3">
                            <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={22} />
                            <div>
                                <h3 className="text-lg font-bold text-gray-900">
                                    {declineNotice.title}
                                </h3>
                                <p className="mt-2 text-sm text-gray-600">
                                    {declineNotice.message}
                                </p>
                            </div>
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={() => setDeclineNotice(null)}
                                className="cursor-pointer bg-gray-900 w-[100px] text-white px-4 py-2 rounded-lg hover:bg-gray-800"
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

export default function HouseholdInfo() {
    const [active, setActive] = useState(false);
    const [activeTab, setActiveTab] = useState("household");
    const [openHHModal, setOpenHHModal] = useState(false);
    const [openAddModal, setOpenAddModal] = useState(false);
    const [openRFIDmodal, setopenRFIDmodal] = useState(false);

    // ── Store the full household object (not just the ID) ──
    const [activeHousehold, setActiveHousehold] = useState(null);

    const [search, setSearch] = useState("");
    const debouncedSearch = useDebounce(search, 400);

    // ── DB state ──────────────────────────────────────
    const [householdRecords, setHouseholdRecords] = useState([]);
    const [householdTotal, setHouseholdTotal] = useState(0);
    const [loadingHouseholds, setLoadingHouseholds] = useState(true);
    const [fetchError, setFetchError] = useState("");

    // ── Pagination (server-side) ──
    const [householdPage, setHouseholdPage] = useState(1);

    // ── Fetch households from backend ─────────────────
    const fetchHouseholds = async (signal) => {
        setLoadingHouseholds(true);
        setFetchError("");
        try {
            const params = new URLSearchParams({
                search: debouncedSearch,
                page: householdPage,
                limit: HOUSEHOLDS_PER_PAGE,
            });
            const res = await fetch(`${BASE_URL}/api/households?${params}`, { signal });
            const data = await res.json();
            if (data.success) {
                setHouseholdRecords(data.data);
                // Backend must return `total` = count of ALL households
                // matching the search, not just this page's length.
                setHouseholdTotal(data.total ?? data.data.length);
            } else {
                setFetchError("Failed to load households.");
            }
        } catch (err) {
            if (err.name === "AbortError") return;
            setFetchError("Cannot connect to server. Make sure the backend is running.");
        } finally {
            setLoadingHouseholds(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        fetchHouseholds(controller.signal);
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearch, householdPage]);

    // Reset to page 1 whenever the (debounced) search term changes
    useEffect(() => {
        setHouseholdPage(1);
    }, [debouncedSearch]);

    // If the total shrinks below the current page (e.g. a record was
    // removed elsewhere), step back to the last valid page.
    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(householdTotal / HOUSEHOLDS_PER_PAGE));
        if (householdPage > totalPages) setHouseholdPage(totalPages);
    }, [householdTotal, householdPage]);

    const handleAddModalClose = () => {
        setOpenAddModal(false);
        fetchHouseholds();
    };

    const handleConfirm = () => {
        setActive(false);
        setopenRFIDmodal(true);
    };

    // Only pad the table out to a fixed number of rows once there's more
    // than one page — on a single page, let the table hug its real content.
    const householdTotalPages = Math.max(1, Math.ceil(householdTotal / HOUSEHOLDS_PER_PAGE));
    const householdEmptyRows = householdTotalPages > 1
        ? Math.max(0, HOUSEHOLDS_PER_PAGE - householdRecords.length)
        : 0;

    return (
        <div className="flex-1">
            <Navbar />
            <div className="flex flex-col min-h-screen bg-gray-50 md:flex-row">
                <div className="flex gap-4">
                    <NavigationShell />
                    <div className="py-2 md:hidden">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
                            Household Information Management
                        </h1>
                        <p className="text-gray-500 text-xs sm:text-lg">
                            Manage household Information of the community
                        </p>
                    </div>
                </div>

                <main className="w-full p-4 sm:p-6 space-y-6">

                    <div className="hidden md:block">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
                            Household Information Management
                        </h1>
                        <p className="text-gray-500 text-xs sm:text-lg">
                            Manage household Information of the community
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className="w-full flex overflow-x-auto bg-gray-100 rounded-full justify-center md:w-fit justify-evenly text-[#4A3B47] mb-6 p-1 space-x-2">
                        {[
                            { id: "household", label: "Household Information", icon: <Home size={15} /> },
                            { id: "request", label: "Registration Request", icon: <MailPlus size={15} /> },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center justify-center md:justify-between cursor-pointer gap-2 px-4 py-1 whitespace-nowrap transition ${activeTab === tab.id
                                    ? "bg-white rounded-full text-gray-800 shadow-sm"
                                    : "text-gray-600 hover:bg-gray-200 rounded-full"
                                    }`}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* HOUSEHOLD INFORMATION */}
                    {activeTab === "household" && (
                        <section className="w-full bg-white rounded-2xl shadow p-6">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
                                <h2 className="text-lg md:text-xl font-bold text-gray-900">
                                    Household Records
                                </h2>

                                <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                        <input
                                            type="text"
                                            placeholder="Search households..."
                                            value={search}
                                            onChange={(e) => setSearch(e.target.value)}
                                            className="pl-10 pr-4 py-2 border rounded-lg w-full sm:w-64 focus:ring-2 focus:ring-green-500"
                                        />
                                    </div>

                                    <div className="relative">
                                        <button
                                            title="Register household"
                                            onClick={() => setOpenAddModal(true)}
                                            className="bg-green-600 text-white w-full flex justify-center items-center p-2 rounded-lg cursor-pointer hover:bg-green-700"
                                        >
                                            <Plus size={20} />
                                            <p className="px-1"> Register Household</p>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Loading / Error states */}
                            {loadingHouseholds && (
                                <p className="text-center text-gray-400 py-8">Loading households...</p>
                            )}
                            {!loadingHouseholds && fetchError && (
                                <div className="text-center py-8">
                                    <p className="text-red-500 mb-2">{fetchError}</p>
                                    <button
                                        onClick={() => fetchHouseholds()}
                                        className="text-sm text-gray-600 underline cursor-pointer"
                                    >
                                        Retry
                                    </button>
                                </div>
                            )}

                            {/* Table */}
                            {!loadingHouseholds && !fetchError && (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[800px]">
                                        <thead className="bg-gray-50 text-center">
                                            <tr>
                                                <th className="px-4 py-3 text-sm font-semibold">Household ID</th>
                                                <th className="px-4 py-3 text-sm font-semibold">Name</th>
                                                <th className="px-4 py-3 text-sm font-semibold">Address</th>
                                                <th className="px-4 py-3 text-sm font-semibold">Contact</th>
                                                <th className="px-4 py-3 text-sm font-semibold">RFID</th>
                                                <th className="px-4 py-3 text-sm font-semibold">Action</th>
                                            </tr>
                                        </thead>

                                        <tbody>
                                            {householdRecords.length === 0 ? (
                                                 <tr>
                                                    <td colSpan={6} className="text-center py-8 text-gray-400">
                                                        No households found.
                                                    </td>
                                                </tr>
                                            ) : (
                                                <>
                                                    {householdRecords.map((item) => (
                                                        <tr key={item._id} className="hover:bg-gray-50 text-center">
                                                            <td className="px-4 py-3 font-mono text-sm">
                                                                {item._id.slice(-8).toUpperCase()}
                                                            </td>
                                                            <td className="px-4 py-3 font-medium">{item.fullname}</td>
                                                            <td className="px-4 py-3 text-gray-600">
                                                                {[item.address?.houseNo, item.address?.street]
                                                                    .filter(Boolean)
                                                                    .join(", ") || "—"}
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-600">
                                                                {item.contactNumber}
                                                            </td>
                                                            <td className="px-4 py-3 font-mono text-sm text-gray-600">
                                                                {item.rfid || "—"}
                                                            </td>
                                                            <td className="px-4 py-3 flex justify-center items-center gap-2">
                                                                <button
                                                                    onClick={() => setActiveHousehold(item)}
                                                                    className="flex items-center gap-1 cursor-pointer bg-gray-900 text-white px-3 py-1 rounded-lg"
                                                                >
                                                                    <Eye size={16} />
                                                                    View
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {Array.from({ length: householdEmptyRows }).map((_, i) => (
                                                        <tr key={`household-empty-${i}`} aria-hidden="true">
                                                            <td className="px-4 py-3" colSpan={6}>&nbsp;</td>
                                                        </tr>
                                                    ))}
                                                </>
                                            )}
                                        </tbody>
                                    </table>

                                    <Pagination
                                        currentPage={householdPage}
                                        totalItems={householdTotal}
                                        itemsPerPage={HOUSEHOLDS_PER_PAGE}
                                        onPageChange={setHouseholdPage}
                                    />
                                </div>
                            )}
                        </section>
                    )}

                    {/* REQUEST TAB */}
                    {activeTab === "request" && (
                        <RequestTab />
                    )}

                </main>

                <ConfirmationModal
                    isOpen={active}
                    onClose={() => setActive(false)}
                    onConfirm={handleConfirm}
                />

                <AddHousehold
                    isOpen={openAddModal}
                    onClose={handleAddModalClose}
                />

                <AssignRFIDModal
                    isOpen={openRFIDmodal}
                    onClose={() => setopenRFIDmodal(false)}
                />

                {/* ── Single modal instance outside the table loop ── */}
                <HouseholdRecordModal
                    isOpen={!!activeHousehold}
                    onClose={() => setActiveHousehold(null)}
                    household={activeHousehold}
                />

            </div>
            <Footer />
        </div>
    );
}
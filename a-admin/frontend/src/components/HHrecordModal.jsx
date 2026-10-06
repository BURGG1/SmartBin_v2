import { X, Calendar, Clipboard, Trash2, Award } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import AssignPointsModal from "./AssignPointsModal";
import Pagination from "./Pagination";
import BASE_URL from "../config";

const DISPOSAL_LIMIT = 5;
const ACTIVITY_LIMIT = 5;
const VIOLATION_LIMIT = 5;

function computeAge(birthday) {
    if (!birthday) return null;
    const birth = new Date(birthday);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--;
    return age;
}

function formatDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
    });
}

// YYYY-MM-DD for a given date value, used both to build the `from`/`to`
// query params and to read a record's own date field for comparison.
function toDateStr(d) {
    return new Date(d).toISOString().split("T")[0];
}

export default function HouseholdRecordModal({ isOpen, onClose, household: householdProp }) {
    const [household, setHousehold] = useState(null);
    const [activeTab, setActiveTab] = useState("disposal");
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [openPointsModal, setOpenPointsModal] = useState(false);

    // Disposal logs
    const [disposalLogs, setDisposalLogs] = useState([]);
    const [disposalTotal, setDisposalTotal] = useState(0);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState("");
    const [disposalPage, setDisposalPage] = useState(1);
    const disposalAbortRef = useRef(null);

    // Activity logs
    const [activityLogs, setActivityLogs] = useState([]);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState("");
    const [activityPage, setActivityPage] = useState(1);
    const [activityTotal, setActivityTotal] = useState(0);
    const activityAbortRef = useRef(null);

    // Violations
    const [violationLogs, setViolationLogs] = useState([]);
    const [violationLoading, setViolationLoading] = useState(false);
    const [violationError, setViolationError] = useState("");
    const [violationPage, setViolationPage] = useState(1);
    const [violationTotal, setViolationTotal] = useState(0);
    const violationAbortRef = useRef(null);

    const fetchHousehold = useCallback(async () => {
        if (!householdProp?._id) return;
        try {
            const res = await fetch(`${BASE_URL}/api/households/${householdProp._id}`);
            const data = await res.json();
            if (data.success) setHousehold(data.data);
        } catch (err) {
            console.error("Failed to refresh household:", err);
        }
    }, [householdProp?._id]);

    // ── Fetch a single page of disposal logs from the server ─────────────────
    // KNOWN BACKEND GAP: unlike the activity/violations routes, the
    // `/api/rfid/logs/:rfid` endpoint may not actually apply `page`/`limit`
    // server-side yet — some deployments of this route just filter by
    // action/date and hand back the full match set. If that happens here,
    // trusting the response as "already paginated" would render every
    // disposal record on one page and break `disposalTotal`.
    //
    // As a safety net (not a substitute for fixing the backend route):
    // if what comes back is bigger than DISPOSAL_LIMIT, treat it as an
    // unpaginated payload and slice/paginate it client-side instead. Once
    // the backend route is confirmed to paginate correctly, this branch
    // simply never triggers (filtered.length will already be <= limit)
    // and can be deleted.
    //
    // DATE FILTER: when the user hasn't picked a from/to date, we don't
    // show the entire history — we peek at the newest record's date and
    // scope the fetch to just that day. Assumes the backend returns
    // results sorted newest-first.
    const fetchDisposalLogs = useCallback(async (pageArg = 1) => {
        if (!householdProp?.rfid) return;

        disposalAbortRef.current?.abort();
        const controller = new AbortController();
        disposalAbortRef.current = controller;

        setLogsLoading(true);
        setLogsError("");
        try {
            let effectiveFrom = fromDate;
            let effectiveTo = toDate;

            if (!fromDate && !toDate) {
                const peekParams = new URLSearchParams({ action: "dispose", page: 1, limit: 1 });
                const peekRes = await fetch(`${BASE_URL}/api/rfid/logs/${householdProp.rfid}?${peekParams}`, {
                    signal: controller.signal,
                });
                const peekData = await peekRes.json();
                const latest = peekData?.success && peekData.data?.length > 0 ? peekData.data[0] : null;

                if (!latest) {
                    setDisposalLogs([]);
                    setDisposalTotal(0);
                    setDisposalPage(1);
                    setLogsLoading(false);
                    return;
                }

                const latestDate = toDateStr(latest.scannedAt);
                effectiveFrom = latestDate;
                effectiveTo = latestDate;
            }

            const params = new URLSearchParams({
                action: "dispose",
                page: pageArg,
                limit: DISPOSAL_LIMIT,
                ...(effectiveFrom && { from: effectiveFrom }),
                ...(effectiveTo && { to: effectiveTo }),
            });

            const res = await fetch(`${BASE_URL}/api/rfid/logs/${householdProp.rfid}?${params}`, {
                signal: controller.signal,
            });
            const data = await res.json();

            if (data.success) {
                // Safety net in case the backend ever returns mixed actions
                const filtered = data.data.filter((log) => log.action === "dispose");
                const serverTotal = data.pagination?.total ?? filtered.length;

                if (filtered.length > DISPOSAL_LIMIT) {
                    // The backend handed back more than one page's worth —
                    // it isn't slicing server-side, so slice here instead.
                    console.warn(
                        "/api/rfid/logs/:rfid returned more than one page of results — " +
                        "falling back to client-side pagination. Check that the backend " +
                        "route applies `page`/`limit` like the activity/violations routes do."
                    );
                    const start = (pageArg - 1) * DISPOSAL_LIMIT;
                    setDisposalLogs(filtered.slice(start, start + DISPOSAL_LIMIT));
                    setDisposalTotal(filtered.length);
                } else {
                    setDisposalLogs(filtered);
                    setDisposalTotal(serverTotal);
                }
                setDisposalPage(pageArg);
            } else {
                setLogsError("Failed to load disposal logs.");
            }
        } catch (err) {
            if (err.name !== "AbortError") setLogsError("Network error. Could not load logs.");
        } finally {
            if (disposalAbortRef.current === controller) setLogsLoading(false);
        }
    }, [householdProp?.rfid, fromDate, toDate]);

    // DATE FILTER: same "default to latest day" behavior as disposal logs.
    const fetchActivityLogs = useCallback(async (pageArg = 1) => {
        if (!householdProp?._id) return;

        activityAbortRef.current?.abort();
        const controller = new AbortController();
        activityAbortRef.current = controller;

        setActivityLoading(true);
        setActivityError("");
        try {
            let effectiveFrom = fromDate;
            let effectiveTo = toDate;

            if (!fromDate && !toDate) {
                const peekParams = new URLSearchParams({ page: 1, limit: 1 });
                const peekRes = await fetch(`${BASE_URL}/api/households/${householdProp._id}/activity?${peekParams}`, {
                    signal: controller.signal,
                });
                const peekData = await peekRes.json();
                const latest = peekData?.success && peekData.data?.length > 0 ? peekData.data[0] : null;

                if (!latest) {
                    setActivityLogs([]);
                    setActivityTotal(0);
                    setActivityPage(1);
                    setActivityLoading(false);
                    return;
                }

                const latestDate = toDateStr(latest.date);
                effectiveFrom = latestDate;
                effectiveTo = latestDate;
            }

            const params = new URLSearchParams({
                page: pageArg,
                limit: ACTIVITY_LIMIT,
                ...(effectiveFrom && { from: effectiveFrom }),
                ...(effectiveTo && { to: effectiveTo }),
            });

            const res = await fetch(`${BASE_URL}/api/households/${householdProp._id}/activity?${params}`, {
                signal: controller.signal,
            });
            const data = await res.json();

            if (data.success) {
                setActivityLogs(data.data);
                setActivityTotal(data.pagination?.total ?? 0);
                setActivityPage(pageArg);
            } else {
                setActivityError("Failed to load activity logs.");
            }
        } catch (err) {
            if (err.name !== "AbortError") setActivityError("Network error. Could not load activity.");
        } finally {
            if (activityAbortRef.current === controller) setActivityLoading(false);
        }
    }, [householdProp?._id, fromDate, toDate]);

    // ── Fetch a single page of violation logs from the server ────────────────
    // Request-limited the same way as disposal/activity: an in-flight
    // request is aborted before starting a new one, so a slow older
    // response can't land after a newer one and overwrite it with stale
    // violation data.
    //
    // FIX: this previously never sent from/to at all, so the date filter
    // had no effect on this tab. It now respects the filter, and — same
    // as the other two tabs — defaults to the latest day's records when
    // no filter is set.
    const fetchViolationLogs = useCallback(async (pageArg = 1) => {
        if (!householdProp?._id) return;

        violationAbortRef.current?.abort();
        const controller = new AbortController();
        violationAbortRef.current = controller;

        setViolationLoading(true);
        setViolationError("");
        try {
            const token = sessionStorage.getItem("token");
            let effectiveFrom = fromDate;
            let effectiveTo = toDate;

            if (!fromDate && !toDate) {
                const peekParams = new URLSearchParams({ page: 1, limit: 1 });
                const peekRes = await fetch(`${BASE_URL}/api/households/${householdProp._id}/violations?${peekParams}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    signal: controller.signal,
                });
                const peekData = await peekRes.json();
                const latest = peekData?.success && peekData.data?.length > 0 ? peekData.data[0] : null;

                if (!latest) {
                    setViolationLogs([]);
                    setViolationTotal(0);
                    setViolationPage(1);
                    setViolationLoading(false);
                    return;
                }

                const latestDate = toDateStr(latest.createdAt);
                effectiveFrom = latestDate;
                effectiveTo = latestDate;
            }

            const params = new URLSearchParams({
                page: pageArg,
                limit: VIOLATION_LIMIT,
                ...(effectiveFrom && { from: effectiveFrom }),
                ...(effectiveTo && { to: effectiveTo }),
            });
            const res = await fetch(`${BASE_URL}/api/households/${householdProp._id}/violations?${params}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                signal: controller.signal,
            });
            const data = await res.json();
            if (data.success) {
                setViolationLogs(data.data);
                setViolationTotal(data.pagination?.total ?? 0);
                setViolationPage(pageArg);
            } else {
                setViolationError("Failed to load violation logs.");
            }
        } catch (err) {
            if (err.name !== "AbortError") setViolationError("Network error.");
        } finally {
            if (violationAbortRef.current === controller) setViolationLoading(false);
        }
    }, [householdProp?._id, fromDate, toDate]);

    // ── On open: load everything fresh ───────────────────────────────────────
    useEffect(() => {
        if (!isOpen || !householdProp?._id) return;
        setHousehold(householdProp);
        fetchHousehold();
        fetchDisposalLogs(1);
        fetchActivityLogs(1);
        fetchViolationLogs(1);
        setActiveTab("disposal");
        setFromDate("");
        setToDate("");
        setOpenPointsModal(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, householdProp?._id]);

    // ── Re-fetch the active tab's data whenever the date filter changes ──────
    useEffect(() => {
        if (!isOpen) return;
        if (activeTab === "reward") fetchActivityLogs(1);
        if (activeTab === "disposal") fetchDisposalLogs(1);
        if (activeTab === "violations") fetchViolationLogs(1); //remove nalang if not needed
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate]);

    // Cancel any pending requests on unmount
    useEffect(() => () => {
        disposalAbortRef.current?.abort();
        activityAbortRef.current?.abort();
        violationAbortRef.current?.abort();
    }, []);

    // ── Called after points are awarded ──────────────────────────────────────
    const handlePointsAwarded = useCallback(async () => {
        await fetchHousehold();
        await fetchActivityLogs(1);
    }, [fetchHousehold, fetchActivityLogs]);

    if (!isOpen || !household) return null;

    const fullname = household.fullname || "—";
    const address = [household.address?.houseNo, household.address?.street].filter(Boolean).join(", ") || "—";
    const age = computeAge(household.birthday);
    const familyMembers = household.familyMember ?? "—";
    const contact = household.contactNumber ? `${household.contactNumber}` : "—";
    const email = household.email || "—";
    const rfid = household.rfid || "—";
    const householdId = household._id ? `HH-${household._id.slice(-8).toUpperCase()}` : "—";
    const registeredSince = formatDate(household.createdAt);
    const points = household.points?.total ?? 0;
    const violation = household.violation ?? 0;
    const suffix = ["st", "nd", "rd"];

    // Whether the user has picked an explicit filter; when they haven't,
    // each tab is silently scoped to its own latest date instead.
    const hasExplicitFilter = !!(fromDate || toDate);

    // Only pad each tab's table to a fixed height once that tab actually
    // spans more than one page — a single page just renders at its
    // natural height.
    const disposalTotalPages = Math.max(1, Math.ceil(disposalTotal / DISPOSAL_LIMIT));
    const activityTotalPages = Math.max(1, Math.ceil(activityTotal / ACTIVITY_LIMIT));
    const violationTotalPages = Math.max(1, Math.ceil(violationTotal / VIOLATION_LIMIT));

    const disposalEmptyRows =
        disposalTotalPages > 1 ? Math.max(0, DISPOSAL_LIMIT - disposalLogs.length) : 0;
    const activityEmptyRows =
        activityTotalPages > 1 ? Math.max(0, ACTIVITY_LIMIT - activityLogs.length) : 0;
    const violationEmptyRows =
        violationTotalPages > 1 ? Math.max(0, VIOLATION_LIMIT - violationLogs.length) : 0;

    return (
        <>
            {/* The record modal stays mounted (so tab, filters, scroll position
                and fetched data are preserved) but is hidden while the Add
                Points modal is open. */}
            <div
                className={`fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 ${openPointsModal ? "hidden" : ""}`}
            >
                <div className="bg-white w-full max-h-[90vh] overflow-y-auto max-w-5xl rounded-2xl shadow-lg overflow-hidden">

                    {/* HEADER */}
                    <div className="flex justify-between items-center px-5 py-1 border-b">
                        <h3 className="text-gray-600 text-sm">{fullname}'s Record</h3>
                        <button onClick={onClose}>
                            <X className="w-5 h-5 text-gray-500 cursor-pointer hover:text-gray-800" />
                        </button>
                    </div>

                    {/* INFO */}
                    <div className="w-full flex flex-col">
                        <div className="w-full flex flex-col md:flex-row justify-between px-6 py-4 border-b">
                            <div className="flex-1 text-left space-y-0.5">
                                <p className="text-sm">ID: <span className="font-semibold">{householdId}</span></p>
                                <p className="text-sm">Name: <span className="font-semibold">{fullname}</span></p>
                                <p className="text-sm">Address: <span className="font-semibold">{address}</span></p>
                                <p className="text-sm">Age: <span className="font-semibold">{age !== null ? `${age} yrs old` : "—"}</span></p>
                                <p className="text-sm">Members: <span className="font-semibold">{familyMembers}</span></p>
                                <p className="text-sm">Registered: <span className="font-semibold">{registeredSince}</span></p>
                            </div>
                            <div className="flex-1 text-left space-y-0.5">
                                <p className="text-sm">Contact: <span className="font-semibold">{contact}</span></p>
                                <p className="text-sm">Email: <span className="font-semibold">{email}</span></p>
                                <p className="text-sm">RFID: <span className="font-semibold font-mono">{rfid}</span></p>
                                <p className="text-sm">
                                    Points:{" "}
                                    <span className="font-semibold text-green-600 transition-all duration-300">
                                        {points}
                                    </span>
                                </p>
                                <p className="text-sm">
                                    Violations:{" "}
                                    {violation === 0 ? (
                                        <span className="font-semibold">No violation</span>
                                    ) : (
                                        <span className="font-semibold text-red-500">
                                            {violation}{suffix[violation - 1] ?? "th"} offense
                                        </span>
                                    )}
                                </p>
                            </div>
                        </div>

                        {/* Date filter + Add Points */}
                        <div className="w-full flex flex-col gap-2 md:flex-row px-6 py-2 border-b">
                            <div className="flex-1 flex items-center gap-2 w-auto">
                                <Calendar size={16} />
                                <p className="text-sm">Date:</p>
                                <input
                                    type="date"
                                    value={fromDate}
                                    onChange={(e) => {
                                        const val = e.target.value;

                                        setFromDate(val);
                                        setToDate(val);
                                    }}
                                    className="border rounded-lg px-3 py-2 text-sm w-50"
                                />
                            </div>
                            <div className="flex-1 flex justify-center lg:justify-end gap-2">
                                <button
                                    onClick={() => setOpenPointsModal(true)}
                                    className="flex cursor-pointer items-center gap-1 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700"
                                >
                                    <Award size={14} />
                                    Add Points
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* TABS */}
                    <div className="w-full flex overflow-x-auto bg-gray-200 rounded-tr-3xl rounded-tl-3xl mt-3 ml-1 px-1 justify-center md:w-fit justify-evenly text-[#4A3B47] pt-1 space-x-2">
                        {[
                            { id: "disposal", label: "Disposal Log", icon: <Trash2 size={15} /> },
                            { id: "reward", label: "Activity Log", icon: <Clipboard size={15} /> },
                            { id: "violations", label: "Violations", icon: <ShieldAlert size={15} /> },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => {
                                    setActiveTab(tab.id);
                                    if (tab.id === "reward") fetchActivityLogs(1);
                                    if (tab.id === "disposal") fetchDisposalLogs(1);
                                    if (tab.id === "violations") fetchViolationLogs(1);
                                }}
                                className={`flex items-center m-0 justify-center md:justify-between cursor-pointer gap-2 px-4 py-1 whitespace-nowrap transition ${activeTab === tab.id
                                    ? "bg-white rounded-tr-3xl rounded-tl-3xl text-gray-800"
                                    : "text-gray-600 hover:bg-gray-200 rounded-tr-3xl rounded-tl-3xl"
                                    }`}
                            >
                                {tab.icon}
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>

                    {/* DISPOSAL LOG */}
                    {activeTab === "disposal" && (
                        <div className="px-2">

                            <div className="overflow-x-auto">
                                {logsLoading ? (
                                    <p className="text-center py-6 text-gray-400">Loading logs...</p>
                                ) : logsError ? (
                                    <p className="text-center py-6 text-red-500">{logsError}</p>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-400 sticky top-0">
                                            <tr>
                                                <th className="py-3">Bin ID</th>
                                                <th>Bin Type</th>
                                                <th>Disposal Order</th>
                                                <th>Date & Time</th>
                                                <th>Resident</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-center">
                                            {disposalLogs.length === 0 ? (
                                                <tr>
                                                    <td colSpan="5" className="text-center py-6 text-gray-500">
                                                        No records found for selected dates
                                                    </td>
                                                </tr>
                                            ) : (
                                                disposalLogs.map((log) => {
                                                    const scannedAt = new Date(log.scannedAt);
                                                    const date = scannedAt.toLocaleDateString("en-CA");
                                                    const time = scannedAt.toLocaleTimeString("en-US", {
                                                        hour: "2-digit", minute: "2-digit", second: "2-digit",
                                                    });
                                                    const binTypeMatch = log.note?.match(/\((.+)\)/);
                                                    const binType = binTypeMatch ? binTypeMatch[1] : "—";
                                                    return (
                                                        <tr key={log._id}>
                                                            <td className="py-3 font-medium">#{log.binId ?? "—"}</td>
                                                            <td className="py-3 font-medium">{binType}</td>
                                                            <td className="py-3 font-medium">#{log.disposalOrder ?? "—"}</td>
                                                            <td>
                                                                <p>{date}</p>
                                                                <p className="text-xs text-gray-500">{time}</p>
                                                            </td>
                                                            <td>{log.household?.fullname ?? fullname}</td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                            {/* Pad remaining slots so table height stays constant at
                                                DISPOSAL_LIMIT rows, but only once there's more than one
                                                page — a single page just renders at its natural height. */}
                                            {disposalLogs.length > 0 &&
                                                Array.from({ length: disposalEmptyRows }).map((_, i) => (
                                                    <tr key={`disposal-empty-${i}`} aria-hidden="true">
                                                        <td className="py-3" colSpan="5">&nbsp;</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {!logsLoading && !logsError && (
                                <Pagination
                                    currentPage={disposalPage}
                                    totalItems={disposalTotal}
                                    itemsPerPage={DISPOSAL_LIMIT}
                                    onPageChange={fetchDisposalLogs}
                                />
                            )}
                        </div>
                    )}

                    {/* ACTIVITY LOG */}
                    {activeTab === "reward" && (
                        <div className="px-2">

                            <div className="overflow-x-auto">
                                {activityLoading ? (
                                    <p className="text-center py-6 text-gray-400">Loading activity...</p>
                                ) : activityError ? (
                                    <p className="text-center py-6 text-red-500">{activityError}</p>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-400 sticky top-0">
                                            <tr>
                                                <th className="py-3">Date</th>
                                                <th>Type</th>
                                                <th>Description</th>
                                                <th>Quantity</th>
                                                <th className="px-4">Points</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-center">
                                            {activityLogs.length === 0 ? (
                                                <tr>
                                                    <td colSpan="5" className="text-center py-6 text-gray-500">
                                                        No records found
                                                    </td>
                                                </tr>
                                            ) : (
                                                activityLogs.map((activity) => (
                                                    <tr key={activity._id}>
                                                        <td>{new Date(activity.date).toLocaleDateString("en-CA")}</td>
                                                        <td className="w-fit py-3 font-medium">{activity.type}</td>
                                                        <td className="px-2 max-w-[180px] text-center break-words whitespace-normal">
                                                            {activity.description}
                                                        </td>
                                                        <td>{activity.amount}</td>
                                                        <td className={`font-semibold ${activity.points > 0 ? "text-green-600" : "text-red-500"}`}>
                                                            {activity.points > 0 ? `+${activity.points}` : activity.points}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                            {/* Pad remaining slots so table height stays constant at
                                                ACTIVITY_LIMIT rows, but only once there's more than one
                                                page — a single page just renders at its natural height. */}
                                            {activityLogs.length > 0 &&
                                                Array.from({ length: activityEmptyRows }).map((_, i) => (
                                                    <tr key={`activity-empty-${i}`} aria-hidden="true">
                                                        <td className="py-3" colSpan="5">&nbsp;</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {!activityLoading && !activityError && (
                                <Pagination
                                    currentPage={activityPage}
                                    totalItems={activityTotal}
                                    itemsPerPage={ACTIVITY_LIMIT}
                                    onPageChange={fetchActivityLogs}
                                />
                            )}
                        </div>
                    )}

                    {/* remove nalang if not needed */}
                    {/* VIOLATION LOG */}
                    {activeTab === "violations" && (
                        <div className="px-2">

                            <div className="overflow-x-auto">
                                {violationLoading ? (
                                    <p className="text-center py-6 text-gray-400">Loading violations...</p>
                                ) : violationError ? (
                                    <p className="text-center py-6 text-red-500">{violationError}</p>
                                ) : (
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-400 sticky top-0">
                                            <tr>
                                                <th className="py-3">Date</th>
                                                <th>Offense #</th>
                                                <th>Penalty Type</th>
                                                <th>Points Deducted</th>
                                                <th>Fine</th>
                                                <th>Community Service</th>
                                                <th>Issued By</th>
                                            </tr>
                                        </thead>
                                        <tbody className="text-center">
                                            {violationLogs.length === 0 ? (
                                                <tr>
                                                    <td colSpan="7" className="py-6 text-gray-500">No violations on record</td>
                                                </tr>
                                            ) : (
                                                violationLogs.map((log) => (
                                                    <tr key={log._id}>
                                                        <td className="py-3">{new Date(log.createdAt).toLocaleDateString("en-CA")}</td>
                                                        <td className="font-semibold text-red-600">#{log.offenseNumber}</td>
                                                        <td>{log.penaltyType}</td>
                                                        <td>{log.pointsDeducted > 0 ? `-${log.pointsDeducted}` : "—"}</td>
                                                        <td>{log.fineAmount > 0 ? `₱${log.fineAmount}` : "—"}</td>
                                                        <td>{log.communityService ?? "—"}</td>
                                                        <td>{log.issuedBy}</td>
                                                    </tr>
                                                ))
                                            )}
                                            {/* Pad remaining slots so table height stays constant at
                                                VIOLATION_LIMIT rows, but only once there's more than
                                                one page — a single page just renders at its natural
                                                height. */}
                                            {violationLogs.length > 0 &&
                                                Array.from({ length: violationEmptyRows }).map((_, i) => (
                                                    <tr key={`v-empty-${i}`} aria-hidden="true">
                                                        <td className="py-3" colSpan="7">&nbsp;</td>
                                                    </tr>
                                                ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                            {!violationLoading && !violationError && (
                                <Pagination
                                    currentPage={violationPage}
                                    totalItems={violationTotal}
                                    itemsPerPage={VIOLATION_LIMIT}
                                    onPageChange={fetchViolationLogs}
                                />
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Rendered outside the hidden wrapper so it stays visible */}
            <AssignPointsModal
                isOpen={openPointsModal}
                onClose={() => setOpenPointsModal(false)}
                household={household}
                onAwarded={handlePointsAwarded}
            />
        </>
    );
}
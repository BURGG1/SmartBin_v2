import { X, Calendar, Clipboard, Trash2, Award } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { ShieldAlert } from "lucide-react";
import AssignPointsModal from "./AssignPointsModal";
import Pagination from "./Pagination";
import BASE_URL from "../config";

const DISPOSAL_LIMIT = 5;
const ACTIVITY_LIMIT = 5;

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
    const VIOLATION_LIMIT = 3;

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
    const fetchDisposalLogs = useCallback(async (pageArg = 1) => {
        if (!householdProp?.rfid) return;

        disposalAbortRef.current?.abort();
        const controller = new AbortController();
        disposalAbortRef.current = controller;

        setLogsLoading(true);
        setLogsError("");
        try {
            const params = new URLSearchParams({
                action: "dispose",
                page: pageArg,
                limit: DISPOSAL_LIMIT,
                ...(fromDate && { from: fromDate }),
                ...(toDate && { to: toDate }),
            });

            const res = await fetch(`${BASE_URL}/api/rfid/logs/${householdProp.rfid}?${params}`, {
                signal: controller.signal,
            });
            const data = await res.json();

            if (data.success) {
                // Safety net in case the backend ever returns mixed actions
                setDisposalLogs(data.data.filter((log) => log.action === "dispose"));
                setDisposalTotal(data.pagination?.total ?? data.data.length);
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

    const fetchActivityLogs = useCallback(async (pageArg = 1) => {
        if (!householdProp?._id) return;

        activityAbortRef.current?.abort();
        const controller = new AbortController();
        activityAbortRef.current = controller;

        setActivityLoading(true);
        setActivityError("");
        try {
            const params = new URLSearchParams({
                page: pageArg,
                limit: ACTIVITY_LIMIT,
                ...(fromDate && { from: fromDate }),
                ...(toDate && { to: toDate }),
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

    const fetchViolationLogs = useCallback(async (pageArg = 1) => {
        if (!householdProp?._id) return;
        setViolationLoading(true);
        setViolationError("");
        try {
            const token = sessionStorage.getItem("token");
            const params = new URLSearchParams({ page: pageArg, limit: VIOLATION_LIMIT });
            const res = await fetch(`${BASE_URL}/api/households/${householdProp._id}/violations?${params}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            const data = await res.json();
            if (data.success) {
                setViolationLogs(data.data);
                setViolationTotal(data.pagination?.total ?? 0);
                setViolationPage(pageArg);
            } else {
                setViolationError("Failed to load violation logs.");
            }
        } catch {
            setViolationError("Network error.");
        } finally {
            setViolationLoading(false);
        }
    }, [householdProp?._id]);

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
    const contact = household.contactNumber ? `+63-${household.contactNumber}` : "—";
    const email = household.email || "—";
    const rfid = household.rfid || "—";
    const householdId = household._id ? `HH-${household._id.slice(-8).toUpperCase()}` : "—";
    const registeredSince = formatDate(household.createdAt);
    const points = household.points?.total ?? 0;
    const violation = household.violation ?? 0;
    const suffix = ["st", "nd", "rd"];

    const disposalEmptyRows = Math.max(0, DISPOSAL_LIMIT - disposalLogs.length);
    const activityEmptyRows = Math.max(0, ACTIVITY_LIMIT - activityLogs.length);

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
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
                                onChange={(e) => setFromDate(e.target.value)}
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
                                        {/* Pad remaining slots so table height stays constant at DISPOSAL_LIMIT rows */}
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
                                        {/* Pad remaining slots so table height stays constant at ACTIVITY_LIMIT rows */}
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
                                        {violationLogs.length > 0 &&
                                            Array.from({ length: Math.max(0, VIOLATION_LIMIT - violationLogs.length) }).map((_, i) => (
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

            <AssignPointsModal
                isOpen={openPointsModal}
                onClose={() => setOpenPointsModal(false)}
                household={household}
                onAwarded={handlePointsAwarded}
            />
        </div>
    );
}
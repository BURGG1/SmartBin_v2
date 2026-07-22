import { X, Calendar } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import ViolationModal from "./ViolationModal";
import Pagination from "./Pagination";
import BASE_URL from "../config";

const LOGS_LIMIT = 7;

export default function CounterInfoModal({ isOpen, onClose, bin }) {
    const [openModal, setOpenModal] = useState(false);
    const [activeHH, setActiveHH] = useState(null);
    const [fromDate, setFromDate] = useState("");
    const [disposalLogs, setDisposalLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [page, setPage] = useState(1);

    const abortRef = useRef(null);

    const fetchLogs = useCallback(async (pageArg = 1) => {
        if (!bin?.id) return;

        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams({
                binId: bin.id,
                action: "dispose",
                page: pageArg,
                limit: LOGS_LIMIT,
                ...(fromDate && { date: fromDate }),
            });

            const res = await fetch(`${BASE_URL}/api/rfid/logs?${params}`, { signal: controller.signal });
            if (!res.ok) throw new Error(`Server error (${res.status})`);
            const data = await res.json();

            if (data.success) {
                setDisposalLogs(data.data);
                setTotal(data.pagination?.total ?? data.data.length);
                setPage(pageArg);
            } else {
                setError(data.message || "Failed to load logs.");
            }
        } catch (err) {
            if (err.name !== "AbortError") setError("Network error. Could not load logs.");
        } finally {
            if (abortRef.current === controller) setLoading(false);
        }
    }, [bin?.id, fromDate]);

    useEffect(() => {
        if (!isOpen || !bin?.id) return;
        setFromDate("");
        fetchLogs(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, bin?.id]);

    useEffect(() => {
        if (!isOpen || !bin?.id) return;
        fetchLogs(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate]);

    useEffect(() => () => abortRef.current?.abort(), []);

    if (!isOpen || !bin) return null;

    const emptyRows = Math.max(0, LOGS_LIMIT - disposalLogs.length);

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white max-h-[90vh] w-full max-w-5xl rounded-2xl shadow-lg flex flex-col overflow-y-auto">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-1 border-b">
                    <h2 className="text-md text-gray-600 font-semi-bold">Counter Information</h2>
                    <button onClick={onClose}>
                        <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                    </button>
                </div>

                {/* FILTER */}
                <div className="w-full flex flex-col justify-between items-center sm:flex-row px-4 py-2 border-b">
                    <div className="flex-1">
                        <h2 className="text-md font-bold md:text-lg">
                            {bin.id} - <span>{bin.type}</span>
                        </h2>
                    </div>
                    <div className="flex items-center gap-2 w-auto">
                        <Calendar className="w-4 h-4 md:w-5 md:h-5" />
                        <p>Date Collected:</p>
                        <input
                            type="date"
                            value={fromDate}
                            onChange={(e) => setFromDate(e.target.value)}
                            className="border rounded-lg px-3 py-2 text-sm w-50"
                        />
                    </div>
                </div>

                {/* TABLE */}
                <div className="overflow-x-auto">
                    {loading ? (
                        <p className="text-center py-6 text-gray-400">Loading logs...</p>
                    ) : error ? (
                        <p className="text-center py-6 text-red-500">{error}</p>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-100 sticky top-0">
                                <tr>
                                    <th className="py-3">Date & Time</th>
                                    <th>Household ID</th>
                                    <th>Disposal Order</th>
                                    <th>Resident</th>
                                    <th>Contact No.</th>
                                    <th>Email</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody className="text-center">
                                {disposalLogs.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="text-center py-6 text-gray-500">
                                            No records found for selected dates
                                        </td>
                                    </tr>
                                ) : (
                                    disposalLogs.map((log) => {
                                        const scannedAt = new Date(log.scannedAt);
                                        const date = scannedAt.toISOString().split("T")[0];
                                        const time = scannedAt.toLocaleTimeString("en-US", {
                                            hour: "2-digit", minute: "2-digit", second: "2-digit",
                                        });
                                        const hh = log.household;
                                        const householdId = hh?._id ? `HH-${hh._id.slice(-8).toUpperCase()}` : "—";
                                        const contact = hh?.contactNumber ? `+63-${hh.contactNumber}` : "—";
                                        const isFlagged = !!log.flagged;

                                        return (
                                            <tr
                                                key={log._id}
                                                // Red row background if flagged
                                                className={isFlagged ? "bg-red-100" : "hover:bg-gray-50"}
                                            >
                                                <td className="py-2">
                                                    <p>{date}</p>
                                                    <p className="text-xs text-gray-500">{time}</p>
                                                </td>

                                                {/* Red text on Household ID if flagged */}
                                                <td className={isFlagged ? "text-red-600 font-semibold" : ""}>
                                                    {householdId}
                                                </td>

                                                <td className="px-6 py-3 font-medium">
                                                    #{log.disposalOrder ?? "—"}
                                                </td>

                                                {/* Red text + dot on Resident name if flagged */}
                                                <td className={isFlagged ? "text-red-600 font-semibold" : ""}>
                                                    <div className="flex items-center justify-center gap-1">
                                                        {isFlagged && (
                                                            <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
                                                        )}
                                                        {hh?.fullname ?? "—"}
                                                    </div>
                                                </td>

                                                <td>{contact}</td>
                                                <td>{hh?.email ?? "—"}</td>

                                                {/* Penalize button */}
                                                <td>
                                                    <button
                                                        onClick={() => {
                                                            setActiveHH(log);
                                                            setOpenModal(true);
                                                        }}
                                                        disabled={!isFlagged}
                                                        className={
                                                            isFlagged
                                                                ? "bg-red-600 text-white px-2 py-1 rounded-lg cursor-pointer hover:bg-red-700 transition"
                                                                : "bg-gray-300 text-gray-500 px-2 py-1 rounded-lg cursor-not-allowed"
                                                        }
                                                    >
                                                        Penalize
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}

                                {disposalLogs.length > 0 &&
                                    Array.from({ length: emptyRows }).map((_, i) => (
                                        <tr key={`counter-empty-${i}`} aria-hidden="true">
                                            <td className="py-3" colSpan="7">&nbsp;</td>
                                        </tr>
                                    ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {!loading && !error && (
                    <div className="px-6 pb-2">
                        <Pagination
                            currentPage={page}
                            totalItems={total}
                            itemsPerPage={LOGS_LIMIT}
                            onPageChange={fetchLogs}
                        />
                    </div>
                )}
            </div>

            <ViolationModal
                isOpen={openModal}
                onClose={() => setOpenModal(false)}
                household={activeHH}
                onPenalized={() => {
                    setOpenModal(false);
                    fetchLogs(page);
                }}
            />
        </div>
    );
}
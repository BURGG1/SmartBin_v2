import { X, Calendar } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import Pagination from "./Pagination";
import BASE_URL from "../config";

const REWARD_LIMIT = 7;

export function ViewRewardModal({ isOpen, onClose, rName }) {
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    const [page, setPage] = useState(1);
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const abortRef = useRef(null);

    // ── Fetch a single page of reward redemption logs from the server ────────
    const fetchLogs = useCallback(async (pageArg = 1) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams({
                page: pageArg,
                limit: REWARD_LIMIT,
                ...(rName && { rewardName: rName }),
                ...(fromDate && { from: fromDate }),
                ...(toDate && { to: toDate }),
            });

            // NOTE: adjust this endpoint path to match your actual backend route
            const res = await fetch(`${BASE_URL}/api/rewards/logs?${params}`, { signal: controller.signal });
            const data = await res.json();

            if (data.success) {
                // Only keep logs that belong to the reward being viewed
                const onlyThisReward = rName
                    ? data.data.filter((l) => l.rewardName === rName)
                    : data.data;
                setLogs(onlyThisReward);
                setTotal(data.pagination?.total ?? onlyThisReward.length);
                setPage(pageArg);
            } else {
                setError("Failed to load reward history.");
            }
        } catch (err) {
            if (err.name !== "AbortError") setError("Network error. Could not load reward history.");
        } finally {
            if (abortRef.current === controller) setLoading(false);
        }
    }, [rName, fromDate, toDate]);

    // Clear the previous reward's rows when the modal closes
    useEffect(() => {
        if (isOpen) return;
        abortRef.current?.abort();
        setLogs([]);
        setTotal(0);
        setPage(1);
    }, [isOpen]);

    // Reset filters and load page 1 whenever the modal opens (or the reward changes)
    useEffect(() => {
        if (!isOpen) return;
        setLogs([]);
        setTotal(0);
        setFromDate("");
        setToDate("");
        fetchLogs(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, rName]);

    // Re-fetch page 1 whenever the date filter changes
    useEffect(() => {
        if (!isOpen) return;
        fetchLogs(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate]);

    // Cancel any pending request on unmount
    useEffect(() => () => abortRef.current?.abort(), []);

    if (!isOpen) return null;

    // Only pad the table to a fixed height once there's more than one
    // page — a single page of results just renders at its natural height.
    const totalPages = Math.max(1, Math.ceil(total / REWARD_LIMIT));
    const emptyRows = totalPages > 1 ? Math.max(0, REWARD_LIMIT - logs.length) : 0;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-h-[90vh] overflow-y-auto max-w-5xl rounded-2xl shadow-lg overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-6 py-4 border-b">
                    <div>
                        <h2 className="text-lg font-bold">Reward History</h2>
                        <p className="text-gray-500 text-sm">Showing redemption history for: <span className="font-medium">{rName}</span></p>
                    </div>
                    <button onClick={onClose}>
                        <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                    </button>
                </div>

                {/* FILTER */}
                <div className="w-full flex flex-col sm:flex-row gap-4 px-6 py-4 border-b">
                    <div className=" flex items-center gap-2 w-auto sm:w-full">
                        <Calendar size={16} />
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
                <div className="px-2">
                    <div className="overflow-x-auto">
                        {loading ? (
                            <p className="text-center py-6 text-gray-400">Loading reward history...</p>
                        ) : error ? (
                            <p className="text-center py-6 text-red-500">{error}</p>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-gray-100 sticky top-0">
                                    <tr>
                                        <th className="py-3">Date</th>
                                        <th>Reward Name</th>
                                        <th>Household ID</th>
                                        <th>Resident</th>
                                        <th className="px-4">Stock</th>
                                    </tr>
                                </thead>

                                <tbody className="text-center">
                                    {logs.length === 0 ? (
                                        <tr>
                                            <td colSpan="5" className="text-center py-6 text-gray-500">
                                                No records found for selected dates
                                            </td>
                                        </tr>
                                    ) : (
                                        logs.map((log) => (
                                            <tr key={log._id ?? log.id}>
                                                <td className="py-3 font-medium">
                                                    {new Date(log.date).toLocaleDateString("en-CA")}
                                                </td>
                                                <td>{log.rewardName}</td>
                                                <td>{log.householdId}</td>
                                                <td>{log.householdName}</td>
                                                <td className="text-red-500">{log.stockUpdate}</td>
                                            </tr>
                                        ))
                                    )}
                                    {/* Pad remaining slots so table height stays constant at
                                        REWARD_LIMIT rows, but only once there's more than one
                                        page — a single page just renders at its natural height. */}
                                    {logs.length > 0 &&
                                        Array.from({ length: emptyRows }).map((_, i) => (
                                            <tr key={`reward-empty-${i}`} aria-hidden="true">
                                                <td className="py-3" colSpan="5">&nbsp;</td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {!loading && !error && (
                        <Pagination
                            currentPage={page}
                            totalItems={total}
                            itemsPerPage={REWARD_LIMIT}
                            onPageChange={fetchLogs}
                        />
                    )}
                </div>

            </div>
        </div>
    );
}
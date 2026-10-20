import { X, Calendar, Search } from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import Pagination from "./Pagination";
import RedeemRewardModal from "./RedeemReward";
import BASE_URL from "../config";

const REWARD_LIMIT = 7;

export function ViewRewardModal({ isOpen, onClose, rName }) {
    const [fromDate, setFromDate] = useState("");
    const [toDate, setToDate] = useState("");
    // `searchInput` follows every keystroke; `search` is the debounced value
    // that actually triggers a fetch.
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    // Redeem flow: which log row the admin picked, and the ids already
    // redeemed this session (their button stays disabled).
    const [redeemTarget, setRedeemTarget] = useState(null);
    const [redeemedIds, setRedeemedIds] = useState(() => new Set());

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
                ...(search.trim() && { search: search.trim() }),
                ...(fromDate && { from: fromDate }),
                ...(toDate && { to: toDate }),
            });

            // NOTE: adjust this endpoint path to match your actual backend route
            const res = await fetch(`${BASE_URL}/api/rewards/logs?${params}`, { signal: controller.signal });
            const data = await res.json();

            if (data.success) {
                // Only keep logs that belong to the reward being viewed
                let onlyThisReward = rName
                    ? data.data.filter((l) => l.rewardName === rName)
                    : data.data;

                // Safety net: if the backend ignores `search`, still narrow
                // the page it returned by household name or ID. (Pagination
                // totals are only exact once the backend applies `search`.)
                const q = search.trim().toLowerCase();
                if (q) {
                    onlyThisReward = onlyThisReward.filter(
                        (l) =>
                            String(l.householdName ?? "").toLowerCase().includes(q) ||
                            String(l.householdId ?? "").toLowerCase().includes(q)
                    );
                }
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
    }, [rName, fromDate, toDate, search]);

    // Clear the previous reward's rows when the modal closes
    useEffect(() => {
        if (isOpen) return;
        abortRef.current?.abort();
        setLogs([]);
        setTotal(0);
        setPage(1);
        setRedeemTarget(null);
        setRedeemedIds(new Set());
    }, [isOpen]);

    // Reset filters and load page 1 whenever the modal opens (or the reward changes)
    useEffect(() => {
        if (!isOpen) return;
        setLogs([]);
        setTotal(0);
        setFromDate("");
        setToDate("");
        setSearchInput("");
        setSearch("");
        setRedeemTarget(null);
        setRedeemedIds(new Set());
        fetchLogs(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, rName]);

    // Debounce the search box so we don't fetch on every keystroke
    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput), 350);
        return () => clearTimeout(t);
    }, [searchInput]);

    // Re-fetch page 1 whenever the date filter or search changes
    useEffect(() => {
        if (!isOpen) return;
        fetchLogs(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fromDate, toDate, search]);

    // Cancel any pending request on unmount
    useEffect(() => () => abortRef.current?.abort(), []);

    // ── Called after a reward has been redeemed (receipt accepted) ───────────
    // Disable that row's button right away, then re-sync with the server
    // (stock, redeemed status) on the current page.
    const handleRedeemed = useCallback(async (record) => {
        const id = record._id ?? record.id;
        setRedeemedIds((prev) => new Set(prev).add(id));
        await fetchLogs(page);
    }, [fetchLogs, page]);

    if (!isOpen) return null;

    // Only pad the table to a fixed height once there's more than one
    // page — a single page of results just renders at its natural height.
    const totalPages = Math.max(1, Math.ceil(total / REWARD_LIMIT));
    const emptyRows = totalPages > 1 ? Math.max(0, REWARD_LIMIT - logs.length) : 0;

    return (
        <>
            <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                <div className="bg-white w-full max-h-[90vh] overflow-y-auto max-w-5xl rounded-2xl shadow-lg overflow-hidden">

                    {/* HEADER */}
                    <div className="flex justify-between items-center px-6 py-4 border-b">
                        <div>
                            <h2 className="text-lg font-bold">Reward History</h2>
                            <p className="text-gray-500 text-sm">Showing redemption history for: <span className="font-medium">{rName}</span></p>
                        </div>
                        <button onClick={onClose}>
                            <X className="text-gray-500 hover:text-red-400 cursor-pointer" />
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
                        <div className="flex items-center gap-2 w-auto sm:w-full">
                            <Search size={16} />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                placeholder="Search household name or ID"
                                className="border rounded-lg px-3 py-2 text-sm w-full"
                            />
                            {searchInput && (
                                <button
                                    onClick={() => {
                                        setSearchInput("");
                                        setSearch("");
                                    }}
                                    title="Clear search"
                                >
                                    <X size={16} className="text-gray-500 cursor-pointer hover:text-gray-800" />
                                </button>
                            )}
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
                                            <th>Action</th>
                                        </tr>
                                    </thead>

                                    <tbody className="text-center">
                                        {logs.length === 0 ? (
                                            <tr>
                                                <td colSpan="6" className="text-center py-6 text-gray-500">
                                                    No records found for selected dates
                                                </td>
                                            </tr>
                                        ) : (
                                            logs.map((log) => {
                                                const id = log._id ?? log.id;
                                                // Disabled once redeemed this session, or when the
                                                // backend already marks the record as redeemed
                                                // (`redeemed` flag or a stored `receiptNumber`).
                                                const alreadyRedeemed =
                                                    redeemedIds.has(id) || !!log.redeemed || !!log.receiptNumber;
                                                return (
                                                    <tr key={id}>
                                                        <td className="py-3 font-medium">
                                                            {new Date(log.date).toLocaleDateString("en-CA")}
                                                        </td>
                                                        <td>{log.rewardName}</td>
                                                        <td>{log.householdId}</td>
                                                        <td>{log.householdName}</td>
                                                        <td className="text-red-500">{log.stockUpdate}</td>
                                                        <td>
                                                            <button
                                                                onClick={() => setRedeemTarget(log)}
                                                                disabled={alreadyRedeemed}
                                                                title={alreadyRedeemed ? "Reward already redeemed" : "Redeem this reward"}
                                                                className="px-3 py-1 rounded-lg bg-green-600 text-white text-xs hover:bg-green-700 cursor-pointer disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
                                                            >
                                                                {alreadyRedeemed ? "Redeemed" : "Redeem"} reward
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                        {/* Pad remaining slots so table height stays constant at
                                            REWARD_LIMIT rows, but only once there's more than one
                                            page — a single page just renders at its natural height. */}
                                        {logs.length > 0 &&
                                            Array.from({ length: emptyRows }).map((_, i) => (
                                                <tr key={`reward-empty-${i}`} aria-hidden="true">
                                                    <td className="py-3" colSpan="6">&nbsp;</td>
                                                </tr>
                                            ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Only show pagination once the results exceed a single page */}
                        {!loading && !error && total > REWARD_LIMIT && (
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

            {/* Receipt number prompt for redeeming the chosen reward */}
            <RedeemRewardModal
                isOpen={!!redeemTarget}
                onClose={() => setRedeemTarget(null)}
                record={redeemTarget}
                onRedeemed={handleRedeemed}
            />
        </>
    );
}
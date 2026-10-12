import { useState, useEffect, useRef } from "react";
import Navbar from "../../components/Navbar";
import {
    Star,
    TrendingUp,
    Gift,
    BookCheck,
    Gavel,
    ClipboardCheck,
    Clipboard,
    Eye,
    Pencil,
    Award,
    Zap,
    MoreVertical,
    Trash2,
    X
} from "lucide-react";
import NavigationShell from "../../navigation/mainNav";
import Footer from "../../components/Footer";
import { Plus, Search } from "lucide-react";
import { ViewRewardModal } from "../../components/RewardModal";
import RewardFormModal from "../../components/AddRewardModal";
import RulesModal from "../../components/RulesModal";
import AwardModal from "../../components/AwardModal";
import ClaimReward from "../../components/ClaimReward";
import BASE_URL from "../../config";
import Pagination from "../../components/Pagination";
import useDebounce from "../../hooks/useDebounce";

import { getRewards, deleteReward } from "../../api/rewardAPI";
import { getRules, deleteRule } from "../../api/rulesAPI";

const REWARDS_PER_PAGE = 4;
const RULES_PER_PAGE = 4;
const LOGS_PER_PAGE = 10;

// Normalises an API response into { list, total } for the current page.
// Works whether the server paginates properly or just returns everything:
//  - if more than `limit` items come back, the server didn't paginate,
//    so we slice the requested page ourselves
//  - otherwise the server already gave us exactly this page
const paginateResponse = (res, page, limit) => {
    const all = Array.isArray(res) ? res : res?.data ?? [];
    if (all.length > limit) {
        return {
            list: all.slice((page - 1) * limit, page * limit),
            total: all.length,
        };
    }
    return {
        list: all,
        total: Array.isArray(res) ? all.length : res?.total ?? all.length,
    };
};

export default function Gamified() {
    const [activeTab, setActiveTab] = useState("rewards");
    const [openRulesModal, setOpenRulesModal] = useState(false);
    const [openAwardModal, setopenAwardModal] = useState(false);
    const [openClaimModal, setopenClaimModal] = useState(false);

    const [clickedReward, setClickReward] = useState(null);
    const [pointNeed, setPointNeed] = useState();
    const [clickedRule, setClickRule] = useState(null);

    // ---- Rewards come from the database (server-paginated) ----
    const [rewards, setRewards] = useState([]);
    const [rewardsTotal, setRewardsTotal] = useState(0);
    const [rewardsLoading, setRewardsLoading] = useState(true);
    const [rewardsError, setRewardsError] = useState("");

    // ---- Rules come from the database (server-paginated) ----
    const [rules, setRules] = useState([]);
    const [rulesTotal, setRulesTotal] = useState(0);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [rulesError, setRulesError] = useState("");
    const [editRuleData, setEditRuleData] = useState(null); // which rule is being edited

    const [rewardLogs, setRewardLogs] = useState([]);
    const [rewardLogsTotal, setRewardLogsTotal] = useState(0);
    const [rewardLogsLoading, setRewardLogsLoading] = useState(true);
    const [rewardLogsError, setRewardLogsError] = useState("");

    // Separate edit flags so the reward modal and the rule modal can't interfere
    const [rewardEditing, setRewardEditing] = useState(false);   // reward modal
    const [editRewardData, setEditRewardData] = useState(null);  // which reward is being edited
    const [openRewardFormModal, setOpenRewardFormModal] = useState(false);
    const [ruleEditing, setRuleEditing] = useState(false);       // rule modal
    const [openRewardModal, setOpenRewardModal] = useState(false);

    // ---- Three-dot menu + remove confirmation (shared by rewards & rules) ----
    const [openMenuId, setOpenMenuId] = useState(null);
    const [removeTarget, setRemoveTarget] = useState(null); // { type: "reward" | "rule", item }
    const [removing, setRemoving] = useState(false);
    const menuRef = useRef(null);

    const [search, setSearch] = useState("");
    const debouncedSearch = useDebounce(search, 400);

    // ── Pagination (server-side) ──
    const [rewardPage, setRewardPage] = useState(1);
    const [rulePage, setRulePage] = useState(1);
    const [logPage, setLogPage] = useState(1);

    const fetchRewards = async (signal) => {
        try {
            setRewardsLoading(true);
            setRewardsError("");
            const res = await getRewards(
                { search: debouncedSearch, page: rewardPage, limit: REWARDS_PER_PAGE },
                signal
            );

            const { list, total } = paginateResponse(res, rewardPage, REWARDS_PER_PAGE);
            setRewards(list);
            setRewardsTotal(total);
        } catch (err) {
            if (err.name === "AbortError") return;
            console.error(err);
            setRewards([]);
            setRewardsError("Failed to load rewards. Is the server running?");
        } finally {
            setRewardsLoading(false);
        }
    };

    const fetchRules = async (signal) => {
        try {
            setRulesLoading(true);
            setRulesError("");
            const res = await getRules(
                { search: debouncedSearch, page: rulePage, limit: RULES_PER_PAGE },
                signal
            );

            const { list, total } = paginateResponse(res, rulePage, RULES_PER_PAGE);
            setRules(list);
            setRulesTotal(total);
        } catch (err) {
            if (err.name === "AbortError") return;
            console.error(err);
            setRules([]);
            setRulesError("Failed to load rules. Is the server running?");
        } finally {
            setRulesLoading(false);
        }
    };

    const fetchRewardLogs = async (signal) => {
        try {
            setRewardLogsLoading(true);
            setRewardLogsError("");
            const params = new URLSearchParams({ page: logPage, limit: LOGS_PER_PAGE });
            const res = await fetch(`${BASE_URL}/api/rewards/logs?${params}`, { signal });
            const data = await res.json();
            if (data.success) {
                setRewardLogs(data.data);
                setRewardLogsTotal(data.total ?? data.data.length);
            } else {
                setRewardLogsError("Failed to load reward logs.");
            }
        } catch (err) {
            if (err.name === "AbortError") return;
            console.error(err);
            setRewardLogsError("Failed to load reward logs.");
        } finally {
            setRewardLogsLoading(false);
        }
    };

    // Rewards: refetch when its own search/page changes
    useEffect(() => {
        if (activeTab !== "rewards") return;
        const controller = new AbortController();
        fetchRewards(controller.signal);
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, debouncedSearch, rewardPage]);

    // Logs: separate effect so paging rewards doesn't reload the logs
    useEffect(() => {
        if (activeTab !== "rewards") return;
        const controller = new AbortController();
        fetchRewardLogs(controller.signal);
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, logPage]);

    useEffect(() => {
        if (activeTab !== "rules") return;
        const controller = new AbortController();
        fetchRules(controller.signal);
        return () => controller.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, debouncedSearch, rulePage]);

    // Reset to page 1 whenever the search term changes
    useEffect(() => {
        setRewardPage(1);
        setRulePage(1);
    }, [debouncedSearch]);

    // Step back if a page becomes invalid (e.g. after a delete)
    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(rewardsTotal / REWARDS_PER_PAGE));
        if (rewardPage > totalPages) setRewardPage(totalPages);
    }, [rewardsTotal, rewardPage]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(rulesTotal / RULES_PER_PAGE));
        if (rulePage > totalPages) setRulePage(totalPages);
    }, [rulesTotal, rulePage]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(rewardLogsTotal / LOGS_PER_PAGE));
        if (logPage > totalPages) setLogPage(totalPages);
    }, [rewardLogsTotal, logPage]);

    // Close the three-dot dropdown when clicking anywhere outside it
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Close any open dropdown when switching tabs
    useEffect(() => {
        setOpenMenuId(null);
    }, [activeTab]);

    // Remove a reward or a rule (whichever is in removeTarget)
    const handleConfirmRemove = async () => {
        if (!removeTarget) return;
        const { type, item } = removeTarget;

        try {
            setRemoving(true);

            if (type === "reward") {
                await deleteReward(item._id);
                setRemoveTarget(null);
                await fetchRewards();
            } else {
                await deleteRule(item._id);
                setRemoveTarget(null);
                await fetchRules();
            }
        } catch (err) {
            console.error(err);
            alert(err.message || `Failed to remove ${type}`);
        } finally {
            setRemoving(false);
        }
    };

    // Placeholder counts so each paginated section keeps a constant number
    // of slots (cards/rows) on screen, regardless of how many real items
    // land on the current page — but only once there's more than one page.
    const rewardTotalPages = Math.max(1, Math.ceil(rewardsTotal / REWARDS_PER_PAGE));
    const rewardEmptySlots = rewardTotalPages > 1
        ? Math.max(0, REWARDS_PER_PAGE - rewards.length)
        : 0;

    const ruleTotalPages = Math.max(1, Math.ceil(rulesTotal / RULES_PER_PAGE));
    const ruleEmptySlots = ruleTotalPages > 1
        ? Math.max(0, RULES_PER_PAGE - rules.length)
        : 0;

    const logTotalPages = Math.max(1, Math.ceil(rewardLogsTotal / LOGS_PER_PAGE));
    const logEmptyRows = logTotalPages > 1
        ? Math.max(0, LOGS_PER_PAGE - rewardLogs.length)
        : 0;

    return (
        <div className="flex-1">
            <Navbar />

            <div className="flex flex-col min-h-screen bg-gray-50 md:flex-row">
                <div className="flex gap-4">
                    {/* FOR MOBILE */}
                    <NavigationShell />
                    <div className="py-2 md:hidden">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
                            Reward and Rules Management
                        </h1>
                        <p className="text-gray-500 text-xs sm:text-lg ">
                            Process reward and pointing system
                        </p>
                    </div>
                </div>

                <main className="w-full p-4 sm:p-6 space-y-6">

                    <div className="hidden md:block">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
                            Reward and Rules Management
                        </h1>
                        <p className="text-gray-500 text-xs sm:text-lg ">
                            Process reward and pointing system
                        </p>
                    </div>

                    {/* Tabs */}
                    <div className="w-full flex overflow-x-auto bg-gray-100 rounded-full justify-center md:w-fit justify-evenly text-[#4A3B47] mb-6 p-1 space-x-2">
                        {[
                            { id: "rewards", label: "Reward", icon: <Star size={15} /> },
                            { id: "rules", label: "Rules", icon: <BookCheck size={15} /> },
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

                    {/* REWARDS TAB */}
                    {activeTab == "rewards" && (
                        <>
                            {/* Redeemable Items */}
                            <section className="bg-white rounded-xl p-6 shadow">

                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-6">
                                    <div>
                                        <h2 className="text-lg font-semibold flex items-center gap-2">
                                            <Gift className="text-green-600" />
                                            Redeemable Rewards
                                        </h2>
                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                            <input
                                                type="text"
                                                placeholder="Search reward"
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                                className="pl-10 pr-4 py-2 border border-gray-200 rounded-xl w-full sm:w-64 focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                                            />
                                        </div>

                                        <button
                                            title="Add new reward"
                                            onClick={() => {
                                                setRewardEditing(false);
                                                setEditRewardData(null);
                                                setOpenRewardFormModal(true);
                                            }}
                                            className="cursor-pointer inline-flex items-center justify-center gap-1.5 bg-green-600 text-white font-medium px-4 py-2 rounded-xl hover:bg-green-700 transition whitespace-nowrap"
                                        >
                                            <Plus size={18} />
                                            Add new reward
                                        </button>
                                    </div>
                                </div>

                                {rewardsLoading && (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-2">
                                        {Array.from({ length: REWARDS_PER_PAGE }).map((_, i) => (
                                            <div key={`reward-skel-${i}`} className="rounded-xl overflow-hidden shadow-sm animate-pulse">
                                                <div className="h-48 bg-gray-200" />
                                                <div className="p-4 space-y-2 bg-gray-50">
                                                    <div className="h-4 bg-gray-200 rounded w-2/3" />
                                                    <div className="h-3 bg-gray-200 rounded w-full" />
                                                    <div className="h-8 bg-gray-200 rounded mt-3" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {rewardsError && (
                                    <div className="mb-4 bg-red-50 border border-red-100 rounded-lg p-4 flex items-center justify-between">
                                        <p className="text-red-600 text-sm">{rewardsError}</p>
                                        <button
                                            onClick={() => fetchRewards()}
                                            className="text-sm font-medium text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 transition cursor-pointer"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}

                                {!rewardsLoading && (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {rewards.map((item, idx) => {
                                            const outOfStock = Number(item.stocks) <= 0;
                                            return (
                                                <div
                                                    key={item._id}
                                                    className="group relative bg-gray-50 rounded-xl overflow-hidden flex flex-col shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                                                >
                                                    <div className="relative">
                                                        <div className="overflow-hidden">
                                                            {item.image ? (
                                                                <img
                                                                    src={item.image}
                                                                    alt={item.name}
                                                                    className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-105"
                                                                />
                                                            ) : (
                                                                <div className="w-full h-48 bg-gradient-to-br from-green-50 to-gray-100 flex items-center justify-center">
                                                                    <Gift className="text-green-300" size={28} />
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Left column: points */}
                                                        <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5">
                                                            <span className="bg-white w-15 h-15 text-green-600 text-xs font-bold border px-2.5 py-1.5 rounded-full shadow flex flex-col items-center leading-tight">
                                                                <span className="font-bold text-lg">{item.points}</span>
                                                                <span className="text-[12px] text-gray-400 font-medium">pts</span>
                                                            </span>
                                                        </div>

                                                        {/* Three-dot menu - right */}
                                                        <div
                                                            className="absolute top-2 right-2 z-20 flex items-center gap-2"
                                                            ref={openMenuId === item._id ? menuRef : null}
                                                        >
                                                            <button
                                                                onClick={() =>
                                                                    setOpenMenuId(openMenuId === item._id ? null : item._id)
                                                                }
                                                                className="p-1.5 bg-white rounded-full shadow text-gray-600 hover:bg-gray-100 cursor-pointer transition"
                                                                aria-label="More options"
                                                            >
                                                                <MoreVertical size={16} />
                                                            </button>

                                                            {openMenuId === item._id && (
                                                                <div className="absolute right-0 top-6 mt-1 w-28 bg-white border border-gray-100 rounded-lg shadow-lg overflow-hidden">
                                                                    <button
                                                                        onClick={() => {
                                                                            setRemoveTarget({ type: "reward", item });
                                                                            setOpenMenuId(null);
                                                                        }}
                                                                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer transition"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                        Remove
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="p-4 flex flex-col flex-1 gap-1.5">
                                                        <div className="flex justify-between items-start gap-2">
                                                            <h3 className="font-semibold text-gray-900 leading-snug">
                                                                <span className="text-gray-400 font-medium">
                                                                    Reward {(rewardPage - 1) * REWARDS_PER_PAGE + idx + 1}
                                                                </span>{" "}
                                                                - {item.name}
                                                            </h3>
                                                        </div>

                                                        <span
                                                            className={`inline-flex w-fit items-center text-xs font-medium px-2 py-0.5 rounded-full ${outOfStock
                                                                ? "bg-red-50 text-red-600"
                                                                : "bg-gray-100 text-gray-500"
                                                                }`}
                                                        >
                                                            {outOfStock ? "Out of stock" : `${item.stocks} in stock`}
                                                        </span>

                                                        <div className="w-full flex items-center gap-2 mt-auto pt-4">
                                                            <button
                                                                onClick={() => {
                                                                    setOpenRewardModal(true);
                                                                    setClickReward(item.name);
                                                                }}
                                                                className="flex-1 cursor-pointer inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white border border-gray-200 rounded-lg py-2 text-sm font-medium"
                                                            >
                                                                <Eye size={15} />
                                                                View
                                                            </button>

                                                            <button
                                                                onClick={() => {
                                                                    setRewardEditing(true);
                                                                    setEditRewardData(item);
                                                                    setOpenRewardFormModal(true);
                                                                }}
                                                                className="flex-1 cursor-pointer inline-flex items-center justify-center gap-1.5 bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition"
                                                            >
                                                                <Pencil size={15} />
                                                                Edit
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {rewards.length === 0 && (
                                            <div className="col-span-full flex flex-col items-center justify-center py-12 text-gray-400">
                                                <Gift size={36} className="mb-3 text-gray-300" />
                                                <p className="font-medium text-gray-500">No rewards found</p>
                                                <p className="text-sm">Try a different search or add a new reward above.</p>
                                            </div>
                                        )}

                                        {rewards.length > 0 &&
                                            Array.from({ length: rewardEmptySlots }).map((_, i) => (
                                                <div
                                                    key={`reward-empty-${i}`}
                                                    aria-hidden="true"
                                                    className="invisible pointer-events-none rounded-xl overflow-hidden flex flex-col"
                                                >
                                                    <div className="w-full h-48" />
                                                    <div className="p-4 flex flex-col gap-1.5">
                                                        <h3 className="font-semibold">&nbsp;</h3>
                                                        <span className="inline-block">&nbsp;</span>
                                                        <div className="w-full flex items-center gap-2 mt-auto pt-4">
                                                            <div className="flex-1 py-2">&nbsp;</div>
                                                            <div className="flex-1 py-2">&nbsp;</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                )}

                                <Pagination
                                    currentPage={rewardPage}
                                    totalItems={rewardsTotal}
                                    itemsPerPage={REWARDS_PER_PAGE}
                                    onPageChange={setRewardPage}
                                />
                            </section>

                            {/* RECENT ACTIVITIES */}
                            <section className="bg-white rounded-xl p-6 shadow">
                                <h2 className="text-lg font-bold">Recent Reward Logs</h2>

                                <div className="max-h-[350px] overflow-y-auto overflow-x-auto mt-4">
                                    {rewardLogsLoading ? (
                                        <p className="text-center py-6 text-gray-400">Loading logs...</p>
                                    ) : rewardLogsError ? (
                                        <div className="text-center py-6">
                                            <p className="text-red-500 mb-1">{rewardLogsError}</p>
                                            <button
                                                onClick={() => fetchRewardLogs()}
                                                className="text-sm text-gray-600 underline cursor-pointer"
                                            >
                                                Retry
                                            </button>
                                        </div>
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
                                                {rewardLogs.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="5" className="text-center py-6 text-gray-500">
                                                            No reward logs yet.
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    rewardLogs.map((log) => (
                                                        <tr key={log._id} className="hover:bg-gray-50">
                                                            <td className="py-3 font-medium">
                                                                {new Date(log.date).toLocaleDateString("en-CA")}
                                                            </td>
                                                            <td>{log.rewardName}</td>
                                                            <td>{log.householdId}</td>
                                                            <td>{log.householdName}</td>
                                                            <td className="text-red-500 px-4">{log.stockUpdate}</td>
                                                        </tr>
                                                    ))
                                                )}
                                                {rewardLogs.length > 0 &&
                                                    Array.from({ length: logEmptyRows }).map((_, i) => (
                                                        <tr key={`log-empty-${i}`} aria-hidden="true">
                                                            <td className="py-3" colSpan="5">&nbsp;</td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    )}
                                </div>

                                <Pagination
                                    currentPage={logPage}
                                    totalItems={rewardLogsTotal}
                                    itemsPerPage={LOGS_PER_PAGE}
                                    onPageChange={setLogPage}
                                />
                            </section>
                        </>
                    )}

                    {/* RULES TAB */}
                    {activeTab == "rules" && (
                        <>
                            <section className="bg-white rounded-xl p-6 shadow">

                                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-6">
                                    <div>
                                        <h2 className="text-lg font-semibold flex items-center gap-2">
                                            <ClipboardCheck className="text-green-600" />
                                            How to Earn Points
                                        </h2>

                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                            <input
                                                type="text"
                                                placeholder="Search rule"
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                                className="pl-10 pr-4 py-2 border border-gray-200 rounded-xl w-full sm:w-64 focus:ring-2 focus:ring-green-500 focus:border-transparent transition"
                                            />
                                        </div>

                                        <button
                                            title="Add new rule"
                                            onClick={() => {
                                                setRuleEditing(false);
                                                setEditRuleData(null);
                                                setOpenRulesModal(true);
                                            }}
                                            className="cursor-pointer inline-flex items-center justify-center gap-1.5 bg-green-600 text-white font-medium px-4 py-2 rounded-xl hover:bg-green-700 transition whitespace-nowrap"
                                        >
                                            <Plus size={18} />
                                            Add new rule
                                        </button>
                                    </div>
                                </div>

                                {rulesLoading && (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-2">
                                        {Array.from({ length: RULES_PER_PAGE }).map((_, i) => (
                                            <div key={`rule-skel-${i}`} className="rounded-xl overflow-hidden shadow-sm animate-pulse">
                                                <div className="h-48 bg-gray-200" />
                                                <div className="p-4 space-y-2 bg-gray-50">
                                                    <div className="h-4 bg-gray-200 rounded w-2/3" />
                                                    <div className="h-3 bg-gray-200 rounded w-full" />
                                                    <div className="h-8 bg-gray-200 rounded mt-3" />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {rulesError && (
                                    <div className="mb-4 bg-red-50 border border-red-100 rounded-lg p-4 flex items-center justify-between">
                                        <p className="text-red-600 text-sm">{rulesError}</p>
                                        <button
                                            onClick={() => fetchRules()}
                                            className="text-sm font-medium text-red-600 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-100 transition cursor-pointer"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                )}

                                {!rulesLoading && (
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        {rules.map((r, idx) => (
                                            <div
                                                key={r._id}
                                                className="group relative bg-gray-50 rounded-xl overflow-hidden flex flex-col shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
                                            >
                                                <div className="relative">
                                                    <div className="overflow-hidden">
                                                        {r.image ? (
                                                            <img
                                                                src={r.image}
                                                                alt={r.name}
                                                                className="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-105"
                                                            />
                                                        ) : (
                                                            <div className="w-full h-48 bg-gradient-to-br from-green-50 to-gray-100 flex items-center justify-center">
                                                                <ClipboardCheck className="text-green-300" size={28} />
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Left column: points on top, auto-awarded below */}
                                                    <div className="absolute top-2 left-2 flex flex-col items-start gap-1.5">
                                                        <span className="bg-white w-15 h-15 text-green-600 text-xs font-bold border px-2.5 py-1.5 rounded-full shadow flex flex-col items-center leading-tight">
                                                            <span className="font-bold text-lg">+{r.points}</span>
                                                            <span className="text-[12px] text-gray-400 font-medium">pts</span>
                                                        </span>


                                                    </div>

                                                    {/* Three-dot menu - right */}
                                                    <div
                                                        className="absolute top-2 right-2 z-20 flex items-center gap-2"
                                                        ref={openMenuId === r._id ? menuRef : null}
                                                    >
                                                        {r.auto && (
                                                            <span className="bg-gray-900/80 text-white text-[11px] font-medium px-2 py-1 rounded-full flex items-center gap-1">
                                                                <Zap size={11} />
                                                                Auto-awarded
                                                            </span>
                                                        )}
                                                        <button
                                                            onClick={() =>
                                                                setOpenMenuId(openMenuId === r._id ? null : r._id)
                                                            }
                                                            className="p-1.5 bg-white rounded-full shadow text-gray-600 hover:bg-gray-100 cursor-pointer transition"
                                                            aria-label="More options"
                                                        >
                                                            <MoreVertical size={16} />
                                                        </button>

                                                        {openMenuId === r._id && (
                                                            <div className="absolute right-0 top-6 mt-1 w-28 bg-white border border-gray-100 rounded-lg shadow-lg overflow-hidden">
                                                                <button
                                                                    onClick={() => {
                                                                        setRemoveTarget({ type: "rule", item: r });
                                                                        setOpenMenuId(null);
                                                                    }}
                                                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer transition"
                                                                >
                                                                    <Trash2 size={14} />
                                                                    Remove
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="p-4 flex flex-col flex-1 gap-1.5">
                                                    <div className="flex justify-between items-start gap-2">
                                                        <h3 className="font-semibold text-gray-900 leading-snug">
                                                            <span className="text-gray-400 font-medium">
                                                                Rule {(rulePage - 1) * RULES_PER_PAGE + idx + 1}
                                                            </span>{" "}
                                                            - {r.name}
                                                        </h3>
                                                    </div>

                                                    <span className="inline-flex w-fit items-center text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                                                        {r.freq}
                                                    </span>

                                                    <p className="text-gray-500 text-sm mt-1">
                                                        {r.decs}
                                                    </p>

                                                    <div className="w-full flex items-center gap-2 mt-auto pt-4">
                                                        {!r.auto && (
                                                            <button
                                                                onClick={() => {
                                                                    setClickRule(r);
                                                                    setopenAwardModal(true);
                                                                }}
                                                                className="flex-1 cursor-pointer inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white border border-gray-200 rounded-lg py-2 text-sm font-medium"
                                                            >
                                                                <Award size={15} />
                                                                Award
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                setRuleEditing(true);
                                                                setEditRuleData(r);
                                                                setOpenRulesModal(true);
                                                            }}
                                                            className="flex-1 cursor-pointer inline-flex items-center justify-center gap-1.5 bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition"
                                                        >
                                                            <Pencil size={15} />
                                                            Edit
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}

                                        {rules.length === 0 && (
                                            <div className="col-span-full flex flex-col items-center justify-center py-12 text-gray-400">
                                                <ClipboardCheck size={36} className="mb-3 text-gray-300" />
                                                <p className="font-medium text-gray-500">No rules found</p>
                                                <p className="text-sm">Try a different search or add a new rule above.</p>
                                            </div>
                                        )}

                                        {rules.length > 0 &&
                                            Array.from({ length: ruleEmptySlots }).map((_, i) => (
                                                <div
                                                    key={`rule-empty-${i}`}
                                                    aria-hidden="true"
                                                    className="invisible pointer-events-none rounded-xl overflow-hidden flex flex-col"
                                                >
                                                    <div className="w-full h-48" />
                                                    <div className="p-4 flex flex-col gap-1.5">
                                                        <h3 className="font-semibold">&nbsp;</h3>
                                                        <span className="inline-block">&nbsp;</span>
                                                        <p>&nbsp;</p>
                                                        <div className="w-full flex items-center gap-2 mt-auto pt-4">
                                                            <div className="flex-1 py-2">&nbsp;</div>
                                                            <div className="flex-1 py-2">&nbsp;</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                    </div>
                                )}

                                <Pagination
                                    currentPage={rulePage}
                                    totalItems={rulesTotal}
                                    itemsPerPage={RULES_PER_PAGE}
                                    onPageChange={setRulePage}
                                />
                            </section>
                        </>
                    )}

                </main>

                <ClaimReward
                    isOpen={openClaimModal}
                    onClose={() => setopenClaimModal(false)}
                    rName={clickedReward}
                    rPoints={pointNeed}
                />

                <ViewRewardModal
                    isOpen={openRewardModal}
                    onClose={() => setOpenRewardModal(false)}
                    rName={clickedReward}
                />

                <RewardFormModal
                    isOpen={openRewardFormModal}
                    onClose={() => {
                        setOpenRewardFormModal(false);
                        setRewardEditing(false);
                        setEditRewardData(null);
                    }}
                    edit={rewardEditing}
                    rewardData={editRewardData}
                    onSaved={fetchRewards}
                />

                <RulesModal
                    isOpen={openRulesModal}
                    onClose={() => {
                        setOpenRulesModal(false);
                        setRuleEditing(false);
                        setEditRuleData(null);
                    }}
                    edit={ruleEditing}
                    ruleData={editRuleData}
                    onSaved={fetchRules}
                />

                <AwardModal
                    isOpen={openAwardModal}
                    onClose={() => { setopenAwardModal(false) }}
                    rule={clickedRule}
                />

                {/* Remove confirmation (rewards & rules) — same look as ConfirmationModal */}
                {removeTarget && (
                    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                        <div className="bg-white w-auto max-w-lg rounded-2xl shadow-lg overflow-hidden">

                            {/* HEADER */}
                            <div className="flex justify-between items-center px-6 py-4 border-b">
                                <h3 className="text-md">Confirmation Modal</h3>
                                <button
                                    onClick={() => setRemoveTarget(null)}
                                    disabled={removing}
                                >
                                    <X className="text-gray-500 cursor-pointer hover:text-gray-800" />
                                </button>
                            </div>

                            <main className="flex flex-col justify-center gap-5 p-5 items-center">

                                <h1 className="text-lg font-bold text-center">
                                    Are you sure to remove{" "}
                                    <span className="text-red-600">{removeTarget.item.name}</span>?
                                </h1>
                                <p className="text-sm text-gray-500 text-center -mt-3">
                                    This {removeTarget.type} will be permanently removed. This can't be undone.
                                </p>

                                <div className="flex gap-3 items-center">
                                    <button
                                        onClick={handleConfirmRemove}
                                        disabled={removing}
                                        className="bg-green-600 cursor-pointer text-white p-2 px-5 rounded-lg disabled:opacity-50">
                                        {removing ? "Removing..." : "Confirm"}
                                    </button>
                                    <button
                                        onClick={() => setRemoveTarget(null)}
                                        disabled={removing}
                                        className="bg-gray-600 cursor-pointer text-white p-2 px-5 rounded-lg disabled:opacity-50">
                                        Cancel
                                    </button>
                                </div>
                            </main>

                        </div>
                    </div>
                )}

            </div>
            <Footer />
        </div >
    );

}
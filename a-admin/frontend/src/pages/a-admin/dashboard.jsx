import {
    Users,
    Medal, Trophy, Star,
    Trash2,
    TrendingUp
} from "lucide-react";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
} from "recharts";
import { useNavigate } from "react-router-dom";
import BASE_URL from "../../config";

import { useState, useEffect } from "react";
import Navbar from "../../components/Navbar";
import NavigationShell from "../../navigation/mainNav";
import Footer from "../../components/Footer";

// ── Static data ───────────────────────────────────────────────────────────────

const medalStyles = {
    Gold: { ring: "border-yellow-400 text-yellow-500", podium: "bg-yellow-400" },
    Silver: { ring: "border-gray-300 text-gray-400", podium: "bg-gray-300" },
    Bronze: { ring: "border-orange-400 text-orange-500", podium: "bg-orange-400" },
};

const getTierByRank = (rank) => {
    if (rank === 1) return "Gold";
    if (rank === 2) return "Silver";
    if (rank === 3) return "Bronze";
    return null;
};

// Bar color depends on how full the bin is
const getFillColor = (fill) => {
    if (fill >= 80) return "bg-red-500";
    if (fill >= 50) return "bg-yellow-400";
    return "bg-green-500";
};

// How many bins the dashboard card shows. The rest are one click away in /binMonitoring.
// Change this number if you want the card to show more or fewer.
const MAX_VISIBLE_BINS = 5;

// ── Custom tooltip for the compliance bar chart ──────────────────────────────
// Shows "62% (31 out of 50)" instead of just "62%".
// It reads compliantCount / nonCompliantCount / total from each month's data.
const ComplianceTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;

    const row = payload[0].payload;
    const hasCounts = row.total !== undefined && row.total !== null;

    // One entry per row in the tooltip. Easy to add/remove later.
    const items = [
        {
            label: "Properly Segregating",
            percent: row.compliant,
            count: row.compliantCount,
            color: "#10b981",
            textColor: "text-green-600",
        },
        {
            label: "Need Improvement",
            percent: row.nonCompliant,
            count: row.nonCompliantCount,
            color: "#ef4444",
            textColor: "text-red-500",
        },
    ];

    return (
        <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 min-w-[240px]">
            {/* Header: month + total households */}
            <div className="flex items-center justify-between gap-6 pb-3 mb-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">{label}</p>
                
            </div>

            {/* Mini split bar: shows the green/red share at a glance */}
            <div className="flex h-2 w-full rounded-full overflow-hidden bg-gray-100 mb-4">
                <div style={{ width: `${row.compliant}%`, backgroundColor: "#10b981" }} />
                <div style={{ width: `${row.nonCompliant}%`, backgroundColor: "#ef4444" }} />
            </div>

            {/* Rows: dot + label on the left, count and percent on the right */}
            <div className="flex flex-col gap-3">
                {items.map((item) => (
                    <div key={item.label} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <span
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: item.color }}
                            />
                            <span className="text-sm text-gray-600">{item.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {hasCounts && (
                                <span className="text-sm text-gray-900">
                                    <span className="font-semibold">{item.count}</span>
                                    <span className="text-gray-400"> / {row.total}</span>
                                </span>
                            )}
                            <span className={`text-sm font-semibold ${item.textColor}`}>
                                {item.percent}%
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ComplianceDashboard() {
    const navigate = useNavigate();

    const [totalHouseholds, setTotalHouseholds] = useState(null);
    const [totalBins, setTotalBins] = useState(null);
    const [bins, setBins] = useState(null); // list of { id, fill }
    const [criticalBins, setCriticalBins] = useState(0);
    const [countError, setCountError] = useState(false);
    const [leaderboard, setLeaderboard] = useState([]);
    const [leaderboardLoading, setLeaderboardLoading] = useState(true);
    const [leaderboardError, setLeaderboardError] = useState(false);

    const [monthlyCompliance, setMonthlyCompliance] = useState([]);
    const [complianceLoading, setComplianceLoading] = useState(true);
    const [complianceError, setComplianceError] = useState(false);

    useEffect(() => {
        const fetchCounts = async () => {
            try {
                const [hhRes, binRes, binsListRes] = await Promise.all([
                    fetch(`${BASE_URL}/api/households/count`),
                    fetch(`${BASE_URL}/api/bins/count`),
                    fetch(`${BASE_URL}/api/bins`),
                ]);

                if (!hhRes.ok || !binRes.ok || !binsListRes.ok) throw new Error("Failed to fetch counts");

                const [hhData, binData, binsListData] = await Promise.all([
                    hhRes.json(),
                    binRes.json(),
                    binsListRes.json(),
                ]);

                setTotalHouseholds(hhData.count);
                setTotalBins(binData.count);

                // Keep each bin's own fill level (no more averaging)
                const list = (binsListData.data || []).map((b) => ({
                    // ⚠️ change these field names if your bin model uses different ones
                    id: String(b.binId ?? b.binCode ?? b.name ?? b._id),
                    // Clamp to 0–100 so a bad sensor reading (e.g. 120 or -5) can't break the UI
                    fill: Math.min(100, Math.max(0, Math.round(b.fill || 0))),
                }));

                // Fullest bins first so the urgent ones are on top.
                // If two bins have the same fill, sort by ID so the order doesn't jump around every 5 seconds.
                list.sort((a, b) => b.fill - a.fill || a.id.localeCompare(b.id));

                setBins(list);
                setCriticalBins(list.filter((b) => b.fill >= 80).length);

                setCountError(false);
            } catch (err) {
                console.error("Dashboard count fetch error:", err);
                setCountError(true);
            }
        };

        const fetchCompliance = async () => {
            try {
                const res = await fetch(`${BASE_URL}/api/analytics/compliance?months=6`);
                const data = await res.json();
                if (!data.success) throw new Error("Failed to fetch compliance trend");
                setMonthlyCompliance(data.data);
                setComplianceError(false);
            } catch (err) {
                console.error("Compliance fetch error:", err);
                setComplianceError(true);
            } finally {
                setComplianceLoading(false);
            }
        };

        // ── Leaderboard fetch ─────────────────────────────────────────────────
        const fetchLeaderboard = async () => {
            try {
                const res = await fetch(`${BASE_URL}/api/households?limit=10&isActive=true`);
                const data = await res.json();

                if (!data.success) throw new Error("Failed to fetch leaderboard");

                const ranked = [...(data.data ?? [])]
                    .sort((a, b) => (b.points?.total ?? 0) - (a.points?.total ?? 0))
                    .slice(0, 10)
                    .map((hh, index) => ({
                        family: hh.fullname,
                        address: [hh.address?.houseNo, hh.address?.street].filter(Boolean).join(", ") || "—",
                        householdId: `HH-${hh._id.slice(-8).toUpperCase()}`,
                        points: hh.points?.total ?? 0,
                        disposals: 0,
                        trend: "up",
                        rank: index + 1,
                        tier: getTierByRank(index + 1),
                    }));

                setLeaderboard(ranked);
                setLeaderboardError(false);
            } catch (err) {
                console.error("Leaderboard fetch error:", err);
                setLeaderboardError(true);
            } finally {
                setLeaderboardLoading(false);
            }
        };

        fetchCounts();
        fetchCompliance();
        fetchLeaderboard();

        const intervalId = setInterval(() => {
            fetchCounts();
            fetchCompliance();
            fetchLeaderboard();
        }, 5000);

        return () => clearInterval(intervalId);
    }, []);

    // ── Stats built inside component so they read live state ─────────────────
    // `path` = where the card goes when clicked
    const stats = [
        {
            title: "Total Households",
            value: totalHouseholds,
            icon: Users,
            iconBg: "bg-blue-100",
            iconColor: "text-blue-600",
            path: "/householdInfo",
        },
        {
            title: "Total Bins",
            value: totalBins,
            icon: Trash2,
            iconBg: "bg-blue-100",
            iconColor: "text-blue-600",
            path: "/wastebin",
        },
        {
            title: "Bin Fill Levels",
            icon: TrendingUp,
            iconBg: "bg-blue-100",
            iconColor: "text-blue-600",
            path: "/binMonitoring",
            isBinList: true, // this card shows the per-bin list instead of one number
        },
    ];

    // ── Leaderboard ───────────────────────────────────────────────────────────

    const podiumData = leaderboard.slice(0, 3);

    // ── Stat value renderer: skeleton → error → number ────────────────────────
    const StatValue = ({ value }) => {
        if (countError)
            return <span className="text-red-400 text-sm font-medium">Unavailable</span>;
        if (value === null)
            return <span className="h-8 w-16 bg-gray-200 animate-pulse rounded block" />;
        return <p className="text-2xl font-bold">{value}</p>;
    };

    // ── Bin list renderer: binID  [progress bar]  percent ─────────────────────
    const BinList = () => {
        if (countError)
            return <span className="text-red-400 text-sm font-medium">Unavailable</span>;
        if (bins === null)
            return <span className="h-8 w-full bg-gray-200 animate-pulse rounded block" />;
        if (bins.length === 0)
            return <p className="text-sm text-gray-400">No bins yet.</p>;

        // bins is already sorted fullest-first, so slice() gives the top N most urgent
        const visibleBins = bins.slice(0, MAX_VISIBLE_BINS);
        const hiddenCount = bins.length - visibleBins.length;

        return (
            <div className="flex flex-col gap-2">
                {visibleBins.map((bin) => (
                    <div key={bin.id} className="flex items-center gap-3">
                        <span className="w-20 text-xs font-medium text-gray-700 truncate" title={bin.id}>
                            {bin.id}
                        </span>
                        <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${getFillColor(bin.fill)}`}
                                style={{ width: `${Math.min(bin.fill, 100)}%` }}
                            />
                        </div>
                        <span
                            className={`w-10 text-right text-xs font-semibold ${
                                bin.fill >= 80 ? "text-red-500" : "text-gray-700"
                            }`}
                        >
                            {bin.fill}%
                        </span>
                    </div>
                ))}

                {/* Only shows when there are more bins than the card can display */}
                {hiddenCount > 0 && (
                    <p className="text-xs text-blue-600 font-medium mt-1">
                        +{hiddenCount} more {hiddenCount === 1 ? "bin" : "bins"} · View all
                    </p>
                )}
            </div>
        );
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen flex flex-col">
            <Navbar />

            <div className="flex flex-col min-h-screen bg-gray-50 md:flex-row">

                <div className="flex gap-4">
                    <NavigationShell />
                    <div className="py-2 md:hidden">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">Dashboard</h1>
                        <p className="text-gray-500 text-xs sm:text-lg">
                            Integrated smart waste management and compliance monitoring.
                        </p>
                    </div>
                </div>

                <main className="flex-1 w-full p-4 sm:p-6 space-y-6">

                    <div className="hidden md:block">
                        <h1 className="text-lg sm:text-3xl font-bold text-gray-900">Dashboard</h1>
                        <p className="text-gray-500 text-xs sm:text-lg">
                            Integrated smart waste management and compliance monitoring.
                        </p>
                    </div>

                    <section className="flex flex-col gap-5">

                        {/* Stat Cards (each one is clickable) */}
                        <div className="w-full flex flex-col lg:flex-row gap-4">
                            {stats.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div
                                        key={item.title}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => navigate(item.path)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") navigate(item.path);
                                        }}
                                        className="w-full bg-white rounded-xl shadow-sm p-5 flex justify-between items-center hover:shadow-xl cursor-pointer transition-shadow"
                                    >
                                        <div className="w-full flex flex-col gap-4">
                                            <div className="w-full flex justify-between">
                                                <div className={`p-3 rounded-lg ${item.iconBg}`}>
                                                    <Icon className={item.iconColor} />
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                {item.isBinList ? (
                                                    <BinList />
                                                ) : (
                                                    <StatValue value={item.value} />
                                                )}
                                                <p className="text-sm text-gray-500">{item.title}</p>
                                                {item.subtitle && (
                                                    <p className="text-xs text-gray-400">{item.subtitle}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Bar Chart */}
                        <div className="bg-white w-full rounded-xl shadow-sm p-6">
                            <h3 className="text-lg font-semibold mb-4">Monthly Compliance Trend</h3>
                            {complianceLoading ? (
                                <div className="h-84 flex items-center justify-center">
                                    <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
                                </div>
                            ) : complianceError ? (
                                <p className="text-center text-red-400 py-8">Unable to load compliance trend.</p>
                            ) : monthlyCompliance.length === 0 ? (
                                <p className="text-center text-gray-400 py-8">No disposal data yet.</p>
                            ) : (
                                <div className="h-84">
                                    <ResponsiveContainer width="100%" height={366}>
                                        <BarChart data={monthlyCompliance}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="month" />
                                            <YAxis />
                                            <Tooltip content={<ComplianceTooltip />} />
                                            <Bar dataKey="compliant" fill="#10b981" name="Properly Segregating %" radius={[6, 6, 0, 0]} />
                                            <Bar dataKey="nonCompliant" fill="#ef4444" name="Need Improvement %" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                    </section>

                    {/* Leaderboard */}
                    <section className="w-full bg-gradient-to-b from-green-50 to-white rounded-xl p-4 sm:p-6 shadow">

                        {leaderboardLoading ? (
                            <div className="flex justify-center py-12">
                                <div className="h-8 w-48 bg-gray-200 animate-pulse rounded" />
                            </div>
                        ) : leaderboardError ? (
                            <p className="text-center text-red-400 py-8">Failed to load leaderboard.</p>
                        ) : leaderboard.length === 0 ? (
                            <p className="text-center text-gray-400 py-8">No household data yet.</p>
                        ) : (
                            <>
                                {/* Mobile */}
                                <div className="flex flex-col gap-4 lg:hidden">
                                    <h3 className="text-lg font-semibold mb-4">Leaderboard</h3>
                                    {[1, 2, 3].map((pos) => {
                                        const item = podiumData.find((i) => i.rank === pos);
                                        if (!item) return null;
                                        return (
                                            <div key={item.rank} className="bg-white rounded-xl shadow p-4 flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center font-bold">
                                                    #{item.rank}
                                                </div>
                                                <div className="flex-1">
                                                    <h3 className="font-semibold">{item.family}</h3>
                                                    <p className="text-xs text-gray-400">{item.address}</p>
                                                    <p className="text-sm text-green-600 font-bold">{item.points} pts</p>
                                                </div>
                                                {item.rank === 1 && <Trophy className="text-yellow-500" />}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Desktop */}
                                <div className="hidden lg:flex w-full justify-center items-end gap-6 p-10">
                                    {[2, 1, 3].map((pos) => {
                                        const item = podiumData.find((i) => i.rank === pos);
                                        if (!item) return null;
                                        const style = medalStyles[item.tier];
                                        return (
                                            <div key={item.rank} className={`flex flex-col items-center ${item.rank === 1 ? "-mt-6" : ""}`}>
                                                <div className={`w-20 h-20 rounded-full border-4 flex items-center justify-center mb-3 ${style.ring}`}>
                                                    {item.rank === 1 ? <Trophy /> : <Medal />}
                                                </div>
                                                <div className="bg-white rounded-xl shadow px-6 py-4 text-center min-w-[180px]">
                                                    <p className="text-2xl font-bold">
                                                        {item.rank === 1 ? "1st" : item.rank === 2 ? "2nd" : "3rd"}
                                                    </p>
                                                    <h3 className="font-bold">{item.family}</h3>
                                                    <p className="text-green-600 font-bold mt-1">{item.points} pts</p>
                                                    <p className="text-xs text-gray-400">{item.address}</p>
                                                </div>
                                                <div
                                                    className={`w-full mt-4 rounded-t-xl ${style.podium}`}
                                                    style={{ height: item.rank === 1 ? "120px" : item.rank === 2 ? "90px" : "70px" }}
                                                />
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="mt-8 flex justify-center">
                                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow text-sm font-medium">
                                        <Star className="text-yellow-400" size={16} />
                                        Top performers this month!
                                    </div>
                                </div>
                            </>
                        )}
                    </section>

                </main>
            </div>
            <Footer />
        </div>
    );
}
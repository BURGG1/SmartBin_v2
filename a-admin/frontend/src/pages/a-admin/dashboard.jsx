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

// ── Component ─────────────────────────────────────────────────────────────────

export default function ComplianceDashboard() {

    const [totalHouseholds, setTotalHouseholds] = useState(null);
    const [totalBins, setTotalBins] = useState(null);
    const [avgFill, setAvgFill] = useState(null);
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

                const bins = binsListData.data || [];
                if (bins.length > 0) {
                    const totalFill = bins.reduce((sum, b) => sum + (b.fill || 0), 0);
                    setAvgFill(Math.round(totalFill / bins.length));
                    setCriticalBins(bins.filter((b) => (b.fill || 0) >= 80).length);
                } else {
                    setAvgFill(0);
                    setCriticalBins(0);
                }

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
        // ── Leaderboard fetch ─────────────────────────────────────────────────────
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
    const stats = [
        {
            title: "Total Households",
            value: totalHouseholds,
            icon: Users,
            iconBg: "bg-blue-100",
            iconColor: "text-blue-600",
            isLive: true,
        },
        {
            title: "Total Bins",
            value: totalBins,
            icon: Trash2,
            iconBg: "bg-blue-100",
            iconColor: "text-blue-600",
            isLive: true,
        },
        {
            title: "Average Bin Capacity",
            subtitle: avgFill !== null ? `${criticalBins} Critical` : undefined,
            value: avgFill !== null ? `${avgFill}%` : null,
            icon: TrendingUp,
            iconBg: "bg-blue-100",
            iconColor: "text-blue-600",
            isLive: true, // ← flip this to true now that it's real data
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

                        {/* Stat Cards */}
                        <div className="w-full flex flex-col lg:flex-row gap-4">
                            {stats.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div
                                        key={item.title}
                                        className="w-full bg-white rounded-xl shadow-sm p-5 flex justify-between items-center hover:shadow-xl"
                                    >
                                        <div className="w-full flex flex-col gap-4">
                                            <div className="w-full flex justify-between">
                                                <div className={`p-3 rounded-lg ${item.iconBg}`}>
                                                    <Icon className={item.iconColor} />
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                {/* Live cards get skeleton/error handling; static cards render directly */}
                                                {item.isLive ? (
                                                    <StatValue value={item.value} />
                                                ) : (
                                                    <p className="text-2xl font-bold">{item.value}</p>
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
                                            <Tooltip />
                                            <Bar dataKey="compliant" fill="#10b981" name="Properly Segregating %" radius={[6, 6, 0, 0]} />
                                            <Bar dataKey="nonCompliant" fill="#ef4444" name="Need Improvement %" radius={[6, 6, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                    </section>

                    {/* Leaderboard */}
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
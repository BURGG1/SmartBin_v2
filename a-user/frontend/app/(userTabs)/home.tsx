import { useState, useEffect, useCallback, useRef } from "react";
import {
    View, FlatList, Text, ScrollView, Image,
    TextInput, TouchableOpacity, Linking, ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getRules } from "../../api/rulesAPI";
import { useHousehold, fetchHousehold } from "../store/householdStore";
import { API_BASE } from "@/config";
import Pagination from "../../components/UserPagination";

// ── Types ─────────────────────────────────────────────────────────────────────
type Rule = {
    _id: string;
    name: string;
    description?: string;
    frequency?: string;
    points?: number;
    image?: string;
    [key: string]: any;
};

type DisposalLog = {
    _id: string;
    binId?: string | number;
    disposalOrder?: number;
    scannedAt: string;
    note?: string;
    household?: { fullname?: string };
    action?: string;
};

type ActivityLog = {
    _id: string;
    type: string;
    description?: string;
    amount?: string;
    points: number;
    date: string;
};

type ViolationLog = {
    _id: string;
    offenseNumber: number;
    penaltyType: string;
    pointsDeducted?: number;
    fineAmount?: number;
    communityService?: string;
    issuedBy?: string;
    createdAt: string;
};

type LogTab = "disposal" | "activity" | "violations";
type RuleItem = Rule & { __filler?: boolean };

// ── Constants ─────────────────────────────────────────────────────────────────
const RULES_PER_PAGE = 4;
const DISPOSAL_LIMIT = 5;
const ACTIVITY_LIMIT = 5;
const VIOLATION_LIMIT = 5;

const LOG_TABS: { id: LogTab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { id: "disposal", label: "Disposal", icon: "trash-2" },
    { id: "activity", label: "Activity", icon: "clipboard" },
    { id: "violations", label: "Violations", icon: "alert-triangle" },
];

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
    const household = useHousehold();

    const [householdLoading, setHouseholdLoading] = useState(!household);
    const [myRank, setMyRank] = useState<number | null>(null);
    const [search, setSearch] = useState("");
    const [activeLogTab, setActiveLogTab] = useState<LogTab>("disposal");

    // ── Rules ────────────────────────────────────────────────────────────────
    const [rules, setRules] = useState<Rule[]>([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [rulesError, setRulesError] = useState("");
    const [rulesPage, setRulesPage] = useState(1);

    // ── Disposal logs ────────────────────────────────────────────────────────
    const [disposalLogs, setDisposalLogs] = useState<DisposalLog[]>([]);
    const [disposalTotal, setDisposalTotal] = useState(0);
    const [disposalPage, setDisposalPage] = useState(1);
    const [disposalLoading, setDisposalLoading] = useState(false);
    const [disposalError, setDisposalError] = useState("");
    const disposalAbortRef = useRef<AbortController | null>(null);
    const disposalPageRef = useRef(1);

    // ── Activity logs ────────────────────────────────────────────────────────
    const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
    const [activityTotal, setActivityTotal] = useState(0);
    const [activityPage, setActivityPage] = useState(1);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState("");
    const activityAbortRef = useRef<AbortController | null>(null);
    const activityPageRef = useRef(1);

    // ── Violation logs ───────────────────────────────────────────────────────
    const [violationLogs, setViolationLogs] = useState<ViolationLog[]>([]);
    const [violationTotal, setViolationTotal] = useState(0);
    const [violationPage, setViolationPage] = useState(1);
    const [violationLoading, setViolationLoading] = useState(false);
    const [violationError, setViolationError] = useState("");
    const violationAbortRef = useRef<AbortController | null>(null);
    const violationPageRef = useRef(1);

    // ── Fetch household ──────────────────────────────────────────────────────
    const loadHouseholdData = useCallback(async () => {
        setHouseholdLoading(true);
        await fetchHousehold();
        setHouseholdLoading(false);
    }, []);

    // ── Fetch rules ──────────────────────────────────────────────────────────
    const fetchRules = useCallback(async () => {
        try {
            setRulesLoading(true);
            const data = await getRules();
            const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
            setRules(list);
            setRulesError("");
        } catch {
            setRules([]);
            setRulesError("Failed to load rules. Please try again later.");
        } finally {
            setRulesLoading(false);
        }
    }, []);

    // ── Fetch disposal logs ──────────────────────────────────────────────────
    const fetchDisposalLogs = useCallback(async (pageArg = 1) => {
        if (!household?.rfid) return;

        disposalAbortRef.current?.abort();
        const controller = new AbortController();
        disposalAbortRef.current = controller;

        setDisposalLoading(true);
        setDisposalError("");
        try {
            const params = new URLSearchParams({
                action: "dispose",
                page: String(pageArg),
                limit: String(DISPOSAL_LIMIT),
            });
            const res = await fetch(
                `${API_BASE}/api/rfid/logs/${household.rfid}?${params}`,
                { signal: controller.signal }
            );
            const data = await res.json();

            if (data.success) {
                const rows: DisposalLog[] = Array.isArray(data.data) ? data.data : [];
                // Defensive filter — backend should only return dispose, but guard anyway
                const filtered = rows.filter((l) => l.action === "dispose");
                const serverTotal = data.pagination?.total ?? filtered.length;

                // Safety net: if backend returns unpaginated data, slice client-side
                if (filtered.length > DISPOSAL_LIMIT) {
                    const start = (pageArg - 1) * DISPOSAL_LIMIT;
                    setDisposalLogs(filtered.slice(start, start + DISPOSAL_LIMIT));
                    setDisposalTotal(filtered.length);
                } else {
                    setDisposalLogs(filtered);
                    setDisposalTotal(serverTotal);
                }
                setDisposalPage(pageArg);
                disposalPageRef.current = pageArg;
            } else {
                setDisposalError("Failed to load disposal logs.");
            }
        } catch (err: any) {
            if (err?.name !== "AbortError") setDisposalError("Network error. Could not load logs.");
        } finally {
            if (disposalAbortRef.current === controller) setDisposalLoading(false);
        }
    }, [household?.rfid]);

    // ── Fetch activity logs ──────────────────────────────────────────────────
    const fetchActivityLogs = useCallback(async (pageArg = 1) => {
        if (!household?._id) return;

        activityAbortRef.current?.abort();
        const controller = new AbortController();
        activityAbortRef.current = controller;

        setActivityLoading(true);
        setActivityError("");
        try {
            const params = new URLSearchParams({
                page: String(pageArg),
                limit: String(ACTIVITY_LIMIT),
            });
            const res = await fetch(
                `${API_BASE}/api/households/${household._id}/activity?${params}`,
                { signal: controller.signal }
            );
            const data = await res.json();

            if (data.success) {
                setActivityLogs(Array.isArray(data.data) ? data.data : []);
                setActivityTotal(data.pagination?.total ?? 0);
                setActivityPage(pageArg);
                activityPageRef.current = pageArg;
            } else {
                setActivityError("Failed to load activity.");
                setActivityLogs([]);
            }
        } catch (err: any) {
            if (err?.name !== "AbortError") setActivityError("Network error. Could not load activity.");
        } finally {
            if (activityAbortRef.current === controller) setActivityLoading(false);
        }
    }, [household?._id]);

    // ── Fetch violation logs ─────────────────────────────────────────────────
    const fetchViolationLogs = useCallback(async (pageArg = 1) => {
        if (!household?._id) return;

        violationAbortRef.current?.abort();
        const controller = new AbortController();
        violationAbortRef.current = controller;

        setViolationLoading(true);
        setViolationError("");
        try {
            const token = await AsyncStorage.getItem("token");
            const params = new URLSearchParams({
                page: String(pageArg),
                limit: String(VIOLATION_LIMIT),
            });
            const res = await fetch(
                `${API_BASE}/api/households/${household._id}/violations?${params}`,
                {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    signal: controller.signal,
                }
            );
            const data = await res.json();

            if (data.success) {
                setViolationLogs(Array.isArray(data.data) ? data.data : []);
                setViolationTotal(data.pagination?.total ?? 0);
                setViolationPage(pageArg);
                violationPageRef.current = pageArg;
            } else {
                setViolationError("Failed to load violations.");
                setViolationLogs([]);
            }
        } catch (err: any) {
            if (err?.name !== "AbortError") setViolationError("Network error.");
        } finally {
            if (violationAbortRef.current === controller) setViolationLoading(false);
        }
    }, [household?._id]);

    // ── Fetch leaderboard rank ───────────────────────────────────────────────
    useEffect(() => {
        if (!household?._id) return;
        const fetchRank = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/households/leaderboard?limit=200`);
                const data = await res.json();
                if (data.success && Array.isArray(data.data)) {
                    const me = data.data.find((h: any) => h._id === household._id);
                    if (me) setMyRank(me.rank);
                }
            } catch (err) {
                console.error("Failed to fetch rank:", err);
            }
        };
        fetchRank();
    }, [household?._id, household?.points?.total]);

    // ── Initial load ─────────────────────────────────────────────────────────
    useEffect(() => {
        loadHouseholdData();
        fetchRules();
    }, []);

    // Load all logs once household is available
    useEffect(() => {
        if (!household?._id) return;
        fetchDisposalLogs(1);
        fetchActivityLogs(1);
        fetchViolationLogs(1);
        setActiveLogTab("disposal");
    }, [household?._id]);

    // Refresh when tab regains focus — uses refs to stay on correct page
    useFocusEffect(
        useCallback(() => {
            try {
                loadHouseholdData();
                if (!household?._id) return;
                fetchDisposalLogs(disposalPageRef.current);
                fetchActivityLogs(activityPageRef.current);
                fetchViolationLogs(violationPageRef.current);
            } catch (err) {
                // Navigation context not ready yet — safe to ignore
            }
        }, [
            household?._id,
            fetchDisposalLogs,
            fetchActivityLogs,
            fetchViolationLogs,
            loadHouseholdData,
        ])
    );

    // Cancel pending requests on unmount
    useEffect(() => () => {
        disposalAbortRef.current?.abort();
        activityAbortRef.current?.abort();
        violationAbortRef.current?.abort();
    }, []);

    // ── Rules helpers ────────────────────────────────────────────────────────
    const filteredRules = rules.filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase())
    );

    useEffect(() => { setRulesPage(1); }, [search]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(filteredRules.length / RULES_PER_PAGE));
        if (rulesPage > totalPages) setRulesPage(totalPages);
    }, [filteredRules.length]);

    const paginatedRules = filteredRules.slice(
        (rulesPage - 1) * RULES_PER_PAGE,
        rulesPage * RULES_PER_PAGE
    );

    const rulesFillerCount = Math.max(0, RULES_PER_PAGE - paginatedRules.length);
    const rulesForDisplay: RuleItem[] = [
        ...paginatedRules,
        ...Array.from({ length: rulesFillerCount }, (_, i) => ({
            _id: `__filler-${i}`, name: "", __filler: true,
        })),
    ];

    // ── Log tab handler ──────────────────────────────────────────────────────
    const handleTabChange = useCallback((tab: LogTab) => {
        setActiveLogTab(tab);
        // Only fetch if switching to a tab that hasn't loaded yet
        if (tab === "disposal") fetchDisposalLogs(1);
        if (tab === "activity") fetchActivityLogs(1);
        if (tab === "violations") fetchViolationLogs(1);
    }, [fetchDisposalLogs, fetchActivityLogs, fetchViolationLogs]);

    // ── Loading screen ───────────────────────────────────────────────────────
    if (householdLoading) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="#16A34A" />
            </SafeAreaView>
        );
    }

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <SafeAreaView className="flex-1">
            <ScrollView className="flex-1 px-4 py-2">

                {/* PAGE TITLE */}
                <View>
                    <Text className="text-3xl font-bold">Home</Text>
                    <Text className="text-gray-500 mb-6">
                        Keep up the great work with waste segregation
                    </Text>
                </View>

                {/* HERO CARD */}
                <View className="bg-green-600 rounded-xl shadow p-6 gap-4">
                    <Text className="text-white">Welcome back,</Text>
                    <Text className="text-4xl text-white font-bold">{household?.fullname ?? "—"}!</Text>
                    <View className="flex-row items-center gap-2">
                        <Feather name="award" size={20} color="white" />
                        <Text className="font-semibold text-white">Total Points Earned</Text>
                    </View>
                    <View className="flex-row justify-between items-center">
                        <View>
                            <Text className="text-4xl font-bold text-white">
                                {household?.points?.total ?? 0}
                            </Text>
                            <Text className="text-green-100">points</Text>
                        </View>
                        <View className="bg-green-700 p-2 rounded-xl border border-green-800 items-center justify-center">
                            <Text className="text-2xl font-bold text-white">#{myRank ?? "—"}</Text>
                            <Text className="text-white text-center">Current rank</Text>
                        </View>
                    </View>
                    <View className="flex-row justify-between">
                        <Text className="text-white">This Month</Text>
                        <Text className="font-semibold text-white">
                            +{household?.points?.thisMonth ?? 0} points
                        </Text>
                    </View>
                </View>

                {/* HOW TO EARN POINTS */}
                <View className="bg-white rounded-xl p-6 shadow mt-10">
                    <View className="flex-col items-center mb-4 gap-2">
                        <View className="flex-row items-center gap-2">
                            <Feather name="clipboard" size={18} color="#16A34A" />
                            <Text className="text-lg font-semibold">How to Earn Points</Text>
                        </View>
                        <View className="flex-row items-center border rounded-lg px-3 w-64">
                            <Feather name="search" size={16} color="gray" />
                            <TextInput
                                className="flex-1 py-2 pl-2"
                                placeholder="Search rule"
                                value={search}
                                onChangeText={setSearch}
                            />
                        </View>
                    </View>

                    {rulesLoading && (
                        <View className="items-center py-6">
                            <ActivityIndicator color="#16A34A" />
                            <Text className="text-gray-500 mt-2">Loading rules...</Text>
                        </View>
                    )}
                    {!!rulesError && <Text className="text-red-500 mb-2">{rulesError}</Text>}

                    <FlatList
                        data={rulesForDisplay}
                        keyExtractor={(item) => item._id}
                        numColumns={2}
                        scrollEnabled={false}
                        columnWrapperStyle={{ gap: 10 }}
                        contentContainerStyle={{ gap: 10 }}
                        ListEmptyComponent={
                            !rulesLoading && !rulesError ? (
                                <Text className="text-gray-500 text-center py-6 w-full">
                                    No rules found.
                                </Text>
                            ) : null
                        }
                        renderItem={({ item: r, index }) =>
                            r.__filler ? (
                                <View className="flex-1 h-56" style={{ opacity: 0 }} />
                            ) : (
                                <View className="flex-1 bg-gray-50 rounded-xl shadow-lg overflow-hidden">
                                    {r.image ? (
                                        <Image
                                            source={{ uri: r.image }}
                                            className="w-full h-40"
                                            resizeMode="cover"
                                        />
                                    ) : (
                                        <View className="w-full h-40 bg-gray-200 items-center justify-center">
                                            <Text className="text-gray-400">No image</Text>
                                        </View>
                                    )}
                                    <View className="p-3 gap-1">
                                        <Text className="text-sm font-bold">
                                            Rule {(rulesPage - 1) * RULES_PER_PAGE + index + 1}
                                        </Text>
                                        <Text className="text-xs text-gray-500">{r.name}</Text>
                                        <Text className="text-xs text-gray-400">{r.description}</Text>
                                        <Text className="text-xs text-gray-400">{r.frequency}</Text>
                                    </View>
                                    <View className="absolute top-2 right-2 bg-white rounded-lg p-1 shadow-md">
                                        <Text className="text-green-500 font-bold text-sm">+{r.points}</Text>
                                    </View>
                                </View>
                            )
                        }
                    />

                    {!rulesLoading && !rulesError && (
                        <Pagination
                            currentPage={rulesPage}
                            totalItems={filteredRules.length}
                            itemsPerPage={RULES_PER_PAGE}
                            onPageChange={setRulesPage}
                        />
                    )}
                </View>

                {/* RA 9003 */}
                <View className="bg-white rounded-xl p-6 shadow mt-10">
                    <View className="flex-col gap-4 mt-5">
                        <View>
                            <Text className="text-xl font-bold text-gray-800">
                                Republic Act No. 9003
                            </Text>
                            <Text className="text-green-700 text-sm">
                                Ecological Solid Waste Management Act of 2000
                            </Text>
                        </View>
                        <View className="bg-green-100 px-3 py-1 rounded-full self-start">
                            <Text className="text-green-700 text-xs font-medium">Philippine Law</Text>
                        </View>
                    </View>
                    <View className="bg-green-100/60 border border-green-200 rounded-xl p-4 mt-5">
                        <Text className="text-sm text-gray-700 text-justify">
                            The Ecological Solid Waste Management Act of 2000, officially known as
                            Republic Act No. 9003, is a Philippine environmental law enacted to
                            establish a comprehensive and sustainable system for managing solid waste
                            nationwide.{" "}
                            <Text className="font-semibold">
                                It promotes waste reduction, mandatory segregation at source,
                                recycling, composting, and the closure of open dumpsites, while
                                requiring local government units to take primary responsibility for
                                implementation under the supervision of the Department of Environment
                                and Natural Resources.
                            </Text>{" "}
                            The law aims to protect public health and the environment by shifting the
                            country from improper disposal practices to an ecological and
                            community-based waste management approach.
                        </Text>
                    </View>
                    <TouchableOpacity
                        onPress={() =>
                            Linking.openURL(
                                "https://www.officialgazette.gov.ph/2001/01/26/republic-act-no-9003/"
                            )
                        }
                        className="flex-row items-center gap-2 mt-3"
                    >
                        <Text className="text-green-600 font-medium">See full text of RA 9003</Text>
                    </TouchableOpacity>
                </View>

                {/* RECENT ACTIVITY */}
                <View className="bg-white rounded-xl p-6 shadow mt-5 mb-5">
                    <Text className="text-lg font-semibold mb-4">Recent Activity</Text>

                    {/* Tab switcher */}
                    <View style={{ flexDirection: "row", backgroundColor: "#F3F4F6", borderRadius: 12, padding: 4, marginBottom: 16 }}>
                        {LOG_TABS.map((tab) => (
                            <TouchableOpacity
                                key={tab.id}
                                onPress={() => handleTabChange(tab.id)}
                                style={{
                                    flex: 1,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 4,
                                    paddingVertical: 8,
                                    borderRadius: 8,
                                    backgroundColor: activeLogTab === tab.id ? "#FFFFFF" : "transparent",
                                    shadowColor: activeLogTab === tab.id ? "#000" : "transparent",
                                    shadowOpacity: activeLogTab === tab.id ? 0.1 : 0,
                                    shadowRadius: 2,
                                    elevation: activeLogTab === tab.id ? 2 : 0,
                                }}
                            >
                                <Feather
                                    name={tab.icon}
                                    size={14}
                                    color={activeLogTab === tab.id ? "#15803D" : "#6B7280"}
                                />
                                <Text style={{
                                    fontSize: 12,
                                    fontWeight: "500",
                                    color: activeLogTab === tab.id ? "#15803D" : "#6B7280",
                                }}>
                                    {tab.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* DISPOSAL TAB */}
                    {activeLogTab === "disposal" && (
                        <>
                            {disposalLoading && (
                                <View className="items-center py-6">
                                    <ActivityIndicator color="#16A34A" />
                                </View>
                            )}
                            {!!disposalError && (
                                <Text className="text-red-500 text-center py-4">{disposalError}</Text>
                            )}
                            {!disposalLoading && !disposalError && disposalLogs.length === 0 && (
                                <Text className="text-gray-500 text-center py-6">
                                    No disposal records yet.
                                </Text>
                            )}
                            {!disposalLoading && !disposalError && disposalLogs.map((log) => {
                                const scannedAt = new Date(log.scannedAt);
                                const binTypeMatch = log.note?.match(/\((.+)\)/);
                                const binType = binTypeMatch ? binTypeMatch[1] : "—";
                                return (
                                    <View key={log._id} className="flex-row justify-between items-center py-2 border-b border-gray-100">
                                        <View className="flex-1">
                                            <Text className="font-medium">
                                                Bin #{log.binId ?? "—"} · {binType}
                                            </Text>
                                            <Text className="text-xs text-gray-500">
                                                {scannedAt.toLocaleDateString("en-CA")} ·{" "}
                                                {scannedAt.toLocaleTimeString([], {
                                                    hour: "2-digit", minute: "2-digit",
                                                })}
                                            </Text>
                                        </View>
                                        <Text className="text-xs text-gray-400 ml-2">
                                            #{log.disposalOrder ?? "—"}
                                        </Text>
                                    </View>
                                );
                            })}
                            {!disposalLoading && !disposalError && disposalLogs.length > 0 && (
                                <Pagination
                                    currentPage={disposalPage}
                                    totalItems={disposalTotal}
                                    itemsPerPage={DISPOSAL_LIMIT}
                                    onPageChange={fetchDisposalLogs}
                                />
                            )}
                        </>
                    )}

                    {/* ACTIVITY TAB */}
                    {activeLogTab === "activity" && (
                        <>
                            {activityLoading && (
                                <View className="items-center py-6">
                                    <ActivityIndicator color="#16A34A" />
                                </View>
                            )}
                            {!!activityError && (
                                <Text className="text-red-500 text-center py-4">{activityError}</Text>
                            )}
                            {!activityLoading && !activityError && activityLogs.length === 0 && (
                                <Text className="text-gray-500 text-center py-6">No activity yet.</Text>
                            )}
                            {!activityLoading && !activityError && activityLogs.map((a) => (
                                <View key={a._id} className="flex-row justify-between items-center py-2 border-b border-gray-100">
                                    <View className="flex-1">
                                        <Text className="font-medium">{a.type}</Text>
                                        <Text className="text-xs text-gray-500">
                                            {a.description}{a.amount ? ` · ${a.amount}` : ""}
                                        </Text>
                                        <Text className="text-xs text-gray-400">
                                            {new Date(a.date).toLocaleDateString("en-CA")}
                                        </Text>
                                    </View>
                                    <Text className={`font-semibold ml-2 ${a.points > 0 ? "text-green-600" : "text-red-500"
                                        }`}>
                                        {a.points > 0 ? `+${a.points}` : a.points}
                                    </Text>
                                </View>
                            ))}
                            {!activityLoading && !activityError && activityLogs.length > 0 && (
                                <Pagination
                                    currentPage={activityPage}
                                    totalItems={activityTotal}
                                    itemsPerPage={ACTIVITY_LIMIT}
                                    onPageChange={fetchActivityLogs}
                                />
                            )}
                        </>
                    )}

                    {/* VIOLATIONS TAB */}
                    {activeLogTab === "violations" && (
                        <>
                            {violationLoading && (
                                <View className="items-center py-6">
                                    <ActivityIndicator color="#16A34A" />
                                </View>
                            )}
                            {!!violationError && (
                                <Text className="text-red-500 text-center py-4">{violationError}</Text>
                            )}
                            {!violationLoading && !violationError && violationLogs.length === 0 && (
                                <Text className="text-gray-500 text-center py-6">
                                    No violations on record.
                                </Text>
                            )}
                            {!violationLoading && !violationError && violationLogs.map((v) => (
                                <View key={v._id} className="flex-row justify-between items-center py-2 border-b border-gray-100">
                                    <View className="flex-1">
                                        <Text className="font-medium text-red-600">
                                            Offense #{v.offenseNumber} · {v.penaltyType}
                                        </Text>
                                        <Text className="text-xs text-gray-500">
                                            {new Date(v.createdAt).toLocaleDateString("en-CA")}
                                            {v.fineAmount ? ` · ₱${v.fineAmount}` : ""}
                                            {v.communityService ? ` · ${v.communityService}` : ""}
                                        </Text>
                                        {v.issuedBy && (
                                            <Text className="text-xs text-gray-400">
                                                Issued by: {v.issuedBy}
                                            </Text>
                                        )}
                                    </View>
                                    <Text className="font-semibold text-red-500 ml-2">
                                        {v.pointsDeducted ? `-${v.pointsDeducted}` : "—"}
                                    </Text>
                                </View>
                            ))}
                            {!violationLoading && !violationError && violationLogs.length > 0 && (
                                <Pagination
                                    currentPage={violationPage}
                                    totalItems={violationTotal}
                                    itemsPerPage={VIOLATION_LIMIT}
                                    onPageChange={fetchViolationLogs}
                                />
                            )}
                        </>
                    )}
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
    View, Text, ScrollView,
    TextInput, TouchableOpacity, Linking, ActivityIndicator, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getRules } from "../../api/rulesAPI";
import { useHousehold, fetchHousehold } from "../store/householdStore";
import { API_BASE } from "@/config";
import Pagination from "../../components/UserPagination";
import RuleDetails, { Rule, RuleCard, matchesRuleSearch } from "../../components/RuleDetails";

// ── Types ─────────────────────────────────────────────────────────────────────
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
    cleared?: boolean;
};

type LogTab = "disposal" | "activity" | "violations";

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
    const [refreshing, setRefreshing] = useState(false);
    const [myRank, setMyRank] = useState<number | null>(null);
    const [search, setSearch] = useState("");
    const [activeLogTab, setActiveLogTab] = useState<LogTab>("disposal");

    // ── Rules ────────────────────────────────────────────────────────────────
    const [rules, setRules] = useState<Rule[]>([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [rulesError, setRulesError] = useState("");
    const [rulesPage, setRulesPage] = useState(1);
    const [selected, setSelected] = useState<{ rule: Rule; number: number } | null>(null);

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
                includeCleared: "true", // settled violations stay visible here, shown as "Settled"
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
    // Rule numbers come from the full list so they stay stable while searching
    const numberedRules = useMemo(
        () => rules.map((rule, i) => ({ rule, number: i + 1 })),
        [rules]
    );

    const filteredRules = useMemo(
        () => numberedRules.filter(({ rule, number }) => matchesRuleSearch(rule, number, search)),
        [numberedRules, search]
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

    // ── Log tab handler ──────────────────────────────────────────────────────
    const handleTabChange = useCallback((tab: LogTab) => {
        setActiveLogTab(tab);
        if (tab === "disposal") fetchDisposalLogs(1);
        if (tab === "activity") fetchActivityLogs(1);
        if (tab === "violations") fetchViolationLogs(1);
    }, [fetchDisposalLogs, fetchActivityLogs, fetchViolationLogs]);

    // ── Pull-to-refresh ──────────────────────────────────────────────────────
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await Promise.all([
                fetchHousehold(),
                fetchRules(),
                fetchDisposalLogs(disposalPageRef.current),
                fetchActivityLogs(activityPageRef.current),
                fetchViolationLogs(violationPageRef.current),
            ]);
        } finally {
            setRefreshing(false);
        }
    }, [fetchRules, fetchDisposalLogs, fetchActivityLogs, fetchViolationLogs]);

    // ── Loading screen ───────────────────────────────────────────────────────
    if (householdLoading) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center bg-gray-50">
                <ActivityIndicator size="large" color="#16A34A" />
            </SafeAreaView>
        );
    }

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <SafeAreaView className="flex-1 bg-gray-50">
            <ScrollView
                className="flex-1 px-4 py-2"
                contentContainerStyle={{ paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={handleRefresh}
                        colors={["#16A34A"]}
                        tintColor="#16A34A"
                    />
                }
            >

                {/* PAGE TITLE */}
                <View className="mb-6">
                    <Text className="text-3xl font-extrabold text-gray-900 tracking-tight">Home</Text>
                    <Text className="text-base text-gray-600 mt-1 leading-6">
                        Keep up the great work with waste segregation
                    </Text>
                </View>

                {/* HERO CARD */}
                <View className="bg-green-600 rounded-2xl shadow-lg p-6 gap-5">
                    <View className="flex-row items-center justify-between">
                        <View className="flex-1 gap-1 pr-3">
                            <Text className="text-green-50 text-base font-medium">Welcome,</Text>
                            <Text className="text-3xl text-white font-extrabold leading-9" numberOfLines={2}>
                                {household?.fullname ?? "—"}!
                            </Text>
                        </View>
                        <View className="bg-green-700 px-4 py-3 rounded-2xl border border-green-500 items-center justify-center">
                            <Text className="text-2xl font-extrabold text-white">#{myRank ?? "—"}</Text>
                            <Text className="text-green-50 text-xs font-medium text-center mt-0.5">Current rank</Text>
                        </View>
                    </View>

                    <View>
                        <View className="flex-row items-center gap-2 mb-1">
                            <Feather name="award" size={18} color="white" />
                            <Text className="font-semibold text-green-50 text-base">Current Points Earned</Text>
                        </View>
                        <Text className="text-5xl font-extrabold text-white">
                            {household?.points?.total ?? 0}
                            <Text className="text-green-100 text-xl font-medium"> points</Text>
                        </Text>
                    </View>

                    {/* <View className="flex-row justify-between items-center border-t border-white/30 pt-3">
                        <Text className="text-green-50 text-base">Total Points Earned</Text>
                        <Text className="font-bold text-white text-base">
                            {household?.points?.thisMonth ?? 0} points
                        </Text>
                    </View> */}
                </View>

                {/* HOW TO EARN POINTS */}
                <View className="bg-white rounded-2xl p-5 shadow mt-8 border border-gray-100">
                    <View className="flex-col items-center mb-4 gap-3">
                        <View className="flex-row items-center gap-2">
                            <Feather name="clipboard" size={20} color="#16A34A" />
                            <Text className="text-xl font-bold text-gray-900">How to Earn Points</Text>
                        </View>
                        <View className="flex-row items-center border border-gray-300 bg-gray-50 rounded-xl px-3 w-full">
                            <Feather name="search" size={18} color="#6B7280" />
                            <TextInput
                                className="flex-1 py-3 pl-2 text-base text-gray-900"
                                placeholder="Search name, activity no., or points"
                                placeholderTextColor="#9CA3AF"
                                value={search}
                                onChangeText={setSearch}
                                returnKeyType="search"
                                autoCorrect={false}
                            />
                            {!!search && (
                                <TouchableOpacity
                                    onPress={() => setSearch("")}
                                    accessibilityLabel="Clear search"
                                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                    <Feather name="x-circle" size={18} color="#9CA3AF" />
                                </TouchableOpacity>
                            )}
                        </View>
                        {!!search.trim() && !rulesLoading && (
                            <Text className="text-sm text-gray-500 self-start">
                                {filteredRules.length} {filteredRules.length === 1 ? "rule" : "rules"} found
                            </Text>
                        )}
                    </View>

                    {rulesLoading && (
                        <View className="items-center py-6">
                            <ActivityIndicator color="#16A34A" />
                            <Text className="text-gray-600 mt-2 text-base">Loading rules...</Text>
                        </View>
                    )}
                    {!!rulesError && <Text className="text-red-600 text-base mb-2">{rulesError}</Text>}

                    {!rulesLoading && !rulesError && filteredRules.length === 0 && (
                        <View className="items-center py-6">
                            <Feather name="search" size={28} color="#9CA3AF" />
                            <Text className="text-gray-600 text-base text-center mt-2">No rules found.</Text>
                        </View>
                    )}

                    <View className="gap-3">
                        {paginatedRules.map(({ rule, number }) => (
                            <RuleCard
                                key={rule._id}
                                rule={rule}
                                ruleNumber={number}
                                onPress={() => setSelected({ rule, number })}
                            />
                        ))}
                    </View>

                    {!rulesLoading && !rulesError && (
                        <Pagination
                            currentPage={rulesPage}
                            totalItems={filteredRules.length}
                            itemsPerPage={RULES_PER_PAGE}
                            onPageChange={setRulesPage}
                        />
                    )}
                </View>

            

                {/* RECENT ACTIVITY */}
                <View className="bg-white rounded-2xl p-5 shadow mt-5 mb-5 border border-gray-100">
                    <Text className="text-xl font-bold text-gray-900 mb-4">Recent Activity</Text>

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
                                    paddingVertical: 10,
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
                                    size={15}
                                    color={activeLogTab === tab.id ? "#15803D" : "#4B5563"}
                                />
                                <Text style={{
                                    fontSize: 13,
                                    fontWeight: "600",
                                    color: activeLogTab === tab.id ? "#15803D" : "#4B5563",
                                }}>
                                    {tab.label}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>

                    {/* DISPOSAL TAB */}
                    {activeLogTab === "disposal" && (
                        <>
                            <View className="flex-row justify-between items-center py-2 border-t border-gray-100">
                                <Text className="text-sm font-semibold text-gray-600">
                                    Disposal Information
                                </Text>
                                <Text className="text-sm font-semibold text-gray-600">
                                    Disposal Order
                                </Text>
                            </View>
                            {disposalLoading && (
                                <View className="items-center py-6">
                                    <ActivityIndicator color="#16A34A" />
                                </View>
                            )}
                            {!!disposalError && (
                                <Text className="text-red-600 text-base text-center py-4">{disposalError}</Text>
                            )}
                            {!disposalLoading && !disposalError && disposalLogs.length === 0 && (
                                <Text className="text-gray-600 text-base text-center py-6">
                                    No disposal records yet.
                                </Text>
                            )}
                            {!disposalLoading && !disposalError && disposalLogs.map((log) => {
                                const scannedAt = new Date(log.scannedAt);
                                const binTypeMatch = log.note?.match(/\((.+)\)/);
                                const binType = binTypeMatch ? binTypeMatch[1] : "—";
                                return (
                                    <View key={log._id} className="flex-row justify-between items-center py-3 border-t border-gray-100">
                                        <View className="flex-1">
                                            <Text className="text-base font-semibold text-gray-900">
                                                {log.binId ?? "—"} · {binType}
                                            </Text>
                                            <Text className="text-sm text-gray-600 mt-0.5">
                                                {scannedAt.toLocaleDateString("en-CA")} ·{" "}
                                                {scannedAt.toLocaleTimeString([], {
                                                    hour: "2-digit", minute: "2-digit",
                                                })}
                                            </Text>
                                        </View>
                                        <Text className="text-base font-bold text-green-700 pl-2">
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
                                <Text className="text-red-600 text-base text-center py-4">{activityError}</Text>
                            )}
                            {!activityLoading && !activityError && activityLogs.length === 0 && (
                                <Text className="text-gray-600 text-base text-center py-6">No activity yet.</Text>
                            )}
                            {!activityLoading && !activityError && activityLogs.map((a) => (
                                <View key={a._id} className="flex-row justify-between items-center py-3 border-t border-gray-100">
                                    <View className="flex-1 pr-2">
                                        <Text className="text-base font-semibold text-gray-900">{a.type}</Text>
                                        <Text className="text-sm text-gray-600 mt-0.5">
                                            {a.description}{a.amount ? ` · ${a.amount}` : ""}
                                        </Text>
                                        <Text className="text-sm text-gray-500 mt-0.5">
                                            {new Date(a.date).toLocaleDateString("en-CA")}
                                        </Text>
                                    </View>
                                    <Text className={`text-base font-bold ml-2 ${a.points > 0 ? "text-green-600" : "text-red-600"
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
                                <Text className="text-red-600 text-base text-center py-4">{violationError}</Text>
                            )}
                            {!violationLoading && !violationError && violationLogs.length === 0 && (
                                <Text className="text-gray-600 text-base text-center py-6">
                                    No violations on record.
                                </Text>
                            )}
                            {!violationLoading && !violationError && violationLogs.map((v) => (
                                <View key={v._id} className="flex-row justify-between items-center py-3 border-t border-gray-100">
                                    <View className="flex-1 pr-2">
                                        <Text className="text-base font-semibold text-red-700">
                                            Offense #{v.offenseNumber} · {v.penaltyType}
                                        </Text>
                                        <Text className="text-sm text-gray-600 mt-0.5">
                                            {new Date(v.createdAt).toLocaleDateString("en-CA")}
                                            {v.communityService ? ` · ${v.communityService}` : ""}
                                        </Text>
                                        {v.issuedBy && (
                                            <Text className="text-sm text-gray-500 mt-0.5">
                                                Issued by: {v.issuedBy}
                                            </Text>
                                        )}
                                    </View>
                                    {v.cleared ? (
                                        <Text className="text-base font-bold text-yellow-500 ml-2">
                                            Settled
                                        </Text>
                                    ) : (
                                        <Text className="text-base font-bold text-red-600 ml-2">
                                            {v.fineAmount ? `- ₱${v.fineAmount}` : ""}
                                            {v.pointsDeducted ? `-${v.pointsDeducted}` : ""}
                                        </Text>
                                    )}
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

            {/* Rule details page */}
            <RuleDetails
                visible={!!selected}
                rule={selected?.rule ?? null}
                ruleNumber={selected?.number ?? 0}
                onClose={() => setSelected(null)}
            />
        </SafeAreaView>
    );
}   
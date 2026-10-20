import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
    View, Text, ScrollView,
    TextInput, TouchableOpacity, Linking, ActivityIndicator, RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { API_BASE } from "@/config";
import { getRules } from "../../api/rulesAPI";
import { useHousehold, fetchHousehold } from "../store/householdStore";
import Pagination from "../../components/UserPagination";
import RuleDetails, { Rule, RuleCard, matchesRuleSearch } from "../../components/RuleDetails";
import PenaltyBanner, { ViolationLog } from "../../components/PenaltyBanner";

const RULES_PER_PAGE = 4;
// Penalties only show for 24h, so one page of the newest violations is plenty
const VIOLATION_FETCH_LIMIT = 50;

export default function Rules() {
    const household = useHousehold();

    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState("");

    // ── Rules (same as Home) ─────────────────────────────────────────────────
    const [rules, setRules] = useState<Rule[]>([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [rulesError, setRulesError] = useState("");
    const [rulesPage, setRulesPage] = useState(1);
    const [selected, setSelected] = useState<{ rule: Rule; number: number } | null>(null);

    // ── Violations (feeds the 24h penalty banner) ────────────────────────────
    const [violations, setViolations] = useState<ViolationLog[]>([]);
    const violationAbortRef = useRef<AbortController | null>(null);

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

    // ── Fetch violations ─────────────────────────────────────────────────────
    const fetchViolations = useCallback(async () => {
        if (!household?._id) return;

        violationAbortRef.current?.abort();
        const controller = new AbortController();
        violationAbortRef.current = controller;

        try {
            const token = await AsyncStorage.getItem("token");
            const params = new URLSearchParams({ page: "1", limit: String(VIOLATION_FETCH_LIMIT) });
            const res = await fetch(`${API_BASE}/api/households/${household._id}/violations?${params}`, {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                signal: controller.signal,
            });
            const data = await res.json();
            if (data.success) setViolations(Array.isArray(data.data) ? data.data : []);
        } catch (err: any) {
            // On failure the banner simply stays hidden
            if (err?.name !== "AbortError") console.warn("Failed to load violations:", err);
        }
    }, [household?._id]);

    // ── Initial load ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!household) fetchHousehold();
        fetchRules();
    }, []);

    // Re-check violations whenever the tab is focused so new penalties appear right away
    useFocusEffect(
        useCallback(() => {
            fetchViolations();
        }, [fetchViolations])
    );

    useEffect(() => () => violationAbortRef.current?.abort(), []);

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

    // ── Pull-to-refresh ──────────────────────────────────────────────────────
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await Promise.all([fetchHousehold(), fetchRules(), fetchViolations()]);
        } finally {
            setRefreshing(false);
        }
    }, [fetchRules, fetchViolations]);

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
                {/* Header */}
                <View className="mb-6">
                    <Text className="text-3xl font-extrabold text-gray-900 tracking-tight">Activities & Penalties</Text>
                    <Text className="text-base text-gray-600 mt-1 leading-6">Activities and penalties associated with waste management</Text>
                </View>

                {/* Penalties & Deductions — visible for 24h after being issued, then hidden */}
                <PenaltyBanner records={violations} />


                {/* HOW TO EARN POINTS (same as Home) */}
                <View className="bg-white rounded-2xl p-5 shadow mt-5 border border-gray-100">
                    <View className="flex-col items-center mb-4 gap-3">
                        <View className="flex-row items-center gap-2">
                            <Feather name="clipboard" size={20} color="#16A34A" />
                            <Text className="text-xl font-bold text-gray-900">How to Earn Points</Text>
                        </View>
                        <View className="flex-row items-center border border-gray-300 bg-gray-50 rounded-xl px-3 w-full">
                            <Feather name="search" size={18} color="#6B7280" />
                            <TextInput
                                className="flex-1 py-3 pl-2 text-base text-gray-900"
                                placeholder="Search Activity"
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
                            <Text className="text-gray-600 mt-2 text-base">Loading Activities...</Text>
                        </View>
                    )}
                    {!!rulesError && <Text className="text-red-600 text-base mb-2">{rulesError}</Text>}

                    {!rulesLoading && !rulesError && filteredRules.length === 0 && (
                        <View className="items-center py-6">
                            <Feather name="search" size={28} color="#9CA3AF" />
                            <Text className="text-gray-600 text-base text-center mt-2">No activities found.</Text>
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
                 {/* RA 9003 */}
                <View className="bg-white rounded-2xl p-5 mt-5 shadow border border-gray-100">
                    <View className="flex-col gap-3">
                        <View>
                            <Text className="text-xl font-bold text-gray-900">
                                Republic Act No. 9003
                            </Text>
                            <Text className="text-green-700 text-base font-medium mt-0.5">
                                Ecological Solid Waste Management Act of 2000
                            </Text>
                        </View>
                        <View className="bg-green-100 px-3 py-1 rounded-full self-start">
                            <Text className="text-green-800 text-sm font-semibold">Philippine Law</Text>
                        </View>
                    </View>
                    <View className="bg-green-50 border border-green-200 rounded-xl p-4 mt-4">
                        <Text className="text-base text-gray-800 leading-6">
                            The Ecological Solid Waste Management Act of 2000, officially known as
                            Republic Act No. 9003, is a Philippine environmental law enacted to
                            establish a comprehensive and sustainable system for managing solid waste
                            nationwide.{" "}
                            <Text className="font-semibold text-gray-900">
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
                        className="flex-row items-center gap-2 mt-4"
                    >
                        <Feather name="external-link" size={16} color="#15803D" />
                        <Text className="text-green-700 text-base font-semibold underline">
                            See full text of RA 9003
                        </Text>
                    </TouchableOpacity>
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
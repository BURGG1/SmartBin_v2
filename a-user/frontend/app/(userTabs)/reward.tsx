import { useState, useEffect, useCallback, useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, Image, ActivityIndicator, Modal, Alert } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";

import { getRewards, redeemReward, getHouseholdActivity } from "../../api/rewardAPI";
import { useHousehold, fetchHousehold, setHousehold } from "../store/householdStore";
import Pagination from "../../components/UserPagination";

type Reward = {
    _id: string;
    name: string;
    points: number;
    stocks: number;
    image?: string;
};

type ActivityItem = {
    type: string;
    via: string;
    date: string;
    points: number;
    amount?: string;
};

const REWARDS_PER_PAGE      = 4;
const ACTIVITY_PER_PAGE     = 7;
const ACTIVITY_FETCH_LIMIT  = 50;
const ACTIVITY_HISTORY_CAP  = 50;
const REDEEMED_PER_PAGE     = 8;

export default function Rewards() {
    const household = useHousehold();
    const [householdLoading, setHouseholdLoading] = useState(!household);

    const [rewards, setRewards]           = useState<Reward[]>([]);
    const [rewardsLoading, setRewardsLoading] = useState(true);
    const [rewardsError, setRewardsError] = useState("");
    const [rewardsPage, setRewardsPage]   = useState(1);

    const [activity, setActivity]           = useState<ActivityItem[]>([]);
    const [activityLoading, setActivityLoading] = useState(true);
    const [activityPage, setActivityPage]   = useState(1);

    const [selectedReward, setSelectedReward] = useState<Reward | null>(null);
    const [redeeming, setRedeeming]           = useState(false);

    // ── Redeemed history (chest FAB) ──
    const [historyVisible, setHistoryVisible] = useState(false);
    const [historyPage, setHistoryPage]       = useState(1);

    const loadHousehold = useCallback(async () => {
        setHouseholdLoading(true);
        await fetchHousehold();
        setHouseholdLoading(false);
    }, []);

    const loadRewards = useCallback(async () => {
        try {
            setRewardsLoading(true);
            setRewardsError("");
            const data = await getRewards();
            const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
            setRewards(list);
        } catch (err) {
            console.error(err);
            setRewards([]);
            setRewardsError("Failed to load rewards. Please try again later.");
        } finally {
            setRewardsLoading(false);
        }
    }, []);

    const loadActivity = useCallback(async (householdId?: string) => {
        if (!householdId) return;
        try {
            setActivityLoading(true);
            const data = await getHouseholdActivity(householdId, ACTIVITY_FETCH_LIMIT);
            setActivity(data);
        } catch (err) {
            console.error("Failed to load activity:", err);
        } finally {
            setActivityLoading(false);
        }
    }, []);

    useEffect(() => {
        loadHousehold();
        loadRewards();
    }, []);

    useEffect(() => {
        if (household?._id) {
            loadActivity(household._id);
            setActivityPage(1);
        }
    }, [household?._id]);

    useFocusEffect(
        useCallback(() => {
            loadHousehold();
            if (household?._id) loadActivity(household._id);
        }, [household?._id])
    );

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(rewards.length / REWARDS_PER_PAGE));
        if (rewardsPage > totalPages) setRewardsPage(totalPages);
    }, [rewards.length]);

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(activity.length / ACTIVITY_PER_PAGE));
        if (activityPage > totalPages) setActivityPage(totalPages);
    }, [activity.length]);

    // ── Redeemed-only history, derived from activity ──
    const redeemedHistory = useMemo(
        () => activity.filter((a) => a.type === "Redeemed Reward"),
        [activity]
    );
    const totalRedeemedPoints = useMemo(
        () => redeemedHistory.reduce((s, a) => s + Math.abs(a.points), 0),
        [redeemedHistory]
    );

    useEffect(() => {
        const totalPages = Math.max(1, Math.ceil(redeemedHistory.length / REDEEMED_PER_PAGE));
        if (historyPage > totalPages) setHistoryPage(totalPages);
    }, [redeemedHistory.length]);

    const openConfirm = (reward: Reward) => {
        if (!household) {
            Alert.alert("Error", "Household info not loaded yet. Please try again.");
            return;
        }
        if (reward.stocks < 1) {
            Alert.alert("Out of stock", "This reward is no longer available.");
            return;
        }
        if ((household.points?.total ?? 0) < reward.points) {
            Alert.alert("Not enough points", `You need ${reward.points} points to redeem this item.`);
            return;
        }
        setSelectedReward(reward);
    };

    const confirmRedeem = async () => {
        if (!selectedReward || !household?._id || !household) return;

        setRedeeming(true);
        try {
            const res = await redeemReward(selectedReward._id, household._id);

            // ── Update points in store using server response as source of truth ──
            const newTotal     = res?.data?.household?.points?.total
                ?? (household.points.total - selectedReward.points);
            const newThisMonth = res?.data?.household?.points?.thisMonth
                ?? (household.points.thisMonth - selectedReward.points);

            setHousehold({
                ...household,
                points: {
                    total:     newTotal,
                    thisMonth: newThisMonth,
                },
            });

            // Update reward stock in UI
            setRewards((prev) =>
                prev.map((r) =>
                    r._id === selectedReward._id ? { ...r, stocks: r.stocks - 1 } : r
                )
            );

            // Prepend to activity log
            setActivity((prev) =>
                [
                    {
                        type:   "Redeemed Reward",
                        via:    selectedReward.name,
                        date:   new Date().toISOString(),
                        points: -selectedReward.points,
                    },
                    ...prev,
                ].slice(0, ACTIVITY_HISTORY_CAP)
            );
            setActivityPage(1);
            setHistoryPage(1);

            setSelectedReward(null);
            Alert.alert("Success", res.message || "Reward redeemed successfully!");
        } catch (err: any) {
            Alert.alert("Error", err.message || "Failed to redeem reward.");
            // Resync in case data is stale (e.g. last unit taken by someone else)
            loadRewards();
            loadHousehold();
        } finally {
            setRedeeming(false);
        }
    };

    const paginatedRewards      = rewards.slice(
        (rewardsPage - 1) * REWARDS_PER_PAGE,
        rewardsPage * REWARDS_PER_PAGE
    );

    const paginatedActivity     = activity.slice(
        (activityPage - 1) * ACTIVITY_PER_PAGE,
        activityPage * ACTIVITY_PER_PAGE
    );
    const activityFillerCount   = Math.max(0, ACTIVITY_PER_PAGE - paginatedActivity.length);

    const paginatedHistory      = redeemedHistory.slice(
        (historyPage - 1) * REDEEMED_PER_PAGE,
        historyPage * REDEEMED_PER_PAGE
    );

    if (householdLoading) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="#16A34A" />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1 bg-gray-50">
            <ScrollView className="flex-1 px-4 py-2" showsVerticalScrollIndicator={false}>
                <View className="flex flex-col gap-5 pb-6">

                    {/* Header */}
                    <View>
                        <Text className="text-3xl font-bold text-gray-900">Rewards & Achievements</Text>
                        <Text className="text-gray-500 mt-1">Redeem your points for eco-friendly items</Text>
                    </View>

                    {/* Top Section */}
                    <View className="flex flex-col xl:flex-row gap-4">
                        <View
                            className="rounded-2xl p-6 flex-1"
                            style={{
                                backgroundColor: "#16A34A",
                                shadowColor: "#16A34A",
                                shadowOpacity: 0.25,
                                shadowRadius: 12,
                                shadowOffset: { width: 0, height: 6 },
                                elevation: 4,
                            }}
                        >
                            <View className="flex-row items-center gap-2 mb-4">
                                <View className="bg-white/20 rounded-full p-1.5">
                                    <MaterialCommunityIcons name="star-four-points" size={16} color="#fff" />
                                </View>
                                <Text className="text-white font-semibold">Reward Points</Text>
                            </View>
                            <View className="flex-row justify-between items-center">
                                <View>
                                    <Text className="text-4xl font-bold text-white">
                                        {household?.points?.total ?? 0}
                                    </Text>
                                    <Text className="text-green-100 mt-0.5">Total Points Earned</Text>
                                </View>
                                <View className="bg-white/15 px-3 py-2 rounded-xl border border-white/30 items-center justify-center min-w-[64px]">
                                    <Text className="text-2xl font-bold text-white">
                                        {household?.streak?.currentStreak ?? 0}
                                    </Text>
                                    <Text className="text-white text-center text-xs">
                                        {(household?.streak?.currentStreak ?? 0) === 1 ? "day streak" : "days streak"}
                                    </Text>
                                </View>
                            </View>
                            <View className="flex-row justify-between items-center mt-4 pt-3 border-t border-white/20">
                                <Text className="text-green-100 text-sm">This Month</Text>
                                <Text className="font-semibold text-white">+{household?.points?.thisMonth ?? 0} points</Text>
                            </View>
                        </View>

                        <View
                            className="bg-white rounded-2xl p-6 flex-1"
                            style={{
                                shadowColor: "#000",
                                shadowOpacity: 0.05,
                                shadowRadius: 10,
                                shadowOffset: { width: 0, height: 3 },
                                elevation: 2,
                            }}
                        >
                            <View className="flex-row items-center gap-2 mb-4">
                                <View className="bg-green-50 rounded-full p-1.5">
                                    <Feather name="trending-up" size={16} color="#16A34A" />
                                </View>
                                <Text className="font-semibold text-gray-900">This Month</Text>
                            </View>
                            <View className="gap-3">
                                <View className="flex-row justify-between items-center">
                                    <Text className="text-gray-600">Points Earned</Text>
                                    <Text className="text-green-600 font-semibold">
                                        +{household?.points?.thisMonth ?? 0}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between items-center">
                                    <Text className="text-gray-600">Points Redeemed</Text>
                                    <Text className="text-red-500 font-semibold">
                                        -{totalRedeemedPoints}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </View>

                    {/* Streak Card */}
                    {(household?.streak?.currentStreak ?? 0) > 0 && (
                        <View className="bg-orange-50 border border-orange-200 rounded-2xl p-4 flex-row items-center gap-3">
                            <Text className="text-2xl">🔥</Text>
                            <View className="flex-1">
                                <Text className="font-bold text-orange-700">
                                    {household?.streak?.currentStreak} Day Streak!
                                </Text>
                                <Text className="text-xs text-orange-500 mt-0.5">
                                    Keep disposing daily to maintain your streak and earn bonus points.
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Redeemable Items */}
                    <View
                        className="bg-white rounded-2xl p-6"
                        style={{
                            shadowColor: "#000",
                            shadowOpacity: 0.05,
                            shadowRadius: 10,
                            shadowOffset: { width: 0, height: 3 },
                            elevation: 2,
                        }}
                    >
                        <View className="flex-row items-center gap-2 mb-4">
                            <View className="bg-green-50 rounded-full p-1.5">
                                <MaterialCommunityIcons name="gift" size={18} color="#16A34A" />
                            </View>
                            <Text className="text-lg font-semibold text-gray-900">Redeemable Items</Text>
                        </View>

                        {rewardsLoading && (
                            <View className="items-center py-8">
                                <ActivityIndicator color="#16A34A" />
                                <Text className="text-gray-500 mt-2">Loading rewards...</Text>
                            </View>
                        )}

                        {!!rewardsError && (
                            <View className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3 flex-row items-center gap-2">
                                <Feather name="alert-circle" size={16} color="#EF4444" />
                                <Text className="text-red-500 flex-1">{rewardsError}</Text>
                            </View>
                        )}

                        <View className="flex flex-col gap-3">
                            {paginatedRewards.map((item) => {
                                const canRedeem = item.stocks > 0 && (household?.points?.total ?? 0) >= item.points;
                                const lowStock  = item.stocks > 0 && item.stocks <= 3;
                                return (
                                    <View
                                        key={item._id}
                                        className="bg-gray-50 rounded-2xl p-4 w-full flex-row gap-4"
                                    >
                                        {item.image ? (
                                            <Image
                                                source={{ uri: item.image }}
                                                className="h-20 w-20 rounded-xl"
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View className="h-20 w-20 bg-gray-200 rounded-xl items-center justify-center">
                                                <MaterialCommunityIcons name="gift-outline" size={26} color="#9CA3AF" />
                                            </View>
                                        )}
                                        <View className="flex-1 justify-between">
                                            <View>
                                                <View className="flex-row items-center justify-between">
                                                    <Text className="font-semibold text-gray-900 flex-1" numberOfLines={1}>
                                                        {item.name}
                                                    </Text>
                                                    {lowStock && (
                                                        <View className="bg-amber-100 px-2 py-0.5 rounded-full ml-2">
                                                            <Text className="text-amber-700 text-[10px] font-semibold">
                                                                Low stock
                                                            </Text>
                                                        </View>
                                                    )}
                                                </View>
                                                <View className="flex-row items-center gap-3 mt-1">
                                                    <Text className="text-green-600 font-semibold text-sm">
                                                        {item.points} pts
                                                    </Text>
                                                    <Text className="text-gray-400 text-xs">
                                                        {item.stocks} left
                                                    </Text>
                                                </View>
                                            </View>
                                            <TouchableOpacity
                                                disabled={!canRedeem}
                                                onPress={() => openConfirm(item)}
                                                activeOpacity={0.8}
                                                className="mt-2 py-2 rounded-lg items-center"
                                                style={{ backgroundColor: canRedeem ? "#16A34A" : "#D1D5DB" }}
                                            >
                                                <Text className="text-white font-semibold text-sm">
                                                    {item.stocks < 1
                                                        ? "Out of stock"
                                                        : canRedeem
                                                        ? "Redeem"
                                                        : "Not enough points"}
                                                </Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                );
                            })}

                            {!rewardsLoading && rewards.length === 0 && !rewardsError && (
                                <View className="items-center py-10">
                                    <MaterialCommunityIcons name="gift-off-outline" size={32} color="#D1D5DB" />
                                    <Text className="text-gray-500 text-center mt-2">No rewards available yet.</Text>
                                </View>
                            )}

                            {!rewardsLoading && rewards.length > 0 && (
                                <Pagination
                                    currentPage={rewardsPage}
                                    totalItems={rewards.length}
                                    itemsPerPage={REWARDS_PER_PAGE}
                                    onPageChange={setRewardsPage}
                                />
                            )}
                        </View>
                    </View>

                    {/* Recent Activity */}
                    <View
                        className="bg-white rounded-2xl p-6 mb-2"
                        style={{
                            shadowColor: "#000",
                            shadowOpacity: 0.05,
                            shadowRadius: 10,
                            shadowOffset: { width: 0, height: 3 },
                            elevation: 2,
                        }}
                    >
                        <View className="flex-row items-center justify-between mb-4">
                            <View className="flex-row items-center gap-2">
                                <View className="bg-green-50 rounded-full p-1.5">
                                    <Feather name="clock" size={16} color="#16A34A" />
                                </View>
                                <Text className="text-lg font-semibold text-gray-900">Recent Activity</Text>
                            </View>
                        </View>

                        {activityLoading && (
                            <View className="items-center py-8">
                                <ActivityIndicator color="#16A34A" />
                            </View>
                        )}

                        <View className="flex-1 gap-1">
                            {paginatedActivity.map((a, index) => {
                                const isRedeem = a.points < 0;
                                return (
                                    <View
                                        key={index}
                                        className="flex-row justify-between items-center py-3"
                                        style={index !== paginatedActivity.length - 1 ? { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" } : undefined}
                                    >
                                        <View className="flex-row items-center gap-3 flex-1">
                                            <View
                                                className="h-9 w-9 rounded-full items-center justify-center"
                                                style={{ backgroundColor: isRedeem ? "#FEF2F2" : "#F0FDF4" }}
                                            >
                                                <MaterialCommunityIcons
                                                    name={isRedeem ? "gift-outline" : "recycle"}
                                                    size={18}
                                                    color={isRedeem ? "#EF4444" : "#16A34A"}
                                                />
                                            </View>
                                            <View className="flex-1">
                                                <Text className="font-medium text-gray-900">{a.type}</Text>
                                                <Text className="text-xs text-gray-500" numberOfLines={1}>
                                                    {a.via}{a.amount ? ` - ${a.amount}` : ""}
                                                </Text>
                                                <Text className="text-xs text-gray-400 mt-0.5">
                                                    {new Date(a.date).toLocaleDateString()}
                                                </Text>
                                            </View>
                                        </View>
                                        <Text className={`font-semibold ${a.points > 0 ? "text-green-600" : "text-red-500"}`}>
                                            {a.points > 0 ? `+${a.points}` : a.points}
                                        </Text>
                                    </View>
                                );
                            })}

                            {!activityLoading && activity.length === 0 && (
                                <View className="items-center py-10">
                                    <Feather name="inbox" size={28} color="#D1D5DB" />
                                    <Text className="text-gray-500 text-center mt-2">No activity yet.</Text>
                                </View>
                            )}

                            {!activityLoading && activity.length > 0 && (
                                <Pagination
                                    currentPage={activityPage}
                                    totalItems={activity.length}
                                    itemsPerPage={ACTIVITY_PER_PAGE}
                                    onPageChange={setActivityPage}
                                />
                            )}
                        </View>
                    </View>

                </View>
            </ScrollView>

            {/* ── Floating chest button → redeemed items history ── */}
            <TouchableOpacity
                onPress={() => { setHistoryPage(1); setHistoryVisible(true); }}
                activeOpacity={0.85}
                accessibilityLabel="View redeemed rewards history"
                className="absolute items-center justify-center"
                style={{
                    bottom: 24,
                    right: 20,
                    height: 58,
                    width: 58,
                    borderRadius: 29,
                    backgroundColor: "#16A34A",
                    shadowColor: "#000",
                    shadowOpacity: 0.25,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 6,
                }}
            >
                <MaterialCommunityIcons name="treasure-chest" size={28} color="#fff" />
                {redeemedHistory.length > 0 && (
                    <View
                        className="absolute items-center justify-center"
                        style={{
                            top: -4,
                            right: -4,
                            minWidth: 20,
                            height: 20,
                            paddingHorizontal: 4,
                            borderRadius: 10,
                            backgroundColor: "#F59E0B",
                            borderWidth: 2,
                            borderColor: "#fff",
                        }}
                    >
                        <Text className="text-white text-[10px] font-bold">
                            {redeemedHistory.length > 99 ? "99+" : redeemedHistory.length}
                        </Text>
                    </View>
                )}
            </TouchableOpacity>

            {/* Redeem confirmation modal */}
            <Modal
                visible={!!selectedReward}
                transparent
                animationType="fade"
                onRequestClose={() => !redeeming && setSelectedReward(null)}
            >
                <View className="flex-1 bg-black/40 justify-center items-center p-6">
                    <View className="bg-white w-full max-w-sm rounded-2xl p-6 gap-4">
                        <View className="items-center gap-2">
                            <View className="bg-green-50 rounded-full p-3">
                                <MaterialCommunityIcons name="gift-outline" size={32} color="#16A34A" />
                            </View>
                            <Text className="text-lg font-bold text-center text-gray-900">Confirm Redemption</Text>
                        </View>

                        {selectedReward && (
                            <Text className="text-gray-600 text-center">
                                Redeem{" "}
                                <Text className="font-semibold text-gray-900">{selectedReward.name}</Text>
                                {" "}for{" "}
                                <Text className="font-semibold text-green-600">{selectedReward.points} points</Text>?
                                {"\n"}This action cannot be undone.
                            </Text>
                        )}

                        <View className="flex-row gap-3 mt-2">
                            <TouchableOpacity
                                disabled={redeeming}
                                onPress={() => setSelectedReward(null)}
                                className="flex-1 border border-gray-300 py-3 rounded-lg items-center"
                                style={{ opacity: redeeming ? 0.5 : 1 }}
                            >
                                <Text className="font-semibold text-gray-700">Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                disabled={redeeming}
                                onPress={confirmRedeem}
                                className="flex-1 bg-green-600 py-3 rounded-lg items-center"
                                style={{ opacity: redeeming ? 0.6 : 1 }}
                            >
                                {redeeming ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text className="font-semibold text-white">Confirm</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* ── Redeemed rewards history modal ── */}
            <Modal
                visible={historyVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setHistoryVisible(false)}
            >
                <View className="flex-1 bg-black/40 justify-end">
                    <View
                        className="bg-white w-full rounded-t-3xl p-6"
                        style={{ maxHeight: "80%" }}
                    >
                        <View className="flex-row items-center justify-between mb-1">
                            <View className="flex-row items-center gap-2">
                                <View className="bg-amber-50 rounded-full p-2">
                                    <MaterialCommunityIcons name="treasure-chest" size={20} color="#F59E0B" />
                                </View>
                                <Text className="text-lg font-bold text-gray-900">Redeemed Rewards</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => setHistoryVisible(false)}
                                className="p-2 -mr-2"
                                accessibilityLabel="Close"
                            >
                                <Feather name="x" size={22} color="#6B7280" />
                            </TouchableOpacity>
                        </View>
                        <Text className="text-gray-500 text-sm mb-4">
                            {redeemedHistory.length} redemption{redeemedHistory.length === 1 ? "" : "s"} · {totalRedeemedPoints} points used
                        </Text>

                        <ScrollView showsVerticalScrollIndicator={false}>
                            <View className="gap-1">
                                {paginatedHistory.map((a, index) => (
                                    <View
                                        key={index}
                                        className="flex-row justify-between items-center py-3"
                                        style={index !== paginatedHistory.length - 1 ? { borderBottomWidth: 1, borderBottomColor: "#F3F4F6" } : undefined}
                                    >
                                        <View className="flex-row items-center gap-3 flex-1">
                                            <View className="h-10 w-10 rounded-full bg-amber-50 items-center justify-center">
                                                <MaterialCommunityIcons name="gift" size={18} color="#F59E0B" />
                                            </View>
                                            <View className="flex-1">
                                                <Text className="font-medium text-gray-900" numberOfLines={1}>
                                                    {a.via}
                                                </Text>
                                                <Text className="text-xs text-gray-400 mt-0.5">
                                                    {new Date(a.date).toLocaleDateString(undefined, {
                                                        year: "numeric",
                                                        month: "short",
                                                        day: "numeric",
                                                    })}
                                                </Text>
                                            </View>
                                        </View>
                                        <Text className="font-semibold text-red-500">
                                            {a.points}
                                        </Text>
                                    </View>
                                ))}

                                {redeemedHistory.length === 0 && (
                                    <View className="items-center py-10">
                                        <MaterialCommunityIcons name="treasure-chest" size={36} color="#E5E7EB" />
                                        <Text className="text-gray-500 text-center mt-3">
                                            No rewards redeemed yet.
                                        </Text>
                                        <Text className="text-gray-400 text-center text-xs mt-1">
                                            Redeem an item above to see it here.
                                        </Text>
                                    </View>
                                )}
                            </View>
                        </ScrollView>

                        {redeemedHistory.length > 0 && (
                            <View className="mt-2">
                                <Pagination
                                    currentPage={historyPage}
                                    totalItems={redeemedHistory.length}
                                    itemsPerPage={REDEEMED_PER_PAGE}
                                    onPageChange={setHistoryPage}
                                />
                            </View>
                        )}
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}
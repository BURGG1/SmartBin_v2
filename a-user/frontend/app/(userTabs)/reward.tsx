import { useState, useEffect, useCallback } from "react";
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
    const rewardsFillerCount    = Math.max(0, REWARDS_PER_PAGE - paginatedRewards.length);

    const paginatedActivity     = activity.slice(
        (activityPage - 1) * ACTIVITY_PER_PAGE,
        activityPage * ACTIVITY_PER_PAGE
    );
    const activityFillerCount   = Math.max(0, ACTIVITY_PER_PAGE - paginatedActivity.length);

    if (householdLoading) {
        return (
            <SafeAreaView className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="#16A34A" />
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView className="flex-1">
            <ScrollView className="flex-1 px-4 py-2">
                <View className="flex flex-col gap-5">

                    {/* Header */}
                    <View>
                        <Text className="text-3xl font-bold">Rewards & Achievements</Text>
                        <Text className="text-gray-500">Redeem your points for eco-friendly items</Text>
                    </View>

                    {/* Top Section */}
                    <View className="flex flex-col xl:flex-row gap-6">
                        <View className="bg-green-600 rounded-xl p-6 shadow flex-1 space-y-4">
                            <View className="flex-row items-center gap-2 mb-4">
                                <Text className="text-white font-semibold">Reward Points</Text>
                            </View>
                            <View className="flex-row justify-between items-center">
                                <View>
                                    <Text className="text-4xl font-bold text-white">
                                        {household?.points?.total ?? 0}
                                    </Text>
                                    <Text className="text-green-100">Total Points Earned</Text>
                                </View>
                                <View className="bg-green-600 p-2 rounded-xl border border-green-700 items-center justify-center">
                                    <Text className="text-2xl font-bold text-white">
                                        {household?.streak?.currentStreak ?? 0}
                                    </Text>
                                    <Text className="text-white text-center text-xs">
                                        {(household?.streak?.currentStreak ?? 0) === 1 ? "day streak" : "days streak"}
                                    </Text>
                                </View>
                            </View>
                            <View className="flex-row justify-between text-sm text-green-100">
                                <Text>This Month</Text>
                                <Text className="font-semibold">+{household?.points?.thisMonth ?? 0} points</Text>
                            </View>
                        </View>

                        <View className="bg-white rounded-xl p-6 shadow flex-1 space-y-4">
                            <View className="flex-row items-center gap-2">
                                <Feather name="trending-up" size={20} color="#16A34A" />
                                <Text className="font-semibold">This Month</Text>
                            </View>
                            <View className="space-y-2 text-sm">
                                <View className="flex-row justify-between">
                                    <Text>Points Earned</Text>
                                    <Text className="text-green-600 font-semibold">
                                        +{household?.points?.thisMonth ?? 0}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between">
                                    <Text>Points Redeemed</Text>
                                    <Text className="text-red-500 font-semibold">
                                        -{activity
                                            .filter((a) => a.type === "Redeemed Reward")
                                            .reduce((s, a) => s + Math.abs(a.points), 0)}
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </View>

                    {/* Streak Card */}
                    {(household?.streak?.currentStreak ?? 0) > 0 && (
                        <View className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex-row items-center gap-3">
                            <Text className="text-2xl">🔥</Text>
                            <View>
                                <Text className="font-bold text-orange-700">
                                    {household?.streak?.currentStreak} Day Streak!
                                </Text>
                                <Text className="text-xs text-orange-500">
                                    Keep disposing daily to maintain your streak and earn bonus points.
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Redeemable Items */}
                    <View className="bg-white rounded-xl p-6 shadow space-y-4">
                        <View className="flex-row items-center gap-2 mb-4">
                            <MaterialCommunityIcons name="gift" size={20} color="#16A34A" />
                            <Text className="text-lg font-semibold">Redeemable Items</Text>
                        </View>

                        {rewardsLoading && (
                            <View className="items-center py-6">
                                <ActivityIndicator color="#16A34A" />
                                <Text className="text-gray-500 mt-2">Loading rewards...</Text>
                            </View>
                        )}

                        {!!rewardsError && <Text className="text-red-500 mb-2">{rewardsError}</Text>}

                        <View className="flex flex-col gap-3">
                            {paginatedRewards.map((item) => {
                                const canRedeem = item.stocks > 0 && (household?.points?.total ?? 0) >= item.points;
                                return (
                                    <View key={item._id} className="bg-gray-50 rounded-xl p-4 w-full">
                                        {item.image ? (
                                            <Image
                                                source={{ uri: item.image }}
                                                className="h-24 w-full rounded mb-4"
                                                resizeMode="cover"
                                            />
                                        ) : (
                                            <View className="h-24 bg-gray-200 rounded mb-4 items-center justify-center">
                                                <Text>ICON</Text>
                                            </View>
                                        )}
                                        <Text className="font-semibold">{item.name}</Text>
                                        <View className="flex-row justify-between text-sm my-2">
                                            <Text className="text-green-600 font-semibold">{item.points} pts</Text>
                                            <Text className="text-gray-500">{item.stocks} left</Text>
                                        </View>
                                        <TouchableOpacity
                                            disabled={!canRedeem}
                                            onPress={() => openConfirm(item)}
                                            className="mt-auto py-2 rounded-lg items-center"
                                            style={{ backgroundColor: canRedeem ? "#16A34A" : "#9CA3AF" }}
                                        >
                                            <Text className="text-white font-semibold">
                                                {item.stocks < 1
                                                    ? "Out of stock"
                                                    : canRedeem
                                                    ? "Redeem"
                                                    : "Not enough points"}
                                            </Text>
                                        </TouchableOpacity>
                                    </View>
                                );
                            })}

                            {!rewardsLoading && rewards.length > 0 &&
                                Array.from({ length: rewardsFillerCount }).map((_, i) => (
                                    <View key={`filler-${i}`} className="h-60 w-full" style={{ opacity: 0 }} />
                                ))
                            }

                            {!rewardsLoading && rewards.length === 0 && !rewardsError && (
                                <Text className="text-gray-500 text-center py-6">No rewards available yet.</Text>
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
                    <View className="bg-white rounded-xl p-6 shadow flex-1 mb-4">
                        <Text className="text-lg font-semibold mb-4">Recent Activity</Text>

                        {activityLoading && (
                            <View className="items-center py-6">
                                <ActivityIndicator color="#16A34A" />
                            </View>
                        )}

                        <View className="flex-1 gap-4">
                            {paginatedActivity.map((a, index) => (
                                <View key={index} className="flex-row justify-between items-center">
                                    <View>
                                        <Text className="font-medium">{a.type}</Text>
                                        <Text className="text-xs">
                                            {a.via}{a.amount ? ` - ${a.amount}` : ""}
                                        </Text>
                                        <Text className="text-xs text-gray-500">
                                            {new Date(a.date).toLocaleDateString()}
                                        </Text>
                                    </View>
                                    <Text className={`font-semibold ${a.points > 0 ? "text-green-600" : "text-red-500"}`}>
                                        {a.points > 0 ? `+${a.points}` : a.points}
                                    </Text>
                                </View>
                            ))}

                            {!activityLoading && activity.length > 0 &&
                                Array.from({ length: activityFillerCount }).map((_, i) => (
                                    <View key={`filler-${i}`} className="h-11" style={{ opacity: 0 }} />
                                ))
                            }

                            {!activityLoading && activity.length === 0 && (
                                <Text className="text-gray-500 text-center py-6">No activity yet.</Text>
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
                            <MaterialCommunityIcons name="gift-outline" size={36} color="#16A34A" />
                            <Text className="text-lg font-bold text-center">Confirm Redemption</Text>
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
        </SafeAreaView>
    );
}
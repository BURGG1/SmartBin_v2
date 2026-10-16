import { useState, useEffect, useRef, useCallback } from "react";
import { View, Text, FlatList, ScrollView, ActivityIndicator, RefreshControl } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/config";
import Pagination from "../../components/UserPagination";

const POLL_INTERVAL_MS = 10000;
const RANKINGS_PER_PAGE = 5;

const tierStyles = {
  Gold:   { bg: "bg-yellow-100", text: "text-yellow-800" },
  Silver: { bg: "bg-gray-200",   text: "text-gray-800"   },
  Bronze: { bg: "bg-orange-100", text: "text-orange-800" },
};

const getTierByRank = (rank) => {
  if (rank === 1) return "Gold";
  if (rank === 2) return "Silver";
  if (rank === 3) return "Bronze";
  return null;
};

export default function Leaderboard() {
  const [rankedData, setRankedData]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [rankingsPage, setRankingsPage] = useState(1);
  const myHouseholdIdRef              = useRef(null);
  const isMountedRef                  = useRef(true);

  useEffect(() => {
    (async () => {
      try {
        const raw  = await AsyncStorage.getItem("user");
        const user = raw ? JSON.parse(raw) : null;
        myHouseholdIdRef.current = user?.id ?? null;
      } catch (err) {
        console.error("Failed to read user from storage:", err);
      }
    })();
  }, []);

  const fetchLeaderboard = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/households/leaderboard?limit=50`);
      const data = await res.json();

      if (!data.success) throw new Error("Failed to fetch leaderboard");

      const ranked = (data.data ?? []).map((hh) => ({
        ...hh,
        householdId: `HH-${hh._id.slice(-8).toUpperCase()}`,
        tier:        getTierByRank(hh.rank),
        isYou:       myHouseholdIdRef.current
                       ? hh._id === myHouseholdIdRef.current
                       : false,
      }));

      if (isMountedRef.current) {
        setRankedData(ranked);
        setError(false);
      }
    } catch (err) {
      console.error("Leaderboard fetch error:", err);
      if (isMountedRef.current) setError(true);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchLeaderboard();
    const id = setInterval(() => fetchLeaderboard({ silent: true }), POLL_INTERVAL_MS);
    return () => { isMountedRef.current = false; clearInterval(id); };
  }, [fetchLeaderboard]);

  // Clamp the current page if a refresh returns fewer rows than before
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(rankedData.length / RANKINGS_PER_PAGE));
    if (rankingsPage > totalPages) setRankingsPage(totalPages);
  }, [rankedData.length]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchLeaderboard({ silent: true });
  };

  const podiumData = rankedData.slice(0, 3);

  const paginatedRankingsRaw = rankedData.slice(
    (rankingsPage - 1) * RANKINGS_PER_PAGE,
    rankingsPage * RANKINGS_PER_PAGE
  );
  const rankingsFillerCount = Math.max(0, RANKINGS_PER_PAGE - paginatedRankingsRaw.length);
  const paginatedRankings = [
    ...paginatedRankingsRaw,
    ...Array.from({ length: rankingsFillerCount }, (_, i) => ({
      householdId: `__filler-${i}`,
      __filler: true,
    })),
  ];

  if (loading) {
    return (
      <SafeAreaView className="flex-1 justify-center items-center bg-gray-50">
        <ActivityIndicator size="large" color="#16A34A" />
        <Text className="text-gray-600 text-base mt-3">Loading leaderboard...</Text>
      </SafeAreaView>
    );
  }

  // Error state is wrapped in a ScrollView so "Pull down to try again" actually works
  if (error && rankedData.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={["#16A34A"]}
              tintColor="#16A34A"
            />
          }
        >
          <Feather name="alert-triangle" size={32} color="#DC2626" />
          <Text className="text-red-600 text-lg font-semibold mt-3 text-center">Failed to load leaderboard.</Text>
          <Text className="text-gray-600 text-base mt-1 text-center">Pull down to try again.</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1">
      <FlatList
        data={paginatedRankings}
        keyExtractor={(item) => item.householdId}
        className="flex-1 px-4 py-2 bg-gray-50"
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={["#16A34A"]}
            tintColor="#16A34A"
          />
        }
        ListHeaderComponent={() => (
          <View className="gap-6">
            <View>
              <Text className="text-3xl font-extrabold text-gray-900 tracking-tight">Community Leaderboard</Text>
              <Text className="text-base text-gray-600 mt-1 leading-6">
                See how you rank among other households in waste management
              </Text>
            </View>

            {rankedData.length === 0 ? (
              <View className="bg-white rounded-2xl shadow p-8 items-center border border-gray-100">
                <Text className="text-gray-600 text-base">No household data yet.</Text>
              </View>
            ) : (
              <>
                {/* Podium */}
                <View className="flex flex-col gap-3 bg-green-50 rounded-2xl p-4 shadow border border-green-100">
                  {podiumData.map((item) => (
                    <View
                      key={item.rank}
                      className={`bg-white rounded-xl shadow p-4 flex-row items-center gap-4 ${item.isYou ? "border-2 border-green-500" : "border border-gray-100"}`}
                    >
                      <View className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
                        <Text className="text-lg font-extrabold text-green-800">#{item.rank}</Text>
                      </View>
                      <View className="flex-1">
                        <Text className="text-lg font-bold text-gray-900">{item.fullname}</Text>
                        <Text className="text-sm text-gray-600 leading-5">{item.address}</Text>
                        <Text className="text-base text-green-700 font-bold mt-1">{item.points} pts</Text>
                        <Text className="text-sm text-gray-600">{item.disposals} disposals</Text>
                        {item.isYou && (
                          <Text className="mt-1.5 text-xs font-semibold bg-green-600 text-white px-2.5 py-1 rounded-full self-start">
                            You
                          </Text>
                        )}
                      </View>
                      {item.rank === 1 && <Feather name="award" size={26} color="#EAB308" />}
                    </View>
                  ))}

                  <View className="mt-2 flex-row justify-center">
                    <View className="flex-row items-center gap-2 bg-white px-4 py-2 rounded-full shadow">
                      <Feather name="star" size={16} color="#EAB308" />
                      <Text className="text-sm font-medium text-gray-800">Top performers this month!</Text>
                    </View>
                  </View>
                </View>

                {/* All Rankings Title */}
                <View className="bg-white rounded-tr-2xl rounded-tl-2xl shadow overflow-hidden mt-1">
                  <View className="p-4 border-b border-gray-200">
                    <Text className="text-xl font-bold text-gray-900">All Rankings</Text>
                  </View>
                </View>
              </>
            )}
          </View>
        )}
        renderItem={({ item }) => (
          item.__filler ? (
            <View className="h-16 bg-white" style={{ opacity: 0 }} />
          ) : (
          <View className={`flex-row justify-between items-center px-4 py-3 border-b border-gray-100 ${item.isYou ? "bg-green-50" : "bg-white"}`}>
            <Text className="text-base font-bold text-gray-900 w-10">#{item.rank}</Text>

            <View className="flex-1 px-2">
              <Text className="text-base font-semibold text-gray-900">{item.fullname}</Text>
              <Text className="text-xs text-gray-600 mt-0.5">{item.householdId}</Text>
              {item.isYou && (
                <Text className="mt-1 text-xs font-semibold bg-green-600 text-white px-2 py-0.5 rounded-full self-start">You</Text>
              )}
            </View>

            <View className="px-2">
              {item.tier ? (
                <Text className={`px-3 py-1 rounded-full text-xs font-semibold ${tierStyles[item.tier].bg} ${tierStyles[item.tier].text}`}>
                  {item.tier}
                </Text>
              ) : (
                <Text className="text-gray-500 text-sm px-3">—</Text>
              )}
            </View>

            <Text className="px-2 text-gray-700 text-sm">{item.disposals}</Text>
            <Text className="px-2 text-base font-bold text-green-700">{item.points}</Text>

            <View className="px-1">
              <Feather name="trending-up" size={18} color="#16A34A" />
            </View>
          </View>
          )
        )}
        ListFooterComponent={
          rankedData.length > 0 ? (
            <View className="bg-white px-4 pb-4 rounded-b-2xl shadow">
              <Pagination
                currentPage={rankingsPage}
                totalItems={rankedData.length}
                itemsPerPage={RANKINGS_PER_PAGE}
                onPageChange={setRankingsPage}
              />
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}
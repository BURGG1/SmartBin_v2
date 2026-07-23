import { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage"; // ⚠️ confirm this matches your actual token storage
import { API_BASE } from "@/config";

type Bin = {
  id: string;
  location: string;
  scheduleDate?: string;
  scheduleTime?: string;
  fill: number;
};

type CollectionActivity = {
  bin: string;
  location: string;
  date: string;
  time: string;
  status: string;
};

type Collector = {
  name: string;
};

export default function CollectorHome() {
  const [collector, setCollector] = useState<Collector | null>(null);
  const [assignedBins, setAssignedBins] = useState<Bin[]>([]);
  const [recentCollections, setRecentCollections] = useState<CollectionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await AsyncStorage.getItem("token"); // ⚠️ confirm key name matches your login flow
      const res = await fetch(`${API_BASE}/api/collectors/me/dashboard`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.status === 401) {
        throw new Error("Not authenticated — please log in again.");
      }
      if (!res.ok) {
        throw new Error(`Server responded ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to load dashboard.");

      setCollector(data.data.collector);
      setAssignedBins(data.data.assignedBins);
      setRecentCollections(data.data.recentCollections);
    } catch (err) {
      console.error("Failed to fetch collector dashboard:", err);
      const message = err instanceof Error ? err.message : "Could not load your dashboard. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-100 items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-gray-100 items-center justify-center px-6">
        <Text className="text-red-500 text-center mb-4">{error}</Text>
        <TouchableOpacity
          onPress={fetchDashboard}
          className="bg-green-600 px-4 py-2 rounded-lg"
        >
          <Text className="text-white font-semibold">Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-100">
      <ScrollView className="flex-1 px-4 py-2">
        {/* HEADER */}
        <View>
          <Text className="text-3xl font-bold">Collector Dashboard</Text>
          <Text className="text-gray-500 mb-6">
            Manage today's waste collection
          </Text>
        </View>

        {/* COLLECTOR INFO */}
        <View className="bg-green-600 rounded-xl shadow p-6 gap-4">
          <Text className="text-white">Welcome back,</Text>
          <Text className="text-3xl text-white font-bold">
            {collector?.name ?? "—"}
          </Text>
        </View>

        {/* ASSIGNED BINS */}
        <View className="bg-white rounded-xl p-6 shadow mt-5">
          <View className="flex-row items-center gap-2 mb-3">
            <Feather name="clipboard" size={18} color="green" />
            <Text className="text-lg font-semibold">Assigned Bins</Text>
          </View>

          {assignedBins.length === 0 ? (
            <Text className="text-gray-400 text-center py-4">
              No bins currently assigned
            </Text>
          ) : (
            assignedBins.map((bin, i) => (
              <TouchableOpacity
                key={bin.id}
                activeOpacity={0.7}
                onPress={() => {
                  router.push(
                    `/counterInfopage?bin=${encodeURIComponent(JSON.stringify(bin))}` as any
                  );
                }}
                className="flex-row justify-between items-center mb-3 border p-3 rounded-lg"
              >
                <View>
                  <Text className="text-lg font-semibold">{bin.id}</Text>
                  <Text className="text-sm text-gray-500">{bin.location}</Text>
                  <Text className="text-sm text-green-600">
                    {bin.scheduleDate
                      ? `Scheduled: ${bin.scheduleDate} • ${bin.scheduleTime}`
                      : "Not yet scheduled"}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text className="text-red-500 font-semibold">{bin.fill}%</Text>
                  <Feather name="chevron-right" size={18} color="#9ca3af" />
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* RECENT COLLECTION ACTIVITY */}
        <View className="bg-white rounded-xl p-6 shadow mt-5">
          <Text className="text-lg font-semibold mb-4">
            Recent Collection Activity
          </Text>

          {recentCollections.length === 0 ? (
            <Text className="text-gray-400 text-center py-4">
              No recent collections yet
            </Text>
          ) : (
            recentCollections.map((activity, i) => (
              <View
                key={i}
                className="flex-row justify-between items-center mb-3"
              >
                <View>
                  <Text className="font-medium">{activity.bin}</Text>
                  <Text className="text-xs text-gray-500">
                    {activity.location}
                  </Text>
                  <Text className="text-xs text-gray-400">
                    {activity.date} • {activity.time}
                  </Text>
                </View>

                <Text
                  className={`text-xs font-semibold ${activity.status === "Collected"
                    ? "text-green-600"
                    : "text-orange-500"
                    }`}
                >
                  {activity.status}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
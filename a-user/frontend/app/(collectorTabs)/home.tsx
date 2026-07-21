import { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { API_BASE } from "@/config"; // Import the API base URL

// Collector Info
const collector = {
  id: "WC-202610001",
  name: "Chito Miranda",
  assignedArea: "Barangay Pla",
  contact: "+63 917 123 4567",
  collectedToday: 2,
};

// Assigned Bins
const assignedBins = [
  {
    id: "BIN-001",
    location: "Rizal St.",
    fill: 95,
    scheduleDate: "Mar 16, 2026",
    scheduleTime: "10:00 AM",
  },
  {
    id: "BIN-002",
    location: "Rizal St.",
    fill: 92,
    scheduleDate: "Mar 16, 2026",
    scheduleTime: "11:30 AM",
  },
];

// Recent Activity
const recentCollections = [
  {
    bin: "BIN-002",
    location: "Rizal St.",
    date: "Mar 16, 2026",
    time: "08:45 AM",
    status: "Collected",
  },
  {
    bin: "BIN-004",
    location: "Mabini St.",
    date: "Mar 16, 2026",
    time: "08:20 AM",
    status: "Collected",
  },
  {
    bin: "BIN-003",
    location: "Bonifacio Ave.",
    date: "Mar 16, 2026",
    time: "07:50 AM",
    status: "Collected",
  },
  {
    bin: "BIN-001",
    location: "Rizal St.",
    date: "Mar 16, 2026",
    time: "Pending",
    status: "Pending",
  },
];

export default function CollectorHome() {
  const [search, setSearch] = useState("");

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
            {collector.name}
          </Text>
        </View>

        {/* ASSIGNED BINS */}
        <View className="bg-white rounded-xl p-6 shadow mt-5">
          <View className="flex-row items-center gap-2 mb-3">
            <Feather name="clipboard" size={18} color="green" />
            <Text className="text-lg font-semibold">Assigned Bins</Text>
          </View>

          {assignedBins.map((bin, i) => (
            <TouchableOpacity
              key={i}
              activeOpacity={0.7}
              onPress={() =>
                router.push({
                  pathname: "/counterInfopage",
                  params: { bin: JSON.stringify(bin) },
                })
              }
              className="flex-row justify-between items-center mb-3 border p-3 rounded-lg"
            >
              <View>
                <Text className="text-lg font-semibold">{bin.id}</Text>
                <Text className="text-sm text-gray-500">{bin.location}</Text>
                <Text className="text-sm text-green-600">
                  Scheduled: {bin.scheduleDate} • {bin.scheduleTime}
                </Text>
              </View>

              <View className="flex-row items-center gap-2">
                <Text className="text-red-500 font-semibold">{bin.fill}%</Text>
                <Feather name="chevron-right" size={18} color="#9ca3af" />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* RECENT COLLECTION ACTIVITY */}
        <View className="bg-white rounded-xl p-6 shadow mt-5">
          <Text className="text-lg font-semibold mb-4">
            Recent Collection Activity
          </Text>

          {recentCollections.map((activity, i) => (
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
                className={`text-xs font-semibold ${
                  activity.status === "Collected"
                    ? "text-green-600"
                    : "text-orange-500"
                }`}
              >
                {activity.status}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
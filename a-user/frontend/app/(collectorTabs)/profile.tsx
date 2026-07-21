import { useState, useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { API_BASE } from "@/config"; // Import the API base URL
import AsyncStorage from "@react-native-async-storage/async-storage";

const getInitials = (name = "") => {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
};

export default function CollectorProfile() {
  const router = useRouter();
  const [collector, setCollector] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const token = await AsyncStorage.getItem("token");
        const res = await fetch(`${API_BASE}/api/collectors/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (data.success) setCollector(data.data);
      } catch (err) {
        console.error("Failed to fetch collector profile:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleLogout = async () => {
    await AsyncStorage.removeItem("token");
    await AsyncStorage.removeItem("user");
    router.replace("/");
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#16A34A" />
      </SafeAreaView>
    );
  }

  if (!collector) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <Text className="text-gray-500">Failed to load profile.</Text>
      </SafeAreaView>
    );
  }

  // Identity fields live in the hero card; everything else groups below.
  const infoItems = [
    { label: "Employee ID", value: collector.employeeId, icon: "clipboard" },
    { label: "Assigned barangay", value: collector.assignedBarangay || "—", icon: "map-pin" },
    { label: "Contact number", value: collector.contact || "—", icon: "phone" },
    { label: "Email", value: collector.email, icon: "mail" },
    { label: "Total collections", value: `${collector.totalCollections} bins`, icon: "trash-2" },
  ];

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>

        <View className="px-5 pt-2 pb-5">
          <Text className="text-2xl font-bold text-gray-900">Collector Profile</Text>
          <Text className="text-gray-500 mt-0.5">View and manage collector information</Text>
        </View>

        {/* Hero identity card */}
        <View className="mx-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 items-center">
          <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-3">
            <Text className="text-green-700 text-lg font-bold">{getInitials(collector.name)}</Text>
          </View>
          <Text className="text-lg font-bold text-gray-900">{collector.name}</Text>
          <Text className="text-gray-500 text-sm mt-0.5">Waste collector</Text>
        </View>

        {/* Grouped info card */}
        <View className="mx-4 mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {infoItems.map((item, idx) => (
            <View
              key={item.label}
              className={`flex-row items-center gap-3 px-4 py-4 ${
                idx !== infoItems.length - 1 ? "border-b border-gray-100" : ""
              }`}
            >
              <View className="w-9 h-9 rounded-full bg-green-50 items-center justify-center">
                <Feather name={item.icon as any} size={16} color="#16A34A" />
              </View>
              <View className="ml-1 flex-1">
                <Text className="text-xs text-gray-500">{item.label}</Text>
                <Text className="text-sm font-semibold text-gray-900 mt-0.5">{item.value}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View className="mx-4 mt-5">
          <TouchableOpacity
            onPress={handleLogout}
            activeOpacity={0.8}
            className="w-full py-3.5 rounded-xl bg-gray-600 flex-row items-center justify-center"
          >
            <Feather name="log-out" size={16} color="white" />
            <Text className="text-white text-sm font-semibold ml-2">Logout</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
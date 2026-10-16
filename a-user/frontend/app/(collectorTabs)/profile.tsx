import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl, // NEW
} from "react-native";
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
  const [refreshing, setRefreshing] = useState(false); // NEW

  // NEW: moved out of useEffect (same code) so the refresh can call it again
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

  useEffect(() => {
    fetchProfile();
  }, []);

  // NEW: used by pull-to-refresh AND the refresh button
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  };

  const handleLogout = async () => {
    await AsyncStorage.removeItem("token");
    await AsyncStorage.removeItem("user");
    router.replace("/");
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#16A34A" />
        <Text className="text-gray-600 text-base mt-3">Loading profile...</Text>
      </SafeAreaView>
    );
  }

  if (!collector) {
    return (
      <SafeAreaView className="flex-1 bg-gray-50">
        {/* NEW: ScrollView so you can pull down to retry when loading failed */}
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16A34A" colors={["#16A34A"]} />
          }
        >
          <View className="w-16 h-16 rounded-full bg-red-100 items-center justify-center mb-4">
            <Feather name="alert-circle" size={30} color="#dc2626" />
          </View>
          <Text className="text-lg font-bold text-gray-900 mb-1">Failed to load profile</Text>
          <Text className="text-gray-600 text-base text-center mb-5">Pull down or tap the button to try again.</Text>
          <TouchableOpacity onPress={onRefresh} className="bg-green-600 px-6 py-3 rounded-xl">
            <Text className="text-white text-base font-semibold">Retry</Text>
          </TouchableOpacity>
        </ScrollView>
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
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16A34A" colors={["#16A34A"]} />
        }
      >

        <View className="px-5 pt-2 pb-5 flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-3xl font-bold text-gray-900">Collector Profile</Text>
            <Text className="text-base text-gray-600 mt-1">View and manage collector information</Text>
          </View>

    
        </View>

        {/* Hero identity card */}
        <View className="mx-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 items-center">
          <View className="w-20 h-20 rounded-full bg-green-100 items-center justify-center mb-3">
            <Text className="text-green-700 text-2xl font-bold">{getInitials(collector.name)}</Text>
          </View>
          <Text className="text-2xl font-bold text-gray-900">{collector.name}</Text>
          <View className="bg-green-100 rounded-full px-3 py-1 mt-2">
            <Text className="text-green-800 text-sm font-semibold">Waste collector</Text>
          </View>
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
              <View className="w-11 h-11 rounded-full bg-green-50 items-center justify-center">
                <Feather name={item.icon as any} size={20} color="#16A34A" />
              </View>
              <View className="ml-1 flex-1">
                <Text className="text-sm text-gray-600">{item.label}</Text>
                <Text className="text-base font-semibold text-gray-900 mt-0.5">{item.value}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View className="mx-4 mt-5">
          <TouchableOpacity
            onPress={handleLogout}
            activeOpacity={0.8}
            className="w-full py-4 rounded-xl bg-gray-700 flex-row items-center justify-center"
          >
            <Feather name="log-out" size={18} color="white" />
            <Text className="text-white text-base font-semibold ml-2">Logout</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
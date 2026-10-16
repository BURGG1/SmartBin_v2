import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { API_BASE } from "@/config";
import AsyncStorage from "@react-native-async-storage/async-storage";

const getInitials = (name = "") => {
  const trimmed = (name || "").trim();
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
  const [refreshing, setRefreshing] = useState(false);

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

  // used by pull-to-refresh AND the retry button
  const onRefresh = async () => {
    setRefreshing(true);
    await fetchProfile();
    setRefreshing(false);
  };

  const performLogout = async () => {
    await AsyncStorage.removeItem("token");
    await AsyncStorage.removeItem("user");
    router.replace("/");
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: performLogout },
    ]);
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

  // Key figures shown as tiles in the hero card (same pattern as the household profile)
  const stats = [
    { label: "Collections", value: String(collector.totalCollections ?? 0), icon: "trash-2" },
    { label: "Barangay", value: collector.assignedBarangay || "—", icon: "map-pin" },
  ];

  const detailItems = [
    { label: "Employee ID", value: collector.employeeId || "—", icon: "clipboard" },
    { label: "Contact number", value: collector.contact || "—", icon: "phone" },
    { label: "Email", value: collector.email || "—", icon: "mail" },
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
        <View className="px-5 pt-2 pb-4">
          <Text className="text-3xl font-bold text-gray-900">Collector Profile</Text>
          <Text className="text-base text-gray-600 mt-1">View and manage collector information</Text>
        </View>

        {/* Hero card: green banner, overlapping avatar, stat tiles */}
        <View className="mx-4 bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <View className="h-24 bg-green-600">
            <View className="absolute -right-6 -top-8 w-32 h-32 rounded-full bg-green-500/60" />
            <View className="absolute right-16 top-10 w-16 h-16 rounded-full bg-green-700/40" />
            <View className="absolute -left-4 top-12 w-20 h-20 rounded-full bg-green-500/40" />
          </View>

          <View className="px-5 pb-5 items-center">
            <View className="-mt-10 w-20 h-20 rounded-full bg-green-100 border-4 border-white items-center justify-center shadow-sm">
              <Text className="text-green-700 text-2xl font-bold">{getInitials(collector.name)}</Text>
            </View>
            <Text className="text-2xl font-bold text-gray-900 text-center mt-3">{collector.name || "—"}</Text>
            <View className="flex-row items-center bg-green-100 rounded-full px-3 py-1 mt-2">
              <Feather name="truck" size={13} color="#166534" />
              <Text className="text-green-800 text-sm font-semibold ml-1.5">Waste collector</Text>
            </View>

            <View className="flex-row w-full mt-5 gap-3">
              {stats.map((st) => (
                <View
                  key={st.label}
                  accessible
                  accessibilityLabel={`${st.label}: ${st.value}`}
                  className="flex-1 items-center rounded-2xl py-4 px-2 bg-gray-50"
                >
                  <View className="w-9 h-9 rounded-full items-center justify-center bg-green-100">
                    <Feather name={st.icon as any} size={18} color="#16A34A" />
                  </View>
                  <Text
                    className="text-2xl font-extrabold mt-2 text-gray-900 text-center"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {st.value}
                  </Text>
                  <Text className="text-sm text-gray-600">{st.label}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Collector details */}
        <View className="mx-5 mt-6 mb-2">
          <Text className="text-sm font-bold text-gray-600 tracking-wide">COLLECTOR DETAILS</Text>
        </View>
        <View className="mx-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {detailItems.map((item, idx) => (
            <View
              key={item.label}
              className={`flex-row items-center gap-3 px-4 py-4 ${
                idx !== detailItems.length - 1 ? "border-b border-gray-100" : ""
              }`}
            >
              <View className="w-11 h-11 rounded-full items-center justify-center bg-green-50">
                <Feather name={item.icon as any} size={20} color="#16A34A" />
              </View>
              <View className="ml-1 flex-1">
                <Text className="text-sm text-gray-600">{item.label}</Text>
                <Text className="text-base font-semibold mt-0.5 text-gray-900">{item.value}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View className="mx-4 mt-5">
          <TouchableOpacity
            onPress={handleLogout}
            accessibilityRole="button"
            activeOpacity={0.8}
            className="w-full py-4 rounded-xl bg-white border border-gray-300 flex-row items-center justify-center"
          >
            <Feather name="log-out" size={18} color="#374151" />
            <Text className="text-gray-700 text-base font-semibold ml-2">Logout</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
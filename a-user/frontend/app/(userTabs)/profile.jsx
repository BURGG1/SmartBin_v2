import { useState, useCallback } from "react";
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
    RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { API_BASE } from "@/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import EditHousehold from "@/components/EditHouseholdModal";
import ChangePassword from "@/components/ChangePasswordModal";

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

// 09171234567 -> 0917 123 4567
const formatContact = (n) => {
    if (!n) return "—";
    const d = String(n).replace(/\D/g, "");
    return d.length === 11 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : String(n);
};

export default function Profile() {
    const router = useRouter();
    const [household, setHousehold] = useState(null);
    // null = not loaded yet. Comes from the /violations endpoint (same one the Home tab uses).
    const [violationCount, setViolationCount] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isPasswordOpen, setIsPasswordOpen] = useState(false);

    // Total violations on record. limit=1 keeps the request tiny; we only need pagination.total.
    const fetchViolationCount = async (userId, token) => {
        try {
            const res = await fetch(
                `${API_BASE}/api/households/${userId}/violations?page=1&limit=1`,
                { headers: token ? { Authorization: `Bearer ${token}` } : {} }
            );
            const data = await res.json();
            if (data.success) {
                setViolationCount(
                    data.pagination?.total ?? (Array.isArray(data.data) ? data.data.length : 0)
                );
            }
        } catch (err) {
            console.error("Failed to fetch violations:", err);
        }
    };

    const fetchHousehold = async () => {
        try {
            const token = await AsyncStorage.getItem("token");
            const userStr = await AsyncStorage.getItem("user");
            const user = userStr ? JSON.parse(userStr) : null;
            if (!user?.id) return;

            const violationPromise = fetchViolationCount(user.id, token);

            const res = await fetch(`${API_BASE}/api/households/${user.id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (data.success) {
                setHousehold(data.data);
            }
            await violationPromise;
        } catch (err) {
            console.error("Failed to fetch household:", err);
        } finally {
            setLoading(false);
        }
    };

    // Runs on first open AND every time the tab regains focus.
    useFocusEffect(
        useCallback(() => {
            fetchHousehold();
        }, [])
    );

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchHousehold();
        setRefreshing(false);
    };

    const handleLogout = () => {
        Alert.alert("Log out", "Are you sure you want to log out?", [
            { text: "Cancel", style: "cancel" },
            {
                text: "Log out",
                style: "destructive",
                onPress: async () => {
                    await AsyncStorage.removeItem("token");
                    await AsyncStorage.removeItem("user");
                    router.replace("/");
                },
            },
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

    const fullAddress =
        [household?.address?.houseNo, household?.address?.street].filter(Boolean).join(", ") || "—";

    const hasViolations = (violationCount ?? 0) > 0;

    const detailItems = [
        { label: "Address", value: fullAddress, icon: "map-pin" },
        { label: "Contact number", value: formatContact(household?.contactNumber), icon: "phone" },
        { label: "Email", value: household?.email || "—", icon: "mail" },
        {
            label: "Family members",
            value: household?.familyMember
                ? `${household.familyMember} ${household.familyMember === 1 ? "person" : "people"}`
                : "—",
            icon: "users",
        },
    ];

    const stats = [
        { label: "Points", value: String(household?.points?.total ?? 0), icon: "award", danger: false },
        {
            label: "Violations",
            value: violationCount === null ? "—" : String(violationCount),
            icon: "alert-triangle",
            danger: hasViolations,
        },
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
                    <Text className="text-3xl font-bold text-gray-900">Household Profile</Text>
                    <Text className="text-base text-gray-600 mt-1">View and manage your household information</Text>
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
                            <Text className="text-green-700 text-2xl font-bold">{getInitials(household?.fullname)}</Text>
                        </View>
                        <Text className="text-2xl font-bold text-gray-900 text-center mt-3">
                            {household?.fullname || "—"}
                        </Text>
                        <View className="flex-row items-center bg-green-100 rounded-full px-3 py-1 mt-2">
                            <Feather name="home" size={13} color="#166534" />
                            <Text className="text-green-800 text-sm font-semibold ml-1.5">Household account</Text>
                        </View>

                        <View className="flex-row w-full mt-5 gap-3">
                            {stats.map((st) => (
                                <View
                                    key={st.label}
                                    accessible
                                    accessibilityLabel={`${st.label}: ${st.value}`}
                                    className={`flex-1 items-center rounded-2xl py-4 ${st.danger ? "bg-red-50" : "bg-gray-50"}`}
                                >
                                    <View
                                        className={`w-9 h-9 rounded-full items-center justify-center ${st.danger ? "bg-red-100" : "bg-green-100"
                                            }`}
                                    >
                                        <Feather name={st.icon} size={18} color={st.danger ? "#DC2626" : "#16A34A"} />
                                    </View>
                                    <Text
                                        className={`text-2xl font-extrabold mt-2 ${st.danger ? "text-red-600" : "text-gray-900"}`}
                                    >
                                        {st.value}
                                    </Text>
                                    <Text className="text-sm text-gray-600">{st.label}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                </View>

                {/* Account standing */}
                {violationCount !== null && (
                    <View
                        className={`mx-4 mt-4 rounded-2xl border p-4 flex-row items-center gap-3 ${hasViolations ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"
                            }`}
                    >
                        <View
                            className={`w-11 h-11 rounded-full items-center justify-center ${hasViolations ? "bg-red-100" : "bg-green-100"
                                }`}
                        >
                            <Feather
                                name={hasViolations ? "alert-triangle" : "check-circle"}
                                size={22}
                                color={hasViolations ? "#B91C1C" : "#15803D"}
                            />
                        </View>
                        <View className="flex-1">
                            <Text className={`text-base font-semibold ${hasViolations ? "text-red-700" : "text-green-800"}`}>
                                {hasViolations
                                    ? `${violationCount} ${violationCount === 1 ? "violation" : "violations"} on record`
                                    : "Good standing"}
                            </Text>
                            <Text className={`text-sm mt-0.5 ${hasViolations ? "text-red-600" : "text-green-700"}`}>
                                {hasViolations
                                    ? "Check the Rules tab for recent penalties."
                                    : "No violations on record. Keep it up!"}
                            </Text>
                        </View>
                    </View>
                )}

                {/* Household details */}
                <View className="mx-5 mt-6 mb-2 flex-row items-center justify-between">
                    <Text className="text-sm font-bold text-gray-600 tracking-wide">HOUSEHOLD DETAILS</Text>
                    {/* <TouchableOpacity
                        onPress={() => setIsModalOpen(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Edit household information"
                        hitSlop={8}
                        className="flex-row items-center"
                    >
                        <Feather name="edit-2" size={14} color="#15803d" />
                        <Text className="text-green-700 text-sm font-semibold ml-1">Edit</Text>
                    </TouchableOpacity> */}
                </View>
                
                <View className="mx-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {detailItems.map((item, idx) => (
                        <View
                            key={item.label}
                            className={`flex-row items-center gap-3 px-4 py-4 ${idx !== detailItems.length - 1 ? "border-b border-gray-100" : ""
                                }`}
                        >
                            <View className="w-11 h-11 rounded-full items-center justify-center bg-green-50">
                                <Feather name={item.icon} size={20} color="#16A34A" />
                            </View>
                            <View className="ml-1 flex-1">
                                <Text className="text-sm text-gray-600">{item.label}</Text>
                                <Text className="text-base font-semibold mt-0.5 text-gray-900">{item.value}</Text>
                            </View>
                        </View>
                    ))}
                </View>
{/* Security */}
                <Text className="mx-5 mt-6 mb-2 text-sm font-bold text-gray-600 tracking-wide">SECURITY</Text>
                <TouchableOpacity
                    onPress={() => setIsPasswordOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Change password"
                    activeOpacity={0.7}
                    className="mx-4 bg-white rounded-2xl border border-gray-100 shadow-sm flex-row items-center gap-3 px-4 py-4"
                >
                    <View className="w-11 h-11 rounded-full items-center justify-center bg-green-50">
                        <Feather name="lock" size={20} color="#16A34A" />
                    </View>
                    <View className="ml-1 flex-1">
                        <Text className="text-base font-semibold text-gray-900">Change password</Text>
                        <Text className="text-sm text-gray-600 mt-0.5">Update the password you use to log in</Text>
                    </View>
                    <Feather name="chevron-right" size={20} color="#9CA3AF" />
                </TouchableOpacity>
                {/* Actions */}
                <View className="mx-4 mt-5 gap-3">
                    <TouchableOpacity
                        onPress={() => router.push("/terms_condition")}
                        accessibilityRole="button"
                        accessibilityLabel="View Terms and Conditions"
                        activeOpacity={0.8}
                        className="w-full py-4 rounded-xl bg-white border border-gray-300 flex-row items-center justify-center"
                    >
                        <Feather name="file-text" size={18} color="#374151" />
                        <Text className="text-gray-700 text-base font-semibold ml-2">Terms & Conditions</Text>
                    </TouchableOpacity>

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
            <ChangePassword
                isOpen={isPasswordOpen}
                onClose={() => setIsPasswordOpen(false)}
                household={household}
            />
            <EditHousehold
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                household={household}
                onSaved={fetchHousehold}
            />
        </SafeAreaView>
    );
}
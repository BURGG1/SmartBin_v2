import { useState, useCallback } from "react";
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    TextInput,
    Alert,
    ActivityIndicator,
    Modal,
    KeyboardAvoidingView,
    Platform,
    RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { API_BASE } from "@/config";
import AsyncStorage from "@react-native-async-storage/async-storage";

const PH_MOBILE_REGEX = /^09\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the backend's normalizeContactNumber so this screen agrees with
// the admin panel / registration forms / server on a single canonical
// "09XXXXXXXXX" format before validating, checking, or submitting.
const normalizeContactNumber = (input) => {
    if (!input || typeof input !== "string") return null;

    let digits = input.replace(/\D/g, "");

    if (digits.startsWith("63") && digits.length === 12) {
        digits = "0" + digits.slice(2);
    } else if (digits.length === 10 && digits.startsWith("9")) {
        digits = "0" + digits;
    }

    return digits;
};

// Strips the leading "0" so the number can be shown next to a fixed "+63" prefix
const toLocalDisplay = (contactNumber) => {
    if (!contactNumber) return "";
    return contactNumber.startsWith("0") ? contactNumber.slice(1) : contactNumber;
};

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
    const [updating, setUpdating] = useState(false);
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const [form, setForm] = useState({
        fullname: "",
        contactNumber: "", // local part only, no leading 0 (paired with fixed +63 prefix)
        houseNo: "",
        street: "",
        familyMember: "",
        email: "",
    });

    const [formErrors, setFormErrors] = useState({});

    const [passwordForm, setPasswordForm] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
    });

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
                setForm({
                    fullname: data.data.fullname || "",
                    contactNumber: toLocalDisplay(data.data.contactNumber),
                    houseNo: data.data.address?.houseNo || "",
                    street: data.data.address?.street || "",
                    familyMember: data.data.familyMember?.toString() || "",
                    email: data.data.email || "",
                });
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

    // ── Availability checks (same pattern as registration forms) ──
    const isEmailTaken = async (email) => {
        try {
            const res = await fetch(
                `${API_BASE}/api/households/check-email?email=${encodeURIComponent(email)}`
            );
            const data = await res.json();
            if (!data?.success) return false; // fail open, server still enforces uniqueness
            return !!data.exists;
        } catch (err) {
            console.error("Email check failed:", err);
            return false;
        }
    };

    const isContactTaken = async (contactNumber) => {
        try {
            const res = await fetch(
                `${API_BASE}/api/households/check-contact?contactNumber=${encodeURIComponent(contactNumber)}`
            );
            const data = await res.json();
            if (!data?.success) return false;
            return !!data.exists;
        } catch (err) {
            console.error("Contact check failed:", err);
            return false;
        }
    };

    const resetModalState = () => {
        setIsModalOpen(false);
        setFormErrors({});
        setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
        setShowCurrentPassword(false);
        setShowNewPassword(false);
        setShowConfirmPassword(false);
    };

    const handleUpdate = async () => {
        const nextErrors = {};

        if (!form.fullname.trim()) {
            nextErrors.fullname = "Fullname is required.";
        }

        const normalizedContact = normalizeContactNumber(form.contactNumber.trim());
        if (!form.contactNumber.trim()) {
            nextErrors.contactNumber = "Contact number is required.";
        } else if (!normalizedContact || !PH_MOBILE_REGEX.test(normalizedContact)) {
            nextErrors.contactNumber = "Enter a valid contact number, e.g. 912-345-6789.";
        }

        const normalizedEmail = form.email.trim() ? form.email.trim().toLowerCase() : "";
        if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
            nextErrors.email = "Enter a valid email address.";
        }

        setFormErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;

        // Only re-check availability if the value actually changed
        const contactChanged = normalizedContact !== household?.contactNumber;
        const emailChanged = normalizedEmail !== (household?.email || "");

        setUpdating(true);
        try {
            const [contactTaken, emailTaken] = await Promise.all([
                contactChanged ? isContactTaken(normalizedContact) : Promise.resolve(false),
                emailChanged && normalizedEmail ? isEmailTaken(normalizedEmail) : Promise.resolve(false),
            ]);

            const conflictErrors = {};
            if (contactTaken) conflictErrors.contactNumber = "This contact number is already registered.";
            if (emailTaken) conflictErrors.email = "This email is already registered.";

            if (Object.keys(conflictErrors).length > 0) {
                setFormErrors((prev) => ({ ...prev, ...conflictErrors }));
                return;
            }
        } catch (err) {
            Alert.alert("Error", "Could not verify contact/email availability. Please try again.");
            return;
        } finally {
            setUpdating(false);
        }

        // Validate password fields if any are filled
        if (passwordForm.currentPassword || passwordForm.newPassword || passwordForm.confirmPassword) {
            if (!passwordForm.currentPassword) {
                Alert.alert("Error", "Please enter your current password.");
                return;
            }
            if (!passwordForm.newPassword) {
                Alert.alert("Error", "Please enter a new password.");
                return;
            }
            if (passwordForm.newPassword.length < 6) {
                Alert.alert("Error", "New password must be at least 6 characters.");
                return;
            }
            if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                Alert.alert("Error", "New passwords do not match.");
                return;
            }
        }

        setUpdating(true);
        try {
            const token = await AsyncStorage.getItem("token");
            const userStr = await AsyncStorage.getItem("user");
            const user = userStr ? JSON.parse(userStr) : null;

            const body = {
                fullname: form.fullname.trim(),
                contactNumber: normalizedContact,
                address: {
                    houseNo: form.houseNo.trim(),
                    street: form.street.trim(),
                },
                familyMember: form.familyMember ? parseInt(form.familyMember, 10) : null,
                email: normalizedEmail || null,
            };

            if (passwordForm.currentPassword && passwordForm.newPassword) {
                body.currentPassword = passwordForm.currentPassword;
                body.newPassword = passwordForm.newPassword;
            }

            const res = await fetch(`${API_BASE}/api/households/${user.id}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                const message = Array.isArray(data.message) ? data.message.join("\n") : data.message;
                Alert.alert("Error", message || "Failed to update.");
                return;
            }

            Alert.alert("Success", "Profile updated successfully!");
            resetModalState();
            fetchHousehold();
        } catch (err) {
            Alert.alert("Error", "Cannot connect to server.");
        } finally {
            setUpdating(false);
        }
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

    // ── Form helpers (plain render functions, not components, so inputs keep focus) ──
    const clearError = (key) => {
        if (formErrors[key]) setFormErrors((prev) => ({ ...prev, [key]: undefined }));
    };

    const renderInput = ({ label, key, placeholder, required, keyboard, icon }) => (
        <View key={key}>
            <Text className="text-sm font-semibold mb-1.5 text-gray-700">
                {label}
                {required && <Text className="text-red-500"> *</Text>}
            </Text>
            <View
                className={`flex-row items-center border rounded-xl px-3.5 bg-gray-50 ${formErrors[key] ? "border-red-500" : "border-gray-300"
                    }`}
            >
                {icon && <Feather name={icon} size={18} color="#9CA3AF" />}
                <TextInput
                    editable={!updating}
                    value={form[key]}
                    onChangeText={(v) => {
                        setForm((prev) => ({ ...prev, [key]: v }));
                        clearError(key);
                    }}
                    placeholder={placeholder}
                    placeholderTextColor="#9CA3AF"
                    keyboardType={keyboard || "default"}
                    autoCapitalize={key === "email" ? "none" : "sentences"}
                    className="flex-1 py-3 ml-2.5 text-base text-gray-900"
                />
            </View>
            {formErrors[key] && <Text className="text-red-600 text-sm mt-1">{formErrors[key]}</Text>}
        </View>
    );

    const renderPasswordInput = ({ label, value, onChange, placeholder, show, setShow }) => (
        <View>
            <Text className="text-sm font-semibold mb-1.5 text-gray-700">{label}</Text>
            <View className="flex-row items-center border rounded-xl px-3.5 border-gray-300 bg-gray-50">
                <Feather name="lock" size={18} color="#9CA3AF" />
                <TextInput
                    editable={!updating}
                    value={value}
                    onChangeText={onChange}
                    placeholder={placeholder}
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!show}
                    autoCapitalize="none"
                    className="flex-1 py-3 ml-2.5 text-base text-gray-900"
                />
                <TouchableOpacity onPress={() => setShow(!show)} hitSlop={8}>
                    <Feather name={show ? "eye-off" : "eye"} size={20} color="#6B7280" />
                </TouchableOpacity>
            </View>
        </View>
    );

    const renderSectionTitle = (title) => (
        <Text className="text-xs font-bold text-green-700 tracking-widest mb-3">{title}</Text>
    );

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
                    <TouchableOpacity
                        onPress={() => setIsModalOpen(true)}
                        accessibilityRole="button"
                        accessibilityLabel="Edit household information"
                        hitSlop={8}
                        className="flex-row items-center"
                    >
                        <Feather name="edit-2" size={14} color="#15803d" />
                        <Text className="text-green-700 text-sm font-semibold ml-1">Edit</Text>
                    </TouchableOpacity>
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

                {/* Actions */}
                <View className="mx-4 mt-5 gap-3">
                    {/* <TouchableOpacity
                        onPress={() => setIsModalOpen(true)}
                        accessibilityRole="button"
                        activeOpacity={0.85}
                        className="w-full py-4 rounded-xl bg-green-600 flex-row items-center justify-center"
                    >
                        <Feather name="edit-2" size={18} color="white" />
                        <Text className="text-white text-base font-semibold ml-2">Update information</Text>
                    </TouchableOpacity> */}

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

            {/* Edit modal: bottom sheet with sticky header and footer */}
            <Modal
                visible={isModalOpen}
                animationType="slide"
                transparent
                onRequestClose={() => !updating && resetModalState()}
            >
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1">
                    <View className="flex-1 bg-black/40 justify-end">
                        <View className="bg-white rounded-t-3xl" style={{ maxHeight: "92%" }}>
                            {/* Header */}
                            <View className="px-5 pt-5 pb-4 border-b border-gray-100 flex-row items-center justify-between">
                                <View className="flex-1 pr-3">
                                    <Text className="text-xl font-bold text-gray-900">Update Information</Text>
                                    <Text className="text-sm text-gray-500 mt-0.5">Fields marked * are required</Text>
                                </View>
                                <TouchableOpacity
                                    onPress={() => !updating && resetModalState()}
                                    accessibilityLabel="Close"
                                    className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center"
                                >
                                    <Feather name="x" size={20} color="#4B5563" />
                                </TouchableOpacity>
                            </View>

                            {/* Body */}
                            <ScrollView
                                keyboardShouldPersistTaps="handled"
                                showsVerticalScrollIndicator={false}
                                contentContainerStyle={{ padding: 20, paddingBottom: 12 }}
                            >
                                {/* Personal */}
                                <View className="mb-6 gap-4">
                                    {renderSectionTitle("PERSONAL")}
                                    {renderInput({
                                        label: "Fullname",
                                        key: "fullname",
                                        placeholder: "ex. Joel Dela Cruz",
                                        required: true,
                                        icon: "user",
                                    })}
                                    {renderInput({
                                        label: "Family Members",
                                        key: "familyMember",
                                        placeholder: "ex. 5",
                                        keyboard: "numeric",
                                        icon: "users",
                                    })}
                                </View>

                                {/* Address */}
                                <View className="mb-6 gap-4">
                                    {renderSectionTitle("ADDRESS")}
                                    {renderInput({ label: "House No.", key: "houseNo", placeholder: "ex. 0123", icon: "home" })}
                                    {renderInput({ label: "Street / Block", key: "street", placeholder: "ex. Rizal St.", icon: "map-pin" })}
                                </View>

                                {/* Contact */}
                                <View className="mb-6 gap-4">
                                    {renderSectionTitle("CONTACT")}
                                    <View>
                                        <Text className="text-sm font-semibold mb-1.5 text-gray-700">
                                            Contact Number
                                            <Text className="text-red-500"> *</Text>
                                        </Text>
                                        <View
                                            className={`flex-row items-center border rounded-xl overflow-hidden bg-gray-50 ${formErrors.contactNumber ? "border-red-500" : "border-gray-300"
                                                }`}
                                        >
                                            <View className="bg-gray-100 px-3.5 py-3 border-r border-gray-200">
                                                <Text className="text-gray-800 text-base font-medium">🇵🇭 +63</Text>
                                            </View>
                                            <TextInput
                                                editable={!updating}
                                                value={form.contactNumber}
                                                onChangeText={(v) => {
                                                    // digits and dashes only
                                                    const cleaned = v.replace(/[^\d-]/g, "");
                                                    setForm((prev) => ({ ...prev, contactNumber: cleaned }));
                                                    clearError("contactNumber");
                                                }}
                                                placeholder="912-345-6789"
                                                placeholderTextColor="#9CA3AF"
                                                keyboardType="phone-pad"
                                                maxLength={10}
                                                className="flex-1 px-4 py-3 text-base text-gray-900"
                                            />
                                        </View>
                                        {formErrors.contactNumber && (
                                            <Text className="text-red-600 text-sm mt-1">{formErrors.contactNumber}</Text>
                                        )}
                                    </View>
                                    {renderInput({
                                        label: "Email",
                                        key: "email",
                                        placeholder: "ex. joel@email.com",
                                        keyboard: "email-address",
                                        icon: "mail",
                                    })}
                                </View>

                                {/* Password */}
                                <View className="gap-4 rounded-2xl bg-gray-50 border border-gray-100 p-4">
                                    <View>
                                        {renderSectionTitle("CHANGE PASSWORD")}
                                        <Text className="text-sm text-gray-500 -mt-1.5">
                                            Leave blank if you don't want to change your password.
                                        </Text>
                                    </View>
                                    {renderPasswordInput({
                                        label: "Current Password",
                                        value: passwordForm.currentPassword,
                                        onChange: (v) => setPasswordForm((prev) => ({ ...prev, currentPassword: v })),
                                        placeholder: "Enter current password",
                                        show: showCurrentPassword,
                                        setShow: setShowCurrentPassword,
                                    })}
                                    {renderPasswordInput({
                                        label: "New Password",
                                        value: passwordForm.newPassword,
                                        onChange: (v) => setPasswordForm((prev) => ({ ...prev, newPassword: v })),
                                        placeholder: "At least 6 characters",
                                        show: showNewPassword,
                                        setShow: setShowNewPassword,
                                    })}
                                    {renderPasswordInput({
                                        label: "Confirm New Password",
                                        value: passwordForm.confirmPassword,
                                        onChange: (v) => setPasswordForm((prev) => ({ ...prev, confirmPassword: v })),
                                        placeholder: "Re-enter new password",
                                        show: showConfirmPassword,
                                        setShow: setShowConfirmPassword,
                                    })}
                                </View>
                            </ScrollView>

                            {/* Footer */}
                            <View className="px-5 pt-3 pb-6 border-t border-gray-100 flex-row gap-3">
                                <TouchableOpacity
                                    onPress={() => !updating && resetModalState()}
                                    disabled={updating}
                                    activeOpacity={0.7}
                                    className="flex-1 py-4 rounded-xl border border-gray-300 items-center justify-center"
                                    style={{ opacity: updating ? 0.5 : 1 }}
                                >
                                    <Text className="text-gray-700 text-base font-semibold">Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={handleUpdate}
                                    disabled={updating}
                                    activeOpacity={0.85}
                                    className="flex-1 bg-green-600 py-4 rounded-xl items-center justify-center"
                                    style={{ opacity: updating ? 0.6 : 1 }}
                                >
                                    {updating ? (
                                        <View className="flex-row items-center">
                                            <ActivityIndicator size="small" color="#fff" />
                                            <Text className="text-white text-base font-semibold ml-2">Saving...</Text>
                                        </View>
                                    ) : (
                                        <Text className="text-white text-base font-semibold">Save Changes</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}
import { useState, useEffect } from "react";
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
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
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

// Strips the leading "0" so the number can be shown next to a fixed
// "+63" prefix, matching the AddHousehold UI (e.g. "09171234567" -> "9171234567")
const toLocalDisplay = (contactNumber) => {
    if (!contactNumber) return "";
    return contactNumber.startsWith("0") ? contactNumber.slice(1) : contactNumber;
};

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

export default function Profile() {
    const router = useRouter();
    const [household, setHousehold] = useState(null);
    const [loading, setLoading] = useState(true);
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

    const fetchHousehold = async () => {
        try {
            const token = await AsyncStorage.getItem("token");
            const userStr = await AsyncStorage.getItem("user");
            const user = userStr ? JSON.parse(userStr) : null;
            if (!user?.id) return;

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
        } catch (err) {
            console.error("Failed to fetch household:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchHousehold();
    }, []);

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

        // ── Fullname: required ──
        if (!form.fullname.trim()) {
            nextErrors.fullname = "Fullname is required.";
        }

        // ── Contact number: required, format-validated ──
        // form.contactNumber only holds the local part (no leading 0),
        // normalizeContactNumber re-attaches it to the canonical "09XXXXXXXXX" form.
        const normalizedContact = normalizeContactNumber(form.contactNumber.trim());
        if (!form.contactNumber.trim()) {
            nextErrors.contactNumber = "Contact number is required.";
        } else if (!normalizedContact || !PH_MOBILE_REGEX.test(normalizedContact)) {
            nextErrors.contactNumber = "Enter a valid contact number, e.g. 912-345-6789.";
        }

        // ── Email: only validate format if provided ──
        const normalizedEmail = form.email.trim() ? form.email.trim().toLowerCase() : "";
        if (normalizedEmail && !EMAIL_REGEX.test(normalizedEmail)) {
            nextErrors.email = "Enter a valid email address.";
        }

        setFormErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;

        // ── Only re-check availability if the value actually changed ──
        // Prevents false "already registered" hits against the user's own
        // current contact number / email.
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

            // Only include password fields if user wants to change it
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
                // Surface server-side uniqueness/validation errors (e.g. race condition
                // where someone else took the number between check and submit)
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

    const fullAddress =
        [household?.address?.houseNo, household?.address?.street].filter(Boolean).join(", ") || "—";

    // NOTE: adjust these field names to match whatever your API actually
    // returns for violations (e.g. household?.violations, household?.flaggedCount).
    const violationCount = household?.violationCount ?? household?.violations ?? 0;
    const hasViolations = violationCount > 0;

    const infoItems = [
        { label: "Address", value: fullAddress, icon: "map-pin" },
        { label: "Contact number", value: household?.contactNumber ? `+63 ${household.contactNumber}` : "—", icon: "phone" },
        { label: "Email", value: household?.email || "—", icon: "mail" },
        {
            label: "Family members",
            value: household?.familyMember ? `${household.familyMember} ${household.familyMember === 1 ? "person" : "people"}` : "—",
            icon: "users",
        },
        {
            label: "Reward points",
            value: `${household?.points?.total ?? 0} pts · +${household?.points?.thisMonth ?? 0} this month`,
            icon: "award",
        },
        {
            label: "Violations",
            value: hasViolations ? `${violationCount} flagged` : "No flags on record",
            icon: "alert-triangle",
            danger: hasViolations,
        },
    ];

    // Generic fields — contact number is handled separately below with
    // the +63 prefixed input to match AddHousehold's UI.
    const genericFields = [
        { label: "Fullname", key: "fullname", placeholder: "ex. Joel Dela Cruz", required: true },
        { label: "House No.", key: "houseNo", placeholder: "ex. 0123" },
        { label: "Street / Block", key: "street", placeholder: "ex. Rizal St." },
        { label: "Family Members", key: "familyMember", placeholder: "ex. 5", keyboard: "numeric" },
        { label: "Email", key: "email", placeholder: "ex. joel@email.com", keyboard: "email-address" },
    ];

    return (
        <SafeAreaView className="flex-1 bg-gray-50">
            <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: 32 }}>

                <View className="px-5 pt-2 pb-5">
                    <Text className="text-2xl font-bold text-gray-900">Household Profile</Text>
                    <Text className="text-gray-500 mt-0.5">View and manage your household information</Text>
                </View>

                {/* Hero identity card */}
                <View className="mx-4 bg-white rounded-2xl border border-gray-100 shadow-sm p-5 items-center">
                    <View className="w-16 h-16 rounded-full bg-green-100 items-center justify-center mb-3">
                        <Text className="text-green-700 text-lg font-bold">{getInitials(household?.fullname)}</Text>
                    </View>
                    <Text className="text-lg font-bold text-gray-900">{household?.fullname || "—"}</Text>
                    <Text className="text-gray-500 text-sm mt-0.5">Household account</Text>
                </View>

                {/* Grouped info card */}
                <View className="mx-4 mt-4 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {infoItems.map((item, idx) => (
                        <View
                            key={item.label}
                            className={`flex-row items-center gap-3 px-4 py-4 ${idx !== infoItems.length - 1 ? "border-b border-gray-100" : ""
                                }`}
                        >
                            <View className={`w-9 h-9 rounded-full items-center justify-center ${item.danger ? "bg-red-50" : "bg-green-50"}`}>
                                <Feather name={item.icon} size={16} color={item.danger ? "#DC2626" : "#16A34A"} />
                            </View>
                            <View className="ml-1 flex-1">
                                <Text className="text-xs text-gray-500">{item.label}</Text>
                                <Text className={`text-sm font-semibold mt-0.5 ${item.danger ? "text-red-600" : "text-gray-900"}`}>
                                    {item.value}
                                </Text>
                            </View>
                        </View>
                    ))}
                </View>

                {/* Actions */}
                <View className="mx-4 mt-5 gap-3">
                    <TouchableOpacity
                        onPress={() => setIsModalOpen(true)}
                        activeOpacity={0.8}
                        className="w-full py-3.5 rounded-xl border border-green-600 items-center bg-white"
                    >
                        <Text className="text-green-700 text-sm font-semibold">Update information</Text>
                    </TouchableOpacity>

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

            {/* Edit Modal */}
            <Modal visible={isModalOpen} animationType="slide" transparent onRequestClose={() => !updating && resetModalState()}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === "ios" ? "padding" : undefined}
                    className="flex-1"
                >
                    <View className="flex-1 bg-black/40 justify-center items-center p-4">
                        <ScrollView className="w-full" contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}>
                            <View className="bg-white w-full rounded-2xl p-6 gap-4">

                                <View className="flex-row justify-between items-center mb-1">
                                    <Text className="text-lg font-bold text-gray-900">Update Information</Text>
                                    <TouchableOpacity
                                        onPress={() => !updating && resetModalState()}
                                        className="w-8 h-8 rounded-full bg-gray-100 items-center justify-center"
                                    >
                                        <Feather name="x" size={18} color="#4B5563" />
                                    </TouchableOpacity>
                                </View>

                                {/* Fullname */}
                                {genericFields.slice(0, 1).map((field) => (
                                    <View key={field.key}>
                                        <Text className="text-sm font-semibold mb-1.5 text-gray-700">
                                            {field.label}
                                            {field.required && <Text className="text-red-500"> *</Text>}
                                        </Text>
                                        <TextInput
                                            editable={!updating}
                                            value={form[field.key]}
                                            onChangeText={(v) => {
                                                setForm((prev) => ({ ...prev, [field.key]: v }));
                                                if (formErrors[field.key]) {
                                                    setFormErrors((prev) => ({ ...prev, [field.key]: undefined }));
                                                }
                                            }}
                                            placeholder={field.placeholder}
                                            placeholderTextColor="#9CA3AF"
                                            className={`border rounded-xl px-3.5 py-3 bg-gray-50 ${formErrors[field.key] ? "border-red-500" : "border-gray-200"
                                                }`}
                                        />
                                        {formErrors[field.key] && (
                                            <Text className="text-red-500 text-xs mt-1">{formErrors[field.key]}</Text>
                                        )}
                                    </View>
                                ))}

                                {/* Contact Number — matches AddHousehold's +63 prefixed input */}
                                <View>
                                    <Text className="text-sm font-semibold mb-1.5 text-gray-700">
                                        Contact Number
                                        <Text className="text-red-500"> *</Text>
                                    </Text>
                                    <View
                                        className={`flex-row items-center border rounded-xl overflow-hidden bg-gray-50 ${formErrors.contactNumber ? "border-red-500" : "border-gray-200"
                                            }`}
                                    >
                                        <View className="bg-gray-100 px-3.5 py-3">
                                            <Text className="text-gray-700 text-sm font-medium">🇵🇭 +63</Text>
                                        </View>
                                        <TextInput
                                            editable={!updating}
                                            value={form.contactNumber}
                                            onChangeText={(v) => {
                                                // allow digits and dashes only, matches AddHousehold's free-typed format
                                                const cleaned = v.replace(/[^\d-]/g, "");
                                                setForm((prev) => ({ ...prev, contactNumber: cleaned }));
                                                if (formErrors.contactNumber) {
                                                    setFormErrors((prev) => ({ ...prev, contactNumber: undefined }));
                                                }
                                            }}
                                            placeholder="912-345-6789"
                                            placeholderTextColor="#9CA3AF"
                                            keyboardType="phone-pad"
                                            maxLength={10}
                                            className="flex-1 px-3.5 py-3"
                                        />
                                    </View>
                                    {formErrors.contactNumber && (
                                        <Text className="text-red-500 text-xs mt-1">{formErrors.contactNumber}</Text>
                                    )}
                                </View>

                                {/* Remaining generic fields */}
                                {genericFields.slice(1).map((field) => (
                                    <View key={field.key}>
                                        <Text className="text-sm font-semibold mb-1.5 text-gray-700">{field.label}</Text>
                                        <TextInput
                                            editable={!updating}
                                            value={form[field.key]}
                                            onChangeText={(v) => {
                                                setForm((prev) => ({ ...prev, [field.key]: v }));
                                                if (formErrors[field.key]) {
                                                    setFormErrors((prev) => ({ ...prev, [field.key]: undefined }));
                                                }
                                            }}
                                            placeholder={field.placeholder}
                                            placeholderTextColor="#9CA3AF"
                                            keyboardType={field.keyboard || "default"}
                                            autoCapitalize={field.key === "email" ? "none" : "sentences"}
                                            className={`border rounded-xl px-3.5 py-3 bg-gray-50 ${formErrors[field.key] ? "border-red-500" : "border-gray-200"
                                                }`}
                                        />
                                        {formErrors[field.key] && (
                                            <Text className="text-red-500 text-xs mt-1">{formErrors[field.key]}</Text>
                                        )}
                                    </View>
                                ))}

                                {/* Divider */}
                                <View className="border-t border-gray-100 mt-2 pt-4">
                                    <Text className="text-xs font-bold text-gray-500 mb-1 tracking-wide">
                                        CHANGE PASSWORD
                                    </Text>
                                    <Text className="text-xs text-gray-400 mb-3">
                                        Leave blank if you don't want to change your password.
                                    </Text>

                                    {/* Current Password */}
                                    <View className="mb-3">
                                        <Text className="text-sm font-semibold mb-1.5 text-gray-700">Current Password</Text>
                                        <View className="flex-row items-center border rounded-xl px-3.5 py-3 border-gray-200 bg-gray-50">
                                            <TextInput
                                                editable={!updating}
                                                value={passwordForm.currentPassword}
                                                onChangeText={(v) => setPasswordForm((prev) => ({ ...prev, currentPassword: v }))}
                                                placeholder="Enter current password"
                                                placeholderTextColor="#9CA3AF"
                                                secureTextEntry={!showCurrentPassword}
                                                className="flex-1"
                                            />
                                            <TouchableOpacity onPress={() => setShowCurrentPassword(!showCurrentPassword)}>
                                                <Feather name={showCurrentPassword ? "eye-off" : "eye"} size={18} color="#9CA3AF" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {/* New Password */}
                                    <View className="mb-3">
                                        <Text className="text-sm font-semibold mb-1.5 text-gray-700">New Password</Text>
                                        <View className="flex-row items-center border rounded-xl px-3.5 py-3 border-gray-200 bg-gray-50">
                                            <TextInput
                                                editable={!updating}
                                                value={passwordForm.newPassword}
                                                onChangeText={(v) => setPasswordForm((prev) => ({ ...prev, newPassword: v }))}
                                                placeholder="Enter new password"
                                                placeholderTextColor="#9CA3AF"
                                                secureTextEntry={!showNewPassword}
                                                className="flex-1"
                                            />
                                            <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)}>
                                                <Feather name={showNewPassword ? "eye-off" : "eye"} size={18} color="#9CA3AF" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {/* Confirm New Password */}
                                    <View className="mb-1">
                                        <Text className="text-sm font-semibold mb-1.5 text-gray-700">Confirm New Password</Text>
                                        <View className="flex-row items-center border rounded-xl px-3.5 py-3 border-gray-200 bg-gray-50">
                                            <TextInput
                                                editable={!updating}
                                                value={passwordForm.confirmPassword}
                                                onChangeText={(v) => setPasswordForm((prev) => ({ ...prev, confirmPassword: v }))}
                                                placeholder="Re-enter new password"
                                                placeholderTextColor="#9CA3AF"
                                                secureTextEntry={!showConfirmPassword}
                                                className="flex-1"
                                            />
                                            <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                                                <Feather name={showConfirmPassword ? "eye-off" : "eye"} size={18} color="#9CA3AF" />
                                            </TouchableOpacity>
                                        </View>
                                    </View>
                                </View>

                                <TouchableOpacity
                                    onPress={handleUpdate}
                                    disabled={updating}
                                    activeOpacity={0.85}
                                    className="bg-green-600 py-3.5 rounded-xl items-center mt-2"
                                    style={{ opacity: updating ? 0.6 : 1 }}
                                >
                                    {updating ? (
                                        <View className="flex-row items-center gap-2">
                                            <ActivityIndicator size="small" color="#fff" />
                                            <Text className="text-white font-semibold ml-2">Updating...</Text>
                                        </View>
                                    ) : (
                                        <Text className="text-white font-semibold">Save Changes</Text>
                                    )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={() => !updating && resetModalState()}
                                    disabled={updating}
                                    activeOpacity={0.7}
                                    className="items-center py-1"
                                >
                                    <Text className="text-gray-500 text-sm font-medium">Cancel</Text>
                                </TouchableOpacity>

                            </View>
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

        </SafeAreaView>
    );
}
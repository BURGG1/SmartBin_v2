import { useState, useRef } from "react";
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Modal,
    Pressable,
    ScrollView,
    Alert,
    KeyboardAvoidingView,
    Platform,
    FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { API_BASE } from "@/config";

interface RegisterHouseholdProps {
    isOpen: boolean;
    onClose: () => void;
}

interface FormState {
    fullname: string;
    familyMember: string;
    houseNo: string;
    street: string;
    email: string;
    contactNumber: string; // holds only the local part typed after +63, e.g. "9123456789"
}

interface FormErrors {
    fullname?: string;
    familyMember?: string;
    houseNo?: string;
    street?: string;
    email?: string;
    contactNumber?: string;
}

const INITIAL_FORM: FormState = {
    fullname: "",
    familyMember: "",
    houseNo: "",
    street: "",
    email: "",
    contactNumber: "",
};

// ── Replace with your barangay's actual streets/puroks/sitios ──
const STREET_OPTIONS = [
    "Rizal St.",
    "Mabini St.",
    "Bonifacio St.",
    "Purok 1",
    "Purok 2",
    "Purok 3",
    "Sitio Maligaya",
    "National Highway",
];

const PH_MOBILE_REGEX = /^09\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the admin panel's + backend's normalizeContactNumber so every
// surface agrees on a single canonical format: "09XXXXXXXXX".
// Since this form only captures the part after the fixed +63 badge,
// the input is expected to be a 10-digit local number starting with "9"
// (e.g. "9123456789"), but this still tolerates a pasted "09..." or
// "+63..." value just in case.
const normalizeContactNumber = (input: string): string | null => {
    if (!input || typeof input !== "string") return null;

    let digits = input.replace(/\D/g, "");

    if (digits.startsWith("63") && digits.length === 12) {
        digits = "0" + digits.slice(2);
    } else if (digits.length === 10 && digits.startsWith("9")) {
        digits = "0" + digits;
    }

    return digits;
};

export default function RegisterHousehold({ isOpen, onClose }: RegisterHouseholdProps) {
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<FormState>(INITIAL_FORM);
    const [errors, setErrors] = useState<FormErrors>({});
    const [streetPickerOpen, setStreetPickerOpen] = useState(false);
    const submittingRef = useRef(false);

    const handleChange = (field: keyof FormState, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors((prev) => ({ ...prev, [field]: undefined }));
        }
    };

    const resetForm = () => {
        setForm(INITIAL_FORM);
        setErrors({});
    };

    const isEmailTaken = async (email: string): Promise<boolean> => {
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

    const isContactTaken = async (contactNumber: string): Promise<boolean> => {
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

    const validate = (normalizedContact: string | null): FormErrors => {
        const next: FormErrors = {};
        const fullname = form.fullname.trim();
        const houseNo = form.houseNo.trim();
        const street = form.street.trim();
        const email = form.email.trim();

        if (!fullname) {
            next.fullname = "Fullname is required.";
        } else if (fullname.length < 2) {
            next.fullname = "Fullname looks too short.";
        }

        if (!houseNo) next.houseNo = "House number is required.";
        if (!street) next.street = "Please select your street/purok.";

        if (!form.contactNumber.trim()) {
            next.contactNumber = "Contact number is required.";
        } else if (!normalizedContact || !PH_MOBILE_REGEX.test(normalizedContact)) {
            next.contactNumber = "Enter a valid number, e.g. 912-345-6789.";
        }

        if (!email) next.email = "Email is required.";
        else if (email && !EMAIL_REGEX.test(email)) {
            next.email = "Enter a valid email address.";
        }

        if (form.familyMember.trim()) {
            const n = Number(form.familyMember.trim());
            if (!Number.isInteger(n) || n < 0) {
                next.familyMember = "Enter a valid number of family members.";
            }
        }

        return next;
    };

    const submitRequest = async (normalizedContact: string) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setLoading(true);

        try {
            const response = await fetch(`${API_BASE}/api/requests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fullname: form.fullname.trim(),
                    familyMember: form.familyMember.trim()
                        ? parseInt(form.familyMember.trim(), 10)
                        : null,
                    address: {
                        houseNo: form.houseNo.trim(),
                        street: form.street.trim(),
                    },
                    email: form.email.trim() ? form.email.trim().toLowerCase() : null,
                    contactNumber: normalizedContact,
                }),
            });

            let data: any = null;
            try {
                data = await response.json();
            } catch {
                Alert.alert("Error", "Unexpected server response. Please try again.");
                return;
            }

            if (!response.ok || !data?.success) {
                Alert.alert("Error", data?.message || "Something went wrong. Please try again.");
                return;
            }

            Alert.alert(
                "Request Submitted!",
                "Your registration is pending admin approval. You will receive your credentials via email once approved.",
                [
                    {
                        text: "OK",
                        onPress: () => {
                            resetForm();
                            onClose();
                        },
                    },
                ]
            );
        } catch (err) {
            Alert.alert(
                "Connection Error",
                "Cannot connect to server. Please check your internet connection and try again."
            );
        } finally {
            setLoading(false);
            submittingRef.current = false;
        }
    };

    // ── Validate, then show confirmation before actually sending ──
    const handleRegister = async () => {
        if (submittingRef.current) return;

        const normalizedContact = normalizeContactNumber(form.contactNumber.trim());

        const validationErrors = validate(normalizedContact);
        setErrors(validationErrors);
        if (Object.keys(validationErrors).length > 0) return;

        // normalizedContact is guaranteed valid past this point
        const [emailTaken, contactTaken] = await Promise.all([
            isEmailTaken(form.email.trim().toLowerCase()),
            isContactTaken(normalizedContact as string),
        ]);

        const conflictErrors: FormErrors = {};
        if (emailTaken) conflictErrors.email = "This email is already registered.";
        if (contactTaken) conflictErrors.contactNumber = "This contact number is already registered.";

        if (Object.keys(conflictErrors).length > 0) {
            setErrors((prev) => ({ ...prev, ...conflictErrors }));
            return;
        }

        Alert.alert(
            "Confirm Registration",
            "Are you sure your inputted information is correct?",
            [
                { text: "Cancel", style: "cancel" },
                { text: "Confirm", onPress: () => submitRequest(normalizedContact as string) },
            ]
        );
    };

    const handleClose = () => {
        if (loading) return;
        resetForm();
        onClose();
    };

    return (
        <Modal visible={isOpen} className="bg-white" animationType="fade" onRequestClose={handleClose}>
            <KeyboardAvoidingView
                behavior={Platform.OS === "ios" ? "padding" : undefined}
                className="flex-1"
            >
                <Pressable
                    className="flex-1 bg-black/40 justify-center items-center p-4"
                    onPress={handleClose}
                >
                    <Pressable
                        className="bg-white w-full max-w-lg rounded-2xl overflow-hidden"
                        onPress={() => { }}
                    >
                        {/* HEADER */}
                        <View className="flex-row justify-between items-center px-6 py-4 border-b border-gray-200">
                            <Text className="text-lg font-bold">Register Household</Text>
                            <TouchableOpacity onPress={handleClose} disabled={loading} hitSlop={8}>
                                <Ionicons name="close" size={22} color="gray" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView className="p-5" keyboardShouldPersistTaps="handled">
                            {/* Fullname */}
                            <View className="mb-3">
                                <View className="flex-row items-center">
                                    <Text className="text-lg font-semibold">Fullname</Text>
                                    <Text className="text-red-500 ml-1">*</Text>
                                </View>
                                <TextInput
                                    placeholder="ex. Janice S. Dela Cruz"
                                    value={form.fullname}
                                    onChangeText={(v) => handleChange("fullname", v)}
                                    maxLength={100}
                                    editable={!loading}
                                    className={`border rounded-lg px-3 py-2 mt-1 ${errors.fullname ? "border-red-500" : "border-gray-300"
                                        }`}
                                />
                                {errors.fullname && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.fullname}</Text>
                                )}
                            </View>

                            {/* Family Member */}
                            <View className="mb-3">
                                <Text className="text-lg font-semibold">Family Member</Text>
                                <TextInput
                                    placeholder="ex. 5"
                                    keyboardType="numeric"
                                    value={form.familyMember}
                                    onChangeText={(v) => handleChange("familyMember", v.replace(/[^0-9]/g, ""))}
                                    maxLength={2}
                                    editable={!loading}
                                    className={`border rounded-lg px-3 py-2 mt-1 ${errors.familyMember ? "border-red-500" : "border-gray-300"
                                        }`}
                                />
                                {errors.familyMember && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.familyMember}</Text>
                                )}
                            </View>

                            {/* Address */}
                            <View className="mb-3">
                                <View className="flex-row items-center">
                                    <Text className="text-lg font-semibold">Address</Text>
                                    <Text className="text-red-500 ml-1">*</Text>
                                </View>

                                <View className="ml-3 mt-2">
                                    <View className="mb-2">
                                        <View className="flex-row items-center">
                                            <Text className="font-semibold">House No.</Text>
                                            <Text className="text-red-500 ml-1">*</Text>
                                        </View>
                                        <TextInput
                                            placeholder="ex. 0123"
                                            value={form.houseNo}
                                            onChangeText={(v) => handleChange("houseNo", v)}
                                            maxLength={20}
                                            editable={!loading}
                                            className={`border rounded-lg px-3 py-2 mt-1 ${errors.houseNo ? "border-red-500" : "border-gray-300"
                                                }`}
                                        />
                                        {errors.houseNo && (
                                            <Text className="text-red-500 text-xs mt-1">{errors.houseNo}</Text>
                                        )}
                                    </View>

                                    {/* ── Street/Purok picker instead of freeform text ── */}
                                    <View>
                                        <View className="flex-row items-center">
                                            <Text className="font-semibold">Street/Purok</Text>
                                            <Text className="text-red-500 ml-1">*</Text>
                                        </View>
                                        <TouchableOpacity
                                            onPress={() => !loading && setStreetPickerOpen(true)}
                                            disabled={loading}
                                            className={`border rounded-lg px-3 py-2 mt-1 flex-row justify-between items-center ${errors.street ? "border-red-500" : "border-gray-300"
                                                }`}
                                        >
                                            <Text className={form.street ? "text-black" : "text-gray-400"}>
                                                {form.street || "Select street/purok"}
                                            </Text>
                                            <Ionicons name="chevron-down" size={18} color="gray" />
                                        </TouchableOpacity>
                                        {errors.street && (
                                            <Text className="text-red-500 text-xs mt-1">{errors.street}</Text>
                                        )}
                                    </View>
                                </View>
                            </View>

                            {/* Email */}
                            <View className="mb-3">
                                <View className="flex-row items-center">
                                    <Text className="text-lg font-semibold">Email</Text>
                                    <Text className="text-red-500 ml-1">*</Text>
                                </View>
                                <TextInput
                                    placeholder="ex. janicedelacruz@gmail.com"
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    value={form.email}
                                    onChangeText={(v) => handleChange("email", v)}
                                    maxLength={100}
                                    editable={!loading}
                                    className={`border rounded-lg px-3 py-2 mt-1 ${errors.email ? "border-red-500" : "border-gray-300"
                                        }`}
                                />
                                {errors.email && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.email}</Text>
                                )}
                            </View>

                            {/* Contact Number — same +63 prefix pattern as the admin panel */}
                            <View className="mb-3">
                                <View className="flex-row items-center">
                                    <Text className="text-lg font-semibold">Contact Number</Text>
                                    <Text className="text-red-500 ml-1">*</Text>
                                </View>
                                <View
                                    className={`flex-row items-center border rounded-lg overflow-hidden mt-1 ${errors.contactNumber ? "border-red-500" : "border-gray-300"
                                        }`}
                                >
                                    <View className="bg-gray-100 px-3 py-2">
                                        <Text className="text-gray-700 text-sm">🇵🇭 +63</Text>
                                    </View>
                                    <TextInput
                                        placeholder="912-345-6789"
                                        keyboardType="phone-pad"
                                        value={form.contactNumber}
                                        onChangeText={(v) => handleChange("contactNumber", v.replace(/[^0-9]/g, ""))}
                                        maxLength={10}
                                        editable={!loading}
                                        className="flex-1 px-3 py-2"
                                    />
                                </View>
                                {errors.contactNumber && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.contactNumber}</Text>
                                )}
                            </View>

                            {/* Button */}
                            <TouchableOpacity
                                onPress={handleRegister}
                                disabled={loading}
                                className="mt-5 bg-green-600 rounded-lg p-3 items-center"
                                activeOpacity={0.8}
                                style={{ opacity: loading ? 0.6 : 1 }}
                            >
                                <Text className="text-white font-semibold">
                                    {loading ? "Submitting..." : "Register"}
                                </Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </Pressable>
                </Pressable>

                {/* ── Street/Purok picker modal ── */}
                <Modal
                    visible={streetPickerOpen}
                    animationType="slide"
                    transparent
                    onRequestClose={() => setStreetPickerOpen(false)}
                >
                    <Pressable
                        className="flex-1 bg-black/40 justify-end items-center p-4"
                        onPress={() => setStreetPickerOpen(false)}
                    >
                        <Pressable
                            className="w-[90%] bg-white rounded-t-2xl max-h-[70%]"
                            onPress={() => { }}
                        >
                            <View className="flex-row justify-between items-center px-5 py-4 border-b border-gray-200">
                                <Text className="text-lg font-bold">Select Street/Purok</Text>
                                <TouchableOpacity onPress={() => setStreetPickerOpen(false)} hitSlop={8}>
                                    <Ionicons name="close" size={22} color="gray" />
                                </TouchableOpacity>
                            </View>
                            <FlatList
                                data={STREET_OPTIONS}
                                keyExtractor={(item) => item}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        onPress={() => {
                                            handleChange("street", item);
                                            setStreetPickerOpen(false);
                                        }}
                                        className="px-5 py-4 border-b border-gray-100 flex-row justify-between items-center"
                                    >
                                        <Text
                                            className={
                                                form.street === item
                                                    ? "text-green-600 font-semibold"
                                                    : "text-gray-800"
                                            }
                                        >
                                            {item}
                                        </Text>
                                        {form.street === item && (
                                            <Ionicons name="checkmark" size={18} color="#16a34a" />
                                        )}
                                    </TouchableOpacity>
                                )}
                            />
                        </Pressable>
                    </Pressable>
                </Modal>
            </KeyboardAvoidingView>
        </Modal>
    );
}
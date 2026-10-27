import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/config";

const PH_MOBILE_REGEX = /^09\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the backend's normalizeContactNumber ("09XXXXXXXXX")
const normalizeContactNumber = (input?: string | null) => {
  if (!input || typeof input !== "string") return null;
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) {
    digits = "0" + digits.slice(2);
  } else if (digits.length === 10 && digits.startsWith("9")) {
    digits = "0" + digits;
  }
  return digits;
};

// Strips the leading "0" so it can sit next to the fixed "+63" prefix
const toLocalDisplay = (n?: string | null) => {
  if (!n) return "";
  return n.startsWith("0") ? n.slice(1) : n;
};

interface EditHouseholdProps {
  isOpen: boolean;
  onClose: () => void;
  household: any;
  onSaved: () => void;
}

type FormKey =
  | "fullname"
  | "familyMember"
  | "houseNo"
  | "street"
  | "contactNumber"
  | "email";

export default function EditHousehold({
  isOpen,
  onClose,
  household,
  onSaved,
}: EditHouseholdProps) {
  const [updating, setUpdating] = useState(false);
  const [form, setForm] = useState<Record<FormKey, string>>({
    fullname: "",
    familyMember: "",
    houseNo: "",
    street: "",
    contactNumber: "",
    email: "",
  });
  const [formErrors, setFormErrors] = useState<Partial<Record<FormKey, string>>>({});
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [show, setShow] = useState({ current: false, new: false, confirm: false });

  // Seed the form only when the modal opens, so a background refresh
  // of `household` can't wipe what the user is typing.
  useEffect(() => {
    if (!isOpen) return;
    setForm({
      fullname: household?.fullname || "",
      familyMember: household?.familyMember?.toString() || "",
      houseNo: household?.address?.houseNo || "",
      street: household?.address?.street || "",
      contactNumber: toLocalDisplay(household?.contactNumber),
      email: household?.email || "",
    });
    setFormErrors({});
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setShow({ current: false, new: false, confirm: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleClose = () => {
    if (!updating) onClose();
  };

  const setField = (key: FormKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) setFormErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const isEmailTaken = async (email: string) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/households/check-email?email=${encodeURIComponent(email)}`
      );
      const data = await res.json();
      return data?.success ? !!data.exists : false; // fail open; server still enforces
    } catch {
      return false;
    }
  };

  const isContactTaken = async (contactNumber: string) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/households/check-contact?contactNumber=${encodeURIComponent(contactNumber)}`
      );
      const data = await res.json();
      return data?.success ? !!data.exists : false;
    } catch {
      return false;
    }
  };

  const handleUpdate = async () => {
    const nextErrors: Partial<Record<FormKey, string>> = {};

    if (!form.fullname.trim()) nextErrors.fullname = "Fullname is required.";

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

    if (passwordForm.currentPassword || passwordForm.newPassword || passwordForm.confirmPassword) {
      if (!passwordForm.currentPassword) return Alert.alert("Error", "Please enter your current password.");
      if (!passwordForm.newPassword) return Alert.alert("Error", "Please enter a new password.");
      if (passwordForm.newPassword.length < 6)
        return Alert.alert("Error", "New password must be at least 6 characters.");
      if (passwordForm.newPassword !== passwordForm.confirmPassword)
        return Alert.alert("Error", "New passwords do not match.");
    }

    setUpdating(true);
    try {
      // Only re-check availability if the value actually changed
      const contactChanged = normalizedContact !== household?.contactNumber;
      const emailChanged = normalizedEmail !== (household?.email || "");

      const [contactTaken, emailTaken] = await Promise.all([
        contactChanged ? isContactTaken(normalizedContact as string) : Promise.resolve(false),
        emailChanged && normalizedEmail ? isEmailTaken(normalizedEmail) : Promise.resolve(false),
      ]);

      const conflicts: Partial<Record<FormKey, string>> = {};
      if (contactTaken) conflicts.contactNumber = "This contact number is already registered.";
      if (emailTaken) conflicts.email = "This email is already registered.";
      if (Object.keys(conflicts).length > 0) {
        setFormErrors((prev) => ({ ...prev, ...conflicts }));
        return;
      }

      const token = await AsyncStorage.getItem("token");
      const userStr = await AsyncStorage.getItem("user");
      const user = userStr ? JSON.parse(userStr) : null;

      const body: Record<string, any> = {
        fullname: form.fullname.trim(),
        contactNumber: normalizedContact,
        address: { houseNo: form.houseNo.trim(), street: form.street.trim() },
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
      onClose();
      onSaved();
    } catch {
      Alert.alert("Error", "Cannot connect to server.");
    } finally {
      setUpdating(false);
    }
  };

  // ── Render helpers (plain functions, not components, so inputs keep focus) ──
  const renderSectionTitle = (title: string) => (
    <Text className="text-xs font-bold text-green-700 tracking-widest mb-3">{title}</Text>
  );

  const renderInput = (opts: {
    label: string;
    key: FormKey;
    placeholder: string;
    icon: keyof typeof Feather.glyphMap;
    required?: boolean;
    keyboard?: "default" | "numeric" | "email-address";
  }) => (
    <View key={opts.key}>
      <Text className="text-sm font-semibold mb-1.5 text-gray-700">
        {opts.label}
        {opts.required && <Text className="text-red-500"> *</Text>}
      </Text>
      <View
        className={`flex-row items-center border rounded-xl px-3.5 bg-gray-50 ${
          formErrors[opts.key] ? "border-red-500" : "border-gray-300"
        }`}
      >
        <Feather name={opts.icon} size={18} color="#9CA3AF" />
        <TextInput
          editable={!updating}
          value={form[opts.key]}
          onChangeText={(v) => setField(opts.key, v)}
          placeholder={opts.placeholder}
          placeholderTextColor="#9CA3AF"
          keyboardType={opts.keyboard || "default"}
          autoCapitalize={opts.key === "email" ? "none" : "sentences"}
          className="flex-1 py-3 ml-2.5 text-base text-gray-900"
        />
      </View>
      {formErrors[opts.key] && (
        <Text className="text-red-600 text-sm mt-1">{formErrors[opts.key]}</Text>
      )}
    </View>
  );

  const renderPasswordInput = (opts: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    visible: boolean;
    toggle: () => void;
  }) => (
    <View>
      <Text className="text-sm font-semibold mb-1.5 text-gray-700">{opts.label}</Text>
      <View className="flex-row items-center border rounded-xl px-3.5 border-gray-300 bg-white">
        <Feather name="lock" size={18} color="#9CA3AF" />
        <TextInput
          editable={!updating}
          value={opts.value}
          onChangeText={opts.onChange}
          placeholder={opts.placeholder}
          placeholderTextColor="#9CA3AF"
          secureTextEntry={!opts.visible}
          autoCapitalize="none"
          className="flex-1 py-3 ml-2.5 text-base text-gray-900"
        />
        <TouchableOpacity onPress={opts.toggle} hitSlop={8}>
          <Feather name={opts.visible ? "eye-off" : "eye"} size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <View className="flex-1 justify-end">
          {/* Backdrop: separate from the sheet so it never competes with scrolling */}
          <Pressable
            onPress={handleClose}
            className="absolute inset-0 bg-black/40"
            accessibilityLabel="Close"
          />

          {/* Bottom sheet */}
          <View className="bg-white rounded-t-3xl" style={{ maxHeight: "92%" }}>
            {/* Header */}
            <View className="px-5 pt-5 pb-4 border-b border-gray-100 flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-xl font-bold text-gray-900">Update Information</Text>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                accessibilityLabel="Close"
                className="w-9 h-9 rounded-full bg-gray-100 items-center justify-center"
              >
                <Feather name="x" size={20} color="#4B5563" />
              </TouchableOpacity>
            </View>

            {/* Body */}
            <ScrollView
              style={{ flexShrink: 1 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              showsVerticalScrollIndicator={false}
              bounces
              scrollEventThrottle={16}
              contentContainerStyle={{ padding: 20, paddingBottom: 12 }}
            >
              {/* Personal */}
              <View className="mb-6 gap-4">
                {renderSectionTitle("PERSONAL")}
                {renderInput({
                  label: "Fullname",
                  key: "fullname",
                  placeholder: "ex. Janice S. Dela Cruz",
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
                {renderInput({
                  label: "House No.",
                  key: "houseNo",
                  placeholder: "ex. 0123",
                  icon: "home",
                })}
                {renderInput({
                  label: "Street / Block",
                  key: "street",
                  placeholder: "ex. Rizal St.",
                  icon: "map-pin",
                })}
              </View>

              {/* Contact */}
              <View className="mb-6 gap-4">
                {renderSectionTitle("CONTACT")}
                <View>
                  <Text className="text-sm font-semibold mb-1.5 text-gray-700">
                    Contact Number
                  </Text>
                  <View
                    className={`flex-row items-center border rounded-xl overflow-hidden bg-gray-50 ${
                      formErrors.contactNumber ? "border-red-500" : "border-gray-300"
                    }`}
                  >
                    <View className="bg-gray-100 px-3.5 py-3 border-r border-gray-200">
                      <Text className="text-gray-800 text-base font-medium">🇵🇭 +63</Text>
                    </View>
                    <TextInput
                      editable={!updating}
                      value={form.contactNumber}
                      onChangeText={(v) => setField("contactNumber", v.replace(/[^\d-]/g, ""))}
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
                  placeholder: "ex. janice@email.com",
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
                  onChange: (v) => setPasswordForm((p) => ({ ...p, currentPassword: v })),
                  placeholder: "Enter current password",
                  visible: show.current,
                  toggle: () => setShow((s) => ({ ...s, current: !s.current })),
                })}
                {renderPasswordInput({
                  label: "New Password",
                  value: passwordForm.newPassword,
                  onChange: (v) => setPasswordForm((p) => ({ ...p, newPassword: v })),
                  placeholder: "At least 6 characters",
                  visible: show.new,
                  toggle: () => setShow((s) => ({ ...s, new: !s.new })),
                })}
                {renderPasswordInput({
                  label: "Confirm New Password",
                  value: passwordForm.confirmPassword,
                  onChange: (v) => setPasswordForm((p) => ({ ...p, confirmPassword: v })),
                  placeholder: "Re-enter new password",
                  visible: show.confirm,
                  toggle: () => setShow((s) => ({ ...s, confirm: !s.confirm })),
                })}
              </View>
            </ScrollView>

            {/* Footer */}
            <View className="px-5 pt-3 pb-6 border-t border-gray-100 flex-row gap-3">
              <TouchableOpacity
                onPress={handleClose}
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
  );
}
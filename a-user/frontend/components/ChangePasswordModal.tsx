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

interface ChangePasswordProps {
  isOpen: boolean;
  onClose: () => void;
  household: any;
  isFirstLogin?: boolean; // first login: current password field is hidden and not sent
  onSuccess?: () => void; // called after the password was changed successfully
}

type PwKey = "currentPassword" | "newPassword" | "confirmPassword";

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

export default function ChangePassword({
  isOpen,
  onClose,
  household,
  isFirstLogin = false,
  onSuccess,
}: ChangePasswordProps) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<PwKey, string>>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<PwKey, string>>>({});
  const [serverError, setServerError] = useState("");
  const [show, setShow] = useState<Record<PwKey, boolean>>({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });

  // Fresh form every time the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setForm(EMPTY);
    setErrors({});
    setServerError("");
    setShow({ currentPassword: false, newPassword: false, confirmPassword: false });
  }, [isOpen]);

  const handleClose = () => {
    if (!saving) onClose();
  };

  const setField = (key: PwKey, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
    if (serverError) setServerError("");
  };

  const canSubmit =
    (isFirstLogin || !!form.currentPassword) &&
    !!form.newPassword &&
    !!form.confirmPassword &&
    !saving;

  const handleSubmit = async () => {
    const next: Partial<Record<PwKey, string>> = {};

    if (!isFirstLogin && !form.currentPassword) {
      next.currentPassword = "Enter your current password.";
    }
    if (!form.newPassword) {
      next.newPassword = "Enter a new password.";
    } else if (form.newPassword.length < 6) {
      next.newPassword = "Password must be at least 6 characters.";
    } else if (!isFirstLogin && form.newPassword === form.currentPassword) {
      next.newPassword = "New password must be different from the current one.";
    }
    if (form.newPassword && form.confirmPassword !== form.newPassword) {
      next.confirmPassword = "Passwords do not match.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaving(true);
    setServerError("");
    try {
      const token = await AsyncStorage.getItem("token");
      const userStr = await AsyncStorage.getItem("user");
      const user = userStr ? JSON.parse(userStr) : null;

      // Existing profile values are sent along so the endpoint's
      // required-field validation keeps passing. If you have a dedicated
      // password endpoint, replace this body and URL with that.
      const body = {
        fullname: household?.fullname,
        contactNumber: household?.contactNumber,
        address: {
          houseNo: household?.address?.houseNo || "",
          street: household?.address?.street || "",
        },
        familyMember: household?.familyMember ?? null,
        email: household?.email || null,
        // First login: the server skips the current-password check
        // (it only does so while the household's isFirstLogin is still true).
        ...(isFirstLogin ? {} : { currentPassword: form.currentPassword }),
        newPassword: form.newPassword,
      };

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
        setServerError(message || "Failed to change password.");
        return;
      }

      onSuccess?.();
      onClose();
      Alert.alert("Success", "Your password has been changed.");
    } catch {
      setServerError("Cannot connect to server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const renderPasswordInput = (opts: {
    label: string;
    key: PwKey;
    placeholder: string;
    hint?: string;
  }) => (
    <View key={opts.key}>
      <Text className="text-sm font-semibold mb-1.5 text-gray-700">{opts.label}</Text>
      <View
        className={`flex-row items-center border rounded-xl px-3.5 bg-gray-50 ${
          errors[opts.key] ? "border-red-500" : "border-gray-300"
        }`}
      >
        <Feather name="lock" size={18} color="#9CA3AF" />
        <TextInput
          editable={!saving}
          value={form[opts.key]}
          onChangeText={(v) => setField(opts.key, v)}
          placeholder={opts.placeholder}
          placeholderTextColor="#9CA3AF"
          secureTextEntry={!show[opts.key]}
          autoCapitalize="none"
          autoCorrect={false}
          className="flex-1 py-3 ml-2.5 text-base text-gray-900"
        />
        <TouchableOpacity
          onPress={() => setShow((s) => ({ ...s, [opts.key]: !s[opts.key] }))}
          hitSlop={8}
          accessibilityLabel={show[opts.key] ? "Hide password" : "Show password"}
        >
          <Feather name={show[opts.key] ? "eye-off" : "eye"} size={20} color="#6B7280" />
        </TouchableOpacity>
      </View>
      {errors[opts.key] ? (
        <Text className="text-red-600 text-sm mt-1">{errors[opts.key]}</Text>
      ) : opts.hint ? (
        <Text className="text-gray-500 text-sm mt-1">{opts.hint}</Text>
      ) : null}
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
          <Pressable
            onPress={handleClose}
            className="absolute inset-0 bg-black/40"
            accessibilityLabel="Close"
          />

          <View className="bg-white rounded-t-3xl" style={{ maxHeight: "92%" }}>
            {/* Header */}
            <View className="px-5 pt-5 pb-4 border-b border-gray-100 flex-row items-center justify-between">
              <View className="flex-1 pr-3 flex-row items-center">
                <View className="w-10 h-10 rounded-full bg-green-50 items-center justify-center mr-3">
                  <Feather name="lock" size={18} color="#16A34A" />
                </View>
                <View className="flex-1">
                  <Text className="text-xl font-bold text-gray-900">Change Password</Text>
                  <Text className="text-sm text-gray-500 mt-0.5">
                    Choose a strong password you don't use elsewhere.
                  </Text>
                </View>
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
              contentContainerStyle={{ padding: 20, paddingBottom: 12 }}
            >
              <View className="gap-4">
                {isFirstLogin && (
                  <View className="flex-row items-start gap-2 rounded-xl bg-green-50 border border-green-200 p-3">
                    <Feather name="info" size={18} color="#15803D" />
                    <View className="flex-1">
                      <Text className="text-lg font-semibold text-green-800">
                        Welcome! This is your first login.
                      </Text>
                      <Text className="text-md text-green-700 mt-0.5">
                        For your account's security, please change the password you were given to one only you know.
                      </Text>
                    </View>
                  </View>
                )}

                {!!serverError && (
                  <View className="flex-row items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3">
                    <Feather name="alert-circle" size={18} color="#B91C1C" />
                    <Text className="flex-1 text-sm text-red-700">{serverError}</Text>
                  </View>
                )}

                {/* Hidden on first login: only new + confirm are shown */}
                {!isFirstLogin &&
                  renderPasswordInput({
                    label: "Current Password",
                    key: "currentPassword",
                    placeholder: "Enter current password",
                  })}
                {renderPasswordInput({
                  label: "New Password",
                  key: "newPassword",
                  placeholder: "At least 6 characters",
                  hint: "Use at least 6 characters.",
                })}
                {renderPasswordInput({
                  label: "Confirm New Password",
                  key: "confirmPassword",
                  placeholder: "Re-enter new password",
                })}
              </View>
            </ScrollView>

            {/* Footer */}
            <View className="px-5 pt-3 pb-6 border-t border-gray-100 flex-row gap-3">
              <TouchableOpacity
                onPress={handleClose}
                disabled={saving}
                activeOpacity={0.7}
                className="flex-1 py-4 rounded-xl border border-gray-300 items-center justify-center"
                style={{ opacity: saving ? 0.5 : 1 }}
              >
                <Text className="text-gray-700 text-base font-semibold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={!canSubmit}
                activeOpacity={0.85}
                className="flex-1 bg-green-600 py-4 rounded-xl items-center justify-center"
                style={{ opacity: canSubmit ? 1 : 0.5 }}
              >
                {saving ? (
                  <View className="flex-row items-center">
                    <ActivityIndicator size="small" color="#fff" />
                    <Text className="text-white text-base font-semibold ml-2">Updating...</Text>
                  </View>
                ) : (
                  <Text className="text-white text-base font-semibold">Update Password</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
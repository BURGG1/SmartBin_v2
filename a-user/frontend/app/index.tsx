import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Keyboard,
  ScrollView,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_BASE } from "@/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store"; // NEW: encrypted storage for the saved password
import RegisterHousehold from "@/components/RegisterHouseholdModal";
import ForgotPasswordModal from "@/components/ForgotPasswordModal";
// --- Config / constants -----------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000; // client-side cool-down after repeated failures

// NEW: keys used to store the saved login in SecureStore
const SAVED_EMAIL_KEY = "saved_email";
const SAVED_PASSWORD_KEY = "saved_password";

// --- Types ---------------------------------------------------------------

interface LoginForm {
  email: string;
  password: string;
}

interface LoginResponse {
  success?: boolean;
  message?: string;
  token?: string;
  role?: string;
  user?: Record<string, unknown>;
}

interface FailedAttemptResult {
  justLockedOut: boolean;
  remainingAttempts: number;
}

// --- Helpers ------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildErrorMessage(baseMessage: string, attemptInfo: FailedAttemptResult): string {
  if (attemptInfo.justLockedOut) return baseMessage;
  if (attemptInfo.remainingAttempts === 1) {
    return `${baseMessage} One more attempt before your account is temporarily locked.`;
  }
  return baseMessage;
}

// NEW: small helpers so SecureStore errors never crash the login screen.
// (SecureStore doesn't work on web, so everything is wrapped in try/catch.)
async function saveCredentials(email: string, password: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(SAVED_EMAIL_KEY, email);
    await SecureStore.setItemAsync(SAVED_PASSWORD_KEY, password);
  } catch (err) {
    if (__DEV__) console.warn("Could not save credentials:", err);
  }
}

async function clearSavedCredentials(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SAVED_EMAIL_KEY);
    await SecureStore.deleteItemAsync(SAVED_PASSWORD_KEY);
  } catch (err) {
    if (__DEV__) console.warn("Could not clear credentials:", err);
  }
}

async function loadSavedCredentials(): Promise<LoginForm | null> {
  try {
    const email = await SecureStore.getItemAsync(SAVED_EMAIL_KEY);
    const password = await SecureStore.getItemAsync(SAVED_PASSWORD_KEY);
    if (email && password) return { email, password };
  } catch (err) {
    if (__DEV__) console.warn("Could not load credentials:", err);
  }
  return null;
}

export default function AuthPage() {
  const router = useRouter();
  const [form, setForm] = useState<LoginForm>({ email: "", password: "" });
  const [isRegisterOpen, setIsRegisterOpen] = useState<boolean>(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number>(0);
  const [savePassword, setSavePassword] = useState<boolean>(false); // NEW: checkbox state
  const [checkingSession, setCheckingSession] = useState<boolean>(true); // NEW: true while we look for a saved login

  // Client-side throttling. UX safety net only — the server MUST enforce
  // its own rate limiting, since any client-side check can be bypassed.
  const attemptsRef = useRef<number>(0);
  const lockedUntilRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

  // Keyboard handling: track the keyboard height ourselves and add it as
  // bottom padding inside the ScrollView. This works on iOS and on Android
  // (including edge-to-edge, where KeyboardAvoidingView/adjustResize can
  // silently do nothing), so the Login button can always be scrolled into view.
  const scrollRef = useRef<ScrollView>(null);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      // Wait a tick for the padding to render, then scroll the button into view.
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // NEW (stay logged in): when the app opens, look for a saved token. If it's
  // there, skip the login screen and go straight to the right home screen.
  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem("token");
        const role = await AsyncStorage.getItem("role");
        if (token && role) {
          router.replace(role === "collector" ? "/(collectorTabs)/home" : "/(userTabs)/home");
          return; // we're leaving this screen, so don't show the form
        }
      } catch (err) {
        if (__DEV__) console.warn("Session check failed:", err);
      }
      setCheckingSession(false); // no saved login, so show the login form
    })();
  }, []);

  // NEW: when the screen opens, check if a login was saved and fill it in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await loadSavedCredentials();
      if (saved && !cancelled) {
        setForm(saved);
        setSavePassword(true); // checkbox shows as ticked since we have a saved login
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ticks every second so the lockout countdown shown on the button stays
  // accurate in realtime, independent of any user interaction.
  useEffect(() => {
    const id = setInterval(() => {
      const remainingMs = lockedUntilRef.current - Date.now();
      const secondsLeft = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
      setLockoutSecondsLeft((prev) => (prev === secondsLeft ? prev : secondsLeft));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const isLockedOut = useCallback((): boolean => {
    const now = Date.now();
    if (now < lockedUntilRef.current) {
      const secondsLeft = Math.ceil((lockedUntilRef.current - now) / 1000);
      Alert.alert("Too many attempts", `Please wait ${secondsLeft}s before trying again.`);
      return true;
    }
    return false;
  }, []);

  // Increments the failed-attempt counter and, once the threshold is hit,
  // starts the lockout. Returns how many attempts are left so the caller
  // can warn the user right before they get locked out.
  const registerFailedAttempt = useCallback((): FailedAttemptResult => {
    attemptsRef.current += 1;
    if (attemptsRef.current >= MAX_ATTEMPTS) {
      lockedUntilRef.current = Date.now() + LOCKOUT_MS;
      attemptsRef.current = 0;
      setLockoutSecondsLeft(Math.ceil(LOCKOUT_MS / 1000));
      return { justLockedOut: true, remainingAttempts: 0 };
    }
    return { justLockedOut: false, remainingAttempts: MAX_ATTEMPTS - attemptsRef.current };
  }, []);

  // NEW: tapping the checkbox. If the user UNticks it, wipe whatever
  // was saved right away so nothing is left behind on the phone.
  const toggleSavePassword = useCallback(() => {
    setSavePassword((prev) => {
      const next = !prev;
      if (!next) clearSavedCredentials();
      return next;
    });
  }, []);

  const handleLogin = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return;
    if (isLockedOut()) return;

    const email = form.email.trim().toLowerCase();
    if (!email || !EMAIL_REGEX.test(email)) {
      Alert.alert("Error", "Please enter a valid email address.");
      return;
    }
    if (!form.password) {
      Alert.alert("Error", "Please enter your password.");
      return;
    }

    inFlightRef.current = true;
    setLoading(true);

    try {
      const response = await fetchWithTimeout(
        `${API_BASE}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: form.password }),
        },
        REQUEST_TIMEOUT_MS
      );

      let data: LoginResponse | null;
      try {
        data = (await response.json()) as LoginResponse;
      } catch {
        data = null;
      }

      if (!response.ok || !data?.success) {
        const attemptInfo = registerFailedAttempt();
        Alert.alert("Login Failed", buildErrorMessage(data?.message || "Invalid credentials.", attemptInfo));
        return;
      }

      attemptsRef.current = 0;

      await AsyncStorage.setItem("token", data.token ?? "");
      await AsyncStorage.setItem("user", JSON.stringify(data.user ?? {}));
      await AsyncStorage.setItem("role", data.role ?? ""); // NEW: needed so we know where to send them next time

      // NEW: only save the login AFTER it worked (so we never store a wrong
      // password), and only if the checkbox is ticked. If it's not ticked,
      // make sure nothing old is lingering.
      if (savePassword) {
        await saveCredentials(email, form.password);
      } else {
        await clearSavedCredentials();
      }

      // Clear the password from local state now that we're done with it.
      setForm((f) => ({ ...f, password: "" }));

      if (data.role === "collector") {
        router.replace("/(collectorTabs)/home");
      } else {
        router.replace("/(userTabs)/home");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        Alert.alert("Error", "The request timed out. Please try again.");
      } else {
        if (__DEV__) console.warn("Login request failed:", err);
        Alert.alert("Error", "Cannot connect to server. Make sure the backend is running.");
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [form, savePassword, isLockedOut, registerFailedAttempt, router]);

  const isLocked = lockoutSecondsLeft > 0;

  // NEW: show a spinner while checking for a saved login, so the form
  // doesn't flash on screen before the redirect.
  if (checkingSession) {
    return (
      <View className="flex-1 bg-gray-100 items-center justify-center">
        <ActivityIndicator size="large" color="#16A34A" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-100">
      {/* flexGrow + justifyContent keeps the form centered when there's room;
          the extra paddingBottom (= keyboard height) lets it scroll above the keyboard. */}
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 16,
          paddingTop: 24,
          paddingBottom: 24 + keyboardHeight,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View className="w-full max-w-md self-center space-y-6">

          {/* LOGO */}
          <View className="items-center space-y-2 mb-6">
            <View className="w-16 h-16 bg-green-600 rounded-full items-center justify-center">
              <Feather name="trash-2" size={32} color="white" />
            </View>

            <Text className="text-xl font-semibold text-center">
              Smart Bin Waste Management
            </Text>

            <Text className="text-gray-500 text-sm text-center">
              Manage waste collection efficiently
            </Text>
          </View>

          {/* CARD */}
          <View className="bg-white rounded-2xl shadow-lg p-6 space-y-6">

            <Text className="text-lg font-medium text-center">
              Welcome!
            </Text>

            {/* EMAIL */}
            <View>
              <Text className="text-sm mb-1 font-semibold">Email</Text>
              <View className="flex-row items-center mb-4 bg-gray-100 rounded-lg px-3 py-3">
                <Feather name="mail" size={18} color="gray" />

                <TextInput
                  placeholder="Enter your email"
                  placeholderTextColor="#6B7280"
                  value={form.email}
                  onChangeText={(text: string) =>
                    setForm((f) => ({ ...f, email: text }))
                  }
                  className="flex-1 ml-3 text-gray-900"
                  style={{
                    color: "#111827",
                    backgroundColor: "transparent",
                  }}
                  underlineColorAndroid="transparent"
                  selectionColor="#16A34A"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  editable={!loading && !isLocked}
                  maxLength={254}
                  accessibilityLabel="Email"
                />

              </View>
            </View>

            {/* PASSWORD */}
            <View>
              <Text className="text-sm mb-1 font-semibold">Password</Text>
              <View className="flex-row items-center bg-gray-100 rounded-lg px-3 py-3">
                <Feather name="lock" size={18} color="gray" />

                <TextInput
                  placeholder="Enter your password"
                  placeholderTextColor="#6B7280"
                  secureTextEntry={!showPassword}
                  value={form.password}
                  onChangeText={(text: string) =>
                    setForm((f) => ({ ...f, password: text }))
                  }
                  className="flex-1 ml-3 text-gray-900"
                  style={{
                    color: "#111827",
                    backgroundColor: "transparent",
                  }}
                  underlineColorAndroid="transparent"
                  selectionColor="#16A34A"
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  autoComplete="password"
                  editable={!loading && !isLocked}
                  maxLength={128}
                  accessibilityLabel="Password"
                  returnKeyType="send"
                  onSubmitEditing={() => handleLogin()}
                />

                <TouchableOpacity
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                >
                  <Feather
                    name={showPassword ? "eye-off" : "eye"}
                    size={18}
                    color="gray"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* NEW: SAVE PASSWORD CHECKBOX */}
            <TouchableOpacity
              onPress={toggleSavePassword}
              disabled={loading}
              activeOpacity={0.7}
              className="flex-row items-center mt-4"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: savePassword }}
              accessibilityLabel="Save password"
            >
              <Feather
                name={savePassword ? "check-square" : "square"}
                size={20}
                color={savePassword ? "#16A34A" : "gray"}
              />
              <Text className="ml-2 text-gray-700 text-sm">Save password</Text>
            </TouchableOpacity>

            {/* LOGIN BUTTON */}
            <TouchableOpacity
              onPress={() => handleLogin()}
              disabled={loading || isLocked}
              className="bg-green-600 mt-8 mb-4 py-3 rounded-lg flex-row items-center justify-center"
              style={{ opacity: loading || isLocked ? 0.6 : 1 }}
              accessibilityRole="button"
            >
              {loading && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
              <Text className="text-white text-center font-medium">
                {loading
                  ? "Logging in..."
                  : isLocked
                    ? `Try again in ${lockoutSecondsLeft}s`
                    : "Login"}
              </Text>
            </TouchableOpacity>


            <TouchableOpacity onPress={() => setIsForgotPasswordOpen(true)} disabled={loading}>
              <Text className="text-green-600 text-center mt-5 font-medium">Forgot Password?</Text>
            </TouchableOpacity>

            <View className="flex-row items-center my-4">
              <View className="flex-1 h-px bg-gray-300" />
              <Text className="mx-3 text-gray-500 font-medium">
                OR
              </Text>
              <View className="flex-1 h-px bg-gray-300" />
            </View>

            {/* REGISTER BUTTON */}
            <TouchableOpacity
              onPress={() => setIsRegisterOpen(true)}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Register household account"
              activeOpacity={0.8}
              className="w-full py-4 rounded-xl bg-white border border-green-600 flex-row items-center justify-center"
              style={{ opacity: loading ? 0.6 : 1 }}
            >
              {/* <Feather name="user-plus" size={18} color="#10B981" /> */}
              <Text className="text-green-600 text-base font-semibold ml-2">
                Register Household Account
              </Text>
            </TouchableOpacity>

            <RegisterHousehold
              isOpen={isRegisterOpen}
              onClose={() => setIsRegisterOpen(false)}
            />

            <ForgotPasswordModal
              isOpen={isForgotPasswordOpen}
              onClose={() => setIsForgotPasswordOpen(false)}
            />

          </View>
        </View>
      </ScrollView>
    </View>
  );
}
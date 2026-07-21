import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_BASE } from "@/config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import RegisterHousehold from "@/components/RegisterHouseholdModal";
import ForgotPasswordModal from "@/components/ForgotPasswordModal";
// --- Config / constants -----------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000; // client-side cool-down after repeated failures

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

export default function AuthPage() {
  const router = useRouter();
  const [form, setForm] = useState<LoginForm>({ email: "", password: "" });
  const [isRegisterOpen, setIsRegisterOpen] = useState<boolean>(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState<number>(0);

  // Client-side throttling. UX safety net only — the server MUST enforce
  // its own rate limiting, since any client-side check can be bypassed.
  const attemptsRef = useRef<number>(0);
  const lockedUntilRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);

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
  }, [form, isLockedOut, registerFailedAttempt, router]);

  const isLocked = lockoutSecondsLeft > 0;

  return (
    <View className="flex-1 bg-gray-100 justify-center px-4">
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
            Welcome Back!
          </Text>

          {/* EMAIL */}
          <View>
            <Text className="text-sm mb-1 font-semibold">Email</Text>
            <View className="flex-row items-center mb-4 bg-gray-100 rounded-lg px-3 py-3">
              <Feather name="mail" size={18} color="gray" />
              <TextInput
                placeholder="Enter your email"
                value={form.email}
                onChangeText={(text: string) => setForm((f) => ({ ...f, email: text }))}
                className="flex-1 ml-3"
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
                secureTextEntry={!showPassword}
                value={form.password}
                onChangeText={(text: string) => setForm((f) => ({ ...f, password: text }))}
                className="flex-1 ml-3"
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
          <TouchableOpacity onPress={() => setIsRegisterOpen(true)} disabled={loading}>
            <Text className="text-green-600 text-center font-medium mt-1">
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
    </View>
  );
}
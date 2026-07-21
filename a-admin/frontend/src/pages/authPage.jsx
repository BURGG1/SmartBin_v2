import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import BASE_URL from "../config";
import ForgotPasswordModal from "../components/ForgotPasswordModal";


const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

const ROLE_ROUTES = {
  admin: "/dashboard",
  collector: "/collector",
  household: "/home",
};

// --- Helpers ------------------------------------------------------------

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default function AuthPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);
  const navigate = useNavigate();

  // Client-side throttling. UX safety net only — the server MUST enforce
  // its own rate limiting, since any client-side check can be bypassed.
  const attemptsRef = useRef(0);
  const lockedUntilRef = useRef(0);
  const inFlightRef = useRef(false);

  // Ticks every second so the lockout countdown shown in the UI stays
  // accurate in realtime, independent of any user interaction (submit,
  // typing, etc). Cheap no-op when not locked out.
  useEffect(() => {
    const id = setInterval(() => {
      const remainingMs = lockedUntilRef.current - Date.now();
      const secondsLeft = remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
      setLockoutSecondsLeft((prev) => (prev === secondsLeft ? prev : secondsLeft));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Cancel any in-flight request if the component unmounts mid-request
  // (e.g. user navigates away right after clicking Login).
  const abortRef = useRef(null);
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    if (error) setError("");
  };

  const isLockedOut = useCallback(() => {
    return Date.now() < lockedUntilRef.current;
  }, []);

  const registerFailedAttempt = useCallback(() => {
    attemptsRef.current += 1;
    if (attemptsRef.current >= MAX_ATTEMPTS) {
      lockedUntilRef.current = Date.now() + LOCKOUT_MS;
      attemptsRef.current = 0;
      // Kick the countdown state immediately so the banner appears
      // right away instead of waiting up to 1s for the next tick.
      setLockoutSecondsLeft(Math.ceil(LOCKOUT_MS / 1000));
    }
  }, []);

  const storeSession = (data) => {
    sessionStorage.setItem("token", data.token);
    sessionStorage.setItem("user", JSON.stringify(data.user));
    sessionStorage.setItem("role", data.role);
  };

  const handleLogin = useCallback(async () => {
    if (inFlightRef.current) return;
    if (isLockedOut()) return;
    setError("");

    const email = form.email.trim().toLowerCase();
    if (!email || !EMAIL_REGEX.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!form.password) {
      setError("Please enter your password.");
      return;
    }

    inFlightRef.current = true;
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/api/auth/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password: form.password }),
          signal: controller.signal,
        },
        REQUEST_TIMEOUT_MS
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        registerFailedAttempt();
        setError(data?.message || "Invalid credentials.");
        return;
      }

      if (data.role !== "admin") {
        registerFailedAttempt();
        setError("Access denied. This portal is for admins only.");
        return;
      }

      attemptsRef.current = 0;
      storeSession(data);

      // Clear the password from state now that we're done with it.
      setForm((f) => ({ ...f, password: "" }));

      const destination = ROLE_ROUTES[data.role];
      if (!destination) {
        setError("Access denied.");
        return;
      }
      navigate(destination);
    } catch (err) {
      if (err.name === "AbortError") {
        setError("The request timed out. Please try again.");
      } else {
        setError("Cannot connect to server. Make sure the backend is running.");
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [form, isLockedOut, registerFailedAttempt, navigate]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !loading && lockoutSecondsLeft === 0) {
      handleLogin();
    }
  };

  const isLocked = lockoutSecondsLeft > 0;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md text-center space-y-6">

        {/* LOGO */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center">
            <Trash2 className="text-white" size={32} />
          </div>
          <h1 className="text-xl font-semibold">
            Smart bin Waste Management with Segregation and Gamified System
          </h1>
          <p className="text-gray-500 text-sm">
            Manage waste collection efficiently
          </p>
        </div>

        {/* CARD */}
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-6">

          <h2 className="text-lg font-medium">Welcome Back!</h2>

          {/* Email */}
          <div className="space-y-1">
            <label htmlFor="email" className="block text-start text-bold text-sm mb-1">
              Email
            </label>
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50">
              <span><Mail size={18} /></span>
              <input
                id="email"
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Enter your email"
                className="w-full bg-transparent outline-none pl-4"
                required
                disabled={loading || isLocked}
                maxLength={254}
                autoComplete="email"
                autoFocus
              />
            </div>
          </div>

          {/* Password */}
          <div className="relative">
            <label htmlFor="password" className="block text-sm text-start mb-1">
              Password
            </label>
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50">
              <span><Lock size={18} /></span>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                value={form.password}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Enter your password"
                className="w-full bg-transparent outline-none pl-4"
                required
                disabled={loading || isLocked}
                maxLength={128}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="text-gray-500 hover:text-gray-700 cursor-pointer"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Error / lockout message — lockout countdown takes priority
              and re-renders every second via lockoutSecondsLeft state */}
          {isLocked ? (
            <p role="alert" aria-live="polite" className="text-red-500 text-sm text-left">
              Too many attempts. Please wait {lockoutSecondsLeft}s before trying again.
            </p>
          ) : error ? (
            <p role="alert" aria-live="polite" className="text-red-500 text-sm text-left">
              {error}
            </p>
          ) : null}

          <button
            onClick={handleLogin}
            disabled={loading || isLocked}
            type="button"
            className="w-full cursor-pointer bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading
              ? "Logging in..."
              : isLocked
              ? `Try again in ${lockoutSecondsLeft}s`
              : "Login"}
          </button>

          <p className="text-sm text-gray-500">
            Forgot your password?{" "}
            <span
              onClick={() => !loading && !isLocked && setIsForgotPasswordOpen(true)}
              className={`text-green-600 font-medium hover:underline ${
                loading || isLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
            >
              Reset here
            </span>
          </p>

        </div>
      </div>

      <ForgotPasswordModal
        isOpen={isForgotPasswordOpen}
        onClose={() => setIsForgotPasswordOpen(false)}
      />
    </div>
  );
}
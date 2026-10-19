import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Lock, Hash, Eye, EyeOff, X, ArrowLeft, Loader2, Check } from "lucide-react";
import BASE_URL from "../config";

// --- Config / constants -----------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_REGEX = /^\d{6}$/;
const MIN_PASSWORD_LENGTH = 8;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000; // client-side cool-down after repeated failures
const RESEND_COOLDOWN_MS = 30_000;

const INITIAL_FORM = {
  step: "email", // "email" | "reset" | "done"
  email: "",
  code: "",
  newPassword: "",
  confirmPassword: "",
};

function sanitizeEmail(raw) {
  return raw.trim().toLowerCase();
}

function validateEmail(email) {
  if (!email) return "Please enter your email address.";
  if (!EMAIL_REGEX.test(email)) return "Please enter a valid email address.";
  return null;
}

function validateReset({ code, newPassword, confirmPassword }) {
  if (!code || !CODE_REGEX.test(code)) {
    return "Please enter the 6-digit code sent to your email.";
  }
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (newPassword !== confirmPassword) {
    return "Passwords do not match.";
  }
  return null;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export default function ForgotPasswordModal({ isOpen, onClose, onResetSuccess }) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Client-side throttling. UX safety net only — the server MUST enforce
  // its own rate limiting, since any client-side check can be bypassed.
  const attemptsRef = useRef(0);
  const lockedUntilRef = useRef(0);
  const inFlightRef = useRef(false);
  const cooldownTimerRef = useRef(null);

  // Reset local state whenever the modal is closed, so no stale
  // email/code/password lingers or reappears on next open.
  useEffect(() => {
    if (!isOpen) {
      setForm(INITIAL_FORM);
      setError("");
      setShowPassword(false);
      setShowConfirmPassword(false);
      setResendCooldown(0);
      attemptsRef.current = 0;
      lockedUntilRef.current = 0;
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const startResendCooldown = useCallback(() => {
    setResendCooldown(RESEND_COOLDOWN_MS / 1000);
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    cooldownTimerRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const isLockedOut = useCallback(() => {
    const now = Date.now();
    if (now < lockedUntilRef.current) {
      const secondsLeft = Math.ceil((lockedUntilRef.current - now) / 1000);
      setError(`Too many attempts. Please wait ${secondsLeft}s before trying again.`);
      return true;
    }
    return false;
  }, []);

  const registerFailedAttempt = useCallback(() => {
    attemptsRef.current += 1;
    if (attemptsRef.current >= MAX_ATTEMPTS) {
      lockedUntilRef.current = Date.now() + LOCKOUT_MS;
      attemptsRef.current = 0;
    }
  }, []);

  const handleClose = useCallback(() => {
    if (loading) return; // don't allow dismiss mid-request
    onClose?.();
  }, [loading, onClose]);

  // --- Step 1: request a reset code ------------------------------------

  const requestCode = useCallback(async () => {
    if (inFlightRef.current) return;
    setError("");
    if (isLockedOut()) return;

    const email = sanitizeEmail(form.email);
    const validationError = validateEmail(email);
    if (validationError) {
      setError(validationError);
      return;
    }

    inFlightRef.current = true;
    setLoading(true);

    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/api/auth/forgot-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
        REQUEST_TIMEOUT_MS
      );

      // Don't assume the body is valid JSON — an error page/proxy could
      // return HTML and JSON.parse would throw.
      await response.json().catch(() => null);

      if (!response.ok) {
        registerFailedAttempt();
        setError("Something went wrong. Please try again.");
        return;
      }

      // Step advances regardless of whether the account exists — the
      // backend deliberately doesn't reveal that, so neither do we.
      setForm((f) => ({ ...f, email, step: "reset" }));
      startResendCooldown();
    } catch (err) {
      if (err.name === "AbortError") {
        setError("The request timed out. Please try again.");
      } else {
        setError("Cannot connect to server. Please check your connection and try again.");
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [form.email, isLockedOut, registerFailedAttempt, startResendCooldown]);

  const handleResend = useCallback(() => {
    if (resendCooldown > 0) return;
    requestCode();
  }, [resendCooldown, requestCode]);

  // --- Step 2: submit code + new password -------------------------------

  const handleResetPassword = useCallback(async () => {
    if (inFlightRef.current) return;
    setError("");
    if (isLockedOut()) return;

    const validationError = validateReset(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    inFlightRef.current = true;
    setLoading(true);

    try {
      const response = await fetchWithTimeout(
        `${BASE_URL}/api/auth/reset-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: form.email,
            code: form.code.trim(),
            newPassword: form.newPassword,
          }),
        },
        REQUEST_TIMEOUT_MS
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        registerFailedAttempt();
        // Generic message: don't reveal whether the code was wrong,
        // expired, or the account doesn't exist.
        setError("That code is invalid or has expired. Please try again.");
        return;
      }

      attemptsRef.current = 0;

      // Clear sensitive fields from state immediately, show a brief
      // confirmation, then close.
      setForm((f) => ({ ...INITIAL_FORM, step: "done" }));
      onResetSuccess?.();
    } catch (err) {
      if (err.name === "AbortError") {
        setError("The request timed out. Please try again.");
      } else {
        setError("Cannot connect to server. Please check your connection and try again.");
      }
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [form, isLockedOut, registerFailedAttempt, onResetSuccess]);

  const goBackToEmailStep = useCallback(() => {
    if (loading) return;
    setError("");
    setForm((f) => ({ ...f, code: "", newPassword: "", confirmPassword: "", step: "email" }));
  }, [loading]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key !== "Enter" || loading) return;
      if (form.step === "email") requestCode();
      if (form.step === "reset") handleResetPassword();
    },
    [form.step, loading, requestCode, handleResetPassword]
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 space-y-6">

        {/* HEADER */}
        <div className="flex items-center justify-between mb-2">
          {form.step === "reset" ? (
            <button
              type="button"
              onClick={goBackToEmailStep}
              disabled={loading}
              aria-label="Back"
              className="text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              <ArrowLeft size={20} />
            </button>
          ) : (
            <span className="w-5" />
          )}

          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center mb-2">
              {form.step === "done" ? (
                <Check className="text-white" size={22} />
              ) : (
                <Lock className="text-white" size={20} />
              )}
            </div>
            <h2 className="text-lg font-medium text-center">
              {form.step === "email" && "Forgot Password?"}
              {form.step === "reset" && "Reset Password"}
              {form.step === "done" && "All Set"}
            </h2>
            <p className="text-gray-500 text-sm text-center mt-1">
              {form.step === "email" && "Enter your email and we'll send you a reset code."}
              {form.step === "reset" && `Enter the code sent to ${form.email}`}
              {form.step === "done" && "Your password has been reset. You can log in now."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            aria-label="Close"
            className="text-gray-500 hover:text-red-400 cursor-pointer disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        {form.step === "email" && (
          <>
            <div className="space-y-1">
              <label className="block text-start text-sm font-semibold mb-1">Email</label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50">
                <Mail size={18} className="text-gray-500" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter your email"
                  className="w-full bg-transparent outline-none pl-2"
                  disabled={loading}
                  maxLength={254}
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            {error && <p className="text-red-500 text-sm text-left">{error}</p>}

            <button
              type="button"
              onClick={requestCode}
              disabled={loading}
              className="w-full cursor-pointer bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {loading ? "Sending..." : "Send Reset Code"}
            </button>
          </>
        )}

        {form.step === "reset" && (
          <>
            <div className="space-y-1">
              <label className="block text-start text-sm font-semibold mb-1">Reset Code</label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50">
                <Hash size={18} className="text-gray-500" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, code: e.target.value.replace(/[^0-9]/g, "").slice(0, 6) }))
                  }
                  onKeyDown={handleKeyDown}
                  placeholder="6-digit code"
                  className="w-full bg-transparent outline-none pl-2 tracking-widest"
                  disabled={loading}
                  maxLength={6}
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-start text-sm font-semibold mb-1">New Password</label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50">
                <Lock size={18} className="text-gray-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.newPassword}
                  onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  placeholder="At least 8 characters"
                  className="w-full bg-transparent outline-none pl-2"
                  disabled={loading}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-start text-sm font-semibold mb-1">Confirm Password</label>
              <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-gray-50">
                <Lock size={18} className="text-gray-500" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  onKeyDown={handleKeyDown}
                  placeholder="Re-enter new password"
                  className="w-full bg-transparent outline-none pl-2"
                  disabled={loading}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((prev) => !prev)}
                  tabIndex={-1}
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                  className="text-gray-500 hover:text-gray-700 cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {error && <p className="text-red-500 text-sm text-left">{error}</p>}

            <button
              type="button"
              onClick={handleResetPassword}
              disabled={loading}
              className="w-full cursor-pointer bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={18} className="animate-spin" />}
              {loading ? "Resetting..." : "Reset Password"}
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={loading || resendCooldown > 0}
              className="w-full text-sm text-center disabled:text-gray-400 text-green-600 hover:text-green-700 cursor-pointer disabled:cursor-not-allowed"
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
            </button>
          </>
        )}

        {form.step === "done" && (
          <button
            type="button"
            onClick={handleClose}
            className="w-full cursor-pointer bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg transition"
          >
            Back to Login
          </button>
        )}
      </div>
    </div>
  );
}
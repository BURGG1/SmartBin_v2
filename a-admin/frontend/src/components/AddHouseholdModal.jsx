import { X, Asterisk } from "lucide-react";
import { useState, useEffect } from "react";
import ConfirmationModal from "./confirmationModal";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config"; // ✅ import config

const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PH_MOBILE_REGEX = /^09\d{9}$/;
const MIN_BIRTH_DATE = "1900-01-01";

const normalizeContactNumber = (input) => {
    if (!input || typeof input !== "string") return null;
    let digits = input.replace(/\D/g, "");
    if (digits.startsWith("63") && digits.length === 12) digits = "0" + digits.slice(2);
    else if (digits.length === 10 && digits.startsWith("9")) digits = "0" + digits;
    return digits;
};

// ── Auto-formatting helpers (same rules as the mobile registration form) ────

// Capitalizes the first letter of each word (and after a hyphen) WITHOUT
// lowercasing the rest, so "McDonald" / "dela Cruz" typed deliberately survive.
const capitalizeWords = (str) =>
    str.replace(/(^|[\s-])(\S)/g, (_m, sep, ch) => sep + ch.toUpperCase());

// Fullname: strips digits/symbols that never belong in a name, collapses
// repeated spaces, drops leading spaces, capitalizes each word.
const formatFullnameInput = (raw) =>
    capitalizeWords(
        raw
            .replace(/[0-9_!@#$%^&*()+=[\]{};:"\\|<>/?~`]/g, "")
            .replace(/^\s+/, "")
            .replace(/\s{2,}/g, " ")
    );

// House No.: letters, digits and separators real house numbers use
// ("12-A", "Blk 3 Lot 5", "45/B").
const formatHouseNoInput = (raw) =>
    raw
        .replace(/[^A-Za-z0-9\s\-/#.,]/g, "")
        .replace(/^\s+/, "")
        .replace(/\s{2,}/g, " ");

// Street / Block: same as above, plus apostrophes, and capitalized per word
// ("rizal st." -> "Rizal St.", "purok 1" -> "Purok 1").
const formatStreetInput = (raw) =>
    capitalizeWords(
        raw
            .replace(/[^A-Za-z0-9\s\-/#.,'’]/g, "")
            .replace(/^\s+/, "")
            .replace(/\s{2,}/g, " ")
    );

// Email: never contains spaces and is stored lowercase.
const formatEmailInput = (raw) => raw.replace(/\s/g, "").toLowerCase();

// Family member: whole numbers only, max 2 digits (same as mobile).
const formatFamilyMemberInput = (raw) => raw.replace(/\D/g, "").slice(0, 2);

// Contact number: state keeps ONLY the 10-digit local part (the +63 badge is
// separate), so normalizeContactNumber / PH_MOBILE_REGEX behave as before.
// Handles pasted "09123456789", "+63 912 345 6789", "912-345-6789", etc.
const extractContactDigits = (raw) => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits.slice(0, 10);
};

// Display-only: "9123456789" -> "912-345-6789" (matches the placeholder).
const formatContactDisplay = (digits) => {
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

// Field name -> formatter, applied automatically inside handleChange.
const FIELD_FORMATTERS = {
    fullname:      formatFullnameInput,
    houseNo:       formatHouseNoInput,
    street:        formatStreetInput,
    email:         formatEmailInput,
    familyMember:  formatFamilyMemberInput,
    contactNumber: extractContactDigits,
};

// Local (not UTC) today as YYYY-MM-DD, used to block future birthdays.
const getTodayISO = () => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
};

export default function AddHousehold({ isOpen, onClose }) {
    const [active, setActive]       = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState("");
    const [rfidPolling, setRfidPolling] = useState(false); // ✅ show polling status

    const [form, setForm] = useState({
        fullname: "", birthday: "", familyMember: "",
        houseNo: "", street: "", contactNumber: "",
        email: "", rfid: "",
    });

    // ── Auto-fill RFID when ESP32 scans ──────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;

        setRfidPolling(true);
        const interval = setInterval(async () => {
            if (form.rfid) {
                setRfidPolling(false);
                return;
            }

            try {
                const res  = await fetch(`${BASE_URL}/api/rfid/latest-scan`); // ✅ use BASE_URL
                const data = await res.json();

                console.log("[RFID Poll]", data); // ✅ debug log

                if (data.success && data.rfid) {
                    setForm((prev) => ({ ...prev, rfid: data.rfid }));
                    setRfidPolling(false);
                }
            } catch (err) {
                console.error("[RFID Poll] Failed:", err);
            }
        }, 2000);

        return () => {
            clearInterval(interval);
            setRfidPolling(false);
        };
    }, [isOpen, form.rfid]);

    // Reset form on close
    useEffect(() => {
        if (!isOpen) {
            setForm({
                fullname: "", birthday: "", familyMember: "",
                houseNo: "", street: "", contactNumber: "",
                email: "", rfid: "",
            });
            setError("");
        }
    }, [isOpen]);

    // Runs the field's formatter (if it has one) before storing the value.
    const handleChange = (e) => {
        const { name, value } = e.target;
        const formatter = FIELD_FORMATTERS[name];
        setForm((prev) => ({ ...prev, [name]: formatter ? formatter(value) : value }));
        setError("");
    };

    const isEmailTaken = async (email) => {
        try {
            const res  = await fetch(`${BASE_URL}/api/households/check-email?email=${encodeURIComponent(email)}`); // ✅
            const data = await res.json();
            return data?.success ? !!data.exists : false;
        } catch {
            return false;
        }
    };

    const isContactTaken = async (contactNumber) => {
        try {
            const res  = await fetch(`${BASE_URL}/api/households/check-contact?contactNumber=${encodeURIComponent(contactNumber)}`); // ✅
            const data = await res.json();
            return data?.success ? !!data.exists : false;
        } catch {
            return false;
        }
    };

    const handleRegisterClick = async () => {
        if (!form.fullname.trim() || !form.contactNumber || !form.rfid) {
            setError("Fullname, Contact Number, and RFID are required.");
            return;
        }

        const normalizedContact = normalizeContactNumber(form.contactNumber);
        if (!normalizedContact || !PH_MOBILE_REGEX.test(normalizedContact)) {
            setError("Enter a valid contact number, e.g. 912-345-6789.");
            return;
        }

        let normalizedEmail = "";
        if (form.email) {
            normalizedEmail = form.email.trim().toLowerCase();
            if (!EMAIL_REGEX.test(normalizedEmail)) {
                setError("Enter a valid email address.");
                return;
            }
        } else {
            setError("No email provided — login credentials will not be sent.");
        }

        setLoading(true);
        try {
            const [emailTaken, contactTaken] = await Promise.all([
                normalizedEmail ? isEmailTaken(normalizedEmail) : Promise.resolve(false),
                isContactTaken(normalizedContact),
            ]);
            if (emailTaken)   { setError("This email is already registered.");          return; }
            if (contactTaken) { setError("This contact number is already registered."); return; }
        } finally {
            setLoading(false);
        }

        setActive(true);
    };

    const handleConfirm = async () => {
        setActive(false);
        setLoading(true);
        setError("");

        try {
            const response = await fetch(`${BASE_URL}/api/households`, { // ✅
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fullname:     form.fullname.trim(),
                    birthday:     form.birthday || null,
                    familyMember: form.familyMember ? parseInt(form.familyMember) : null,
                    address: {
                        houseNo: form.houseNo.trim() || null,
                        street:  form.street.trim()  || null,
                    },
                    contactNumber: form.contactNumber,
                    email:         form.email || null,
                    rfid:          form.rfid,
                }),
            });

            const data = await response.json();
            if (!response.ok) { setError(data.message || "Something went wrong."); return; }

            setShowToast(true);
            setForm({
                fullname: "", birthday: "", familyMember: "",
                houseNo: "", street: "", contactNumber: "",
                email: "", rfid: "",
            });
            setTimeout(() => onClose(), 1500);
        } catch {
            setError("Cannot connect to server. Make sure the backend is running.");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-2xl shadow-lg flex flex-col overflow-hidden">

                {/* HEADER */}
                <div className="flex justify-between items-center px-4 sm:px-6 py-4 border-b">
                    <h2 className="text-lg sm:text-xl font-bold">Register Household</h2>
                    <button onClick={onClose}>
                        <X className="text-gray-500 hover:text-gray-800" />
                    </button>
                </div>

                {/* BODY */}
                <div className="overflow-y-auto px-4 sm:px-6 py-5">
                    <div className="flex flex-col gap-4">

                        {/* Fullname */}
                        <div className="flex flex-col">
                            <label className="font-semibold flex items-center gap-1">
                                Fullname <Asterisk className="text-red-500 w-3 h-3" />
                            </label>
                            <input
                                type="text" name="fullname" value={form.fullname}
                                onChange={handleChange}
                                maxLength={100}
                                autoCapitalize="words"
                                className="mt-1 px-3 py-2 rounded-lg border w-full"
                                placeholder="ex. Janice Dela Cruz"
                            />
                        </div>

                        {/* Birthday + Family Member */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex flex-col">
                                <label className="font-semibold">Birthday</label>
                                <input
                                    type="date" name="birthday" value={form.birthday}
                                    onChange={handleChange}
                                    min={MIN_BIRTH_DATE}
                                    max={getTodayISO()}
                                    className="mt-1 px-3 py-2 rounded-lg border w-full"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="font-semibold">Family Member</label>
                                <input
                                    type="text" inputMode="numeric" name="familyMember" value={form.familyMember}
                                    onChange={handleChange}
                                    maxLength={2}
                                    className="mt-1 px-3 py-2 rounded-lg border w-full"
                                    placeholder="ex. 5"
                                />
                            </div>
                        </div>

                        {/* Address */}
                        <div className="flex flex-col gap-3">
                            <label className="font-semibold flex items-center gap-1">
                                Address <Asterisk className="text-red-500 w-3 h-3" />
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">House No.</label>
                                    <input
                                        type="text" name="houseNo" value={form.houseNo}
                                        onChange={handleChange}
                                        maxLength={20}
                                        className="mt-1 px-3 py-2 rounded-lg border w-full"
                                        placeholder="ex. 0123"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">Street / Block</label>
                                    <input
                                        type="text" name="street" value={form.street}
                                        onChange={handleChange}
                                        maxLength={60}
                                        className="mt-1 px-3 py-2 rounded-lg border w-full"
                                        placeholder="ex. Rizal St."
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Contact Number */}
                        <div className="flex flex-col">
                            <label className="font-semibold flex items-center gap-1">
                                Contact Number <Asterisk className="text-red-500 w-3 h-3" />
                            </label>
                            <div className="mt-1 flex items-center border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-gray-900">
                                <div className="bg-gray-100 px-3 py-2 text-gray-700 text-sm">
                                    🇵🇭 +63
                                </div>
                                {/* State keeps raw digits; the dashes are display-only. */}
                                <input
                                    type="tel" inputMode="numeric" name="contactNumber"
                                    value={formatContactDisplay(form.contactNumber)}
                                    onChange={handleChange}
                                    placeholder="912-345-6789"
                                    className="flex-1 px-3 py-2 outline-none"
                                />
                            </div>
                        </div>

                        {/* Email */}
                        <div className="flex flex-col">
                            <label className="font-semibold">Email</label>
                            <input
                                type="email" name="email" value={form.email}
                                onChange={handleChange}
                                maxLength={100}
                                autoCapitalize="none"
                                autoCorrect="off"
                                className="mt-1 px-3 py-2 rounded-lg border w-full"
                                placeholder="jdelacruz@email.com"
                            />
                        </div>

                        {/* RFID */}
                        <div className="flex flex-col items-center">
                            <div className="flex items-center gap-1">
                                <h3 className="text-lg font-semibold">Assign RFID</h3>
                                <Asterisk className="text-red-500 w-3 h-3" />
                            </div>
                            <p className="text-sm text-gray-500">
                                Scan or input RFID for this household
                            </p>
                        </div>

                        {/* RFID input + polling indicator */}
                        <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                                <input
                                    readOnly
                                    type="text"
                                    name="rfid"
                                    value={form.rfid}
                                    onChange={handleChange}
                                    placeholder={rfidPolling ? "Waiting for RFID scan..." : "Scan RFID"}
                                    className="w-full px-3 py-2 border rounded-lg pr-10"
                                />
                                {/* ✅ Animated dot shows polling is active */}
                                {rfidPolling && !form.rfid && (
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                )}
                            </div>
                            {/* ✅ Manual clear button */}
                            {form.rfid && (
                                <button
                                    onClick={() => {
                                        setForm((prev) => ({ ...prev, rfid: "" }));
                                        setRfidPolling(true);
                                    }}
                                    className="text-xs text-red-500 underline"
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {error && <p className="text-red-500 text-sm">{error}</p>}

                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={handleRegisterClick}
                                disabled={loading}
                                className="flex-1 bg-green-600 text-white py-2 rounded-lg disabled:opacity-50"
                            >
                                {loading ? "Registering..." : "Register"}
                            </button>
                        </div>
                    </div>
                </div>

                <ConfirmationModal
                    isOpen={active}
                    onClose={() => setActive(false)}
                    onConfirm={handleConfirm}
                />

                <SuccessToast
                    show={showToast}
                    onClose={() => setShowToast(false)}
                    message="Household successfully added!"
                />
            </div>
        </div>
    );
}
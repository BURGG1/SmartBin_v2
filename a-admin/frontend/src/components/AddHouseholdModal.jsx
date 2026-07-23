import { X, Asterisk } from "lucide-react";
import { useState, useEffect } from "react";
import ConfirmationModal from "./confirmationModal";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config"; // ✅ import config

const EMAIL_REGEX    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PH_MOBILE_REGEX = /^09\d{9}$/;

const normalizeContactNumber = (input) => {
    if (!input || typeof input !== "string") return null;
    let digits = input.replace(/\D/g, "");
    if (digits.startsWith("63") && digits.length === 12) digits = "0" + digits.slice(2);
    else if (digits.length === 10 && digits.startsWith("9")) digits = "0" + digits;
    return digits;
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

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
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
        if (!form.fullname || !form.contactNumber || !form.rfid) {
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
                    fullname:     form.fullname,
                    birthday:     form.birthday || null,
                    familyMember: form.familyMember ? parseInt(form.familyMember) : null,
                    address: {
                        houseNo: form.houseNo || null,
                        street:  form.street  || null,
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
                                    className="mt-1 px-3 py-2 rounded-lg border w-full"
                                />
                            </div>
                            <div className="flex flex-col">
                                <label className="font-semibold">Family Member</label>
                                <input
                                    type="number" name="familyMember" value={form.familyMember}
                                    onChange={handleChange}
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
                                        className="mt-1 px-3 py-2 rounded-lg border w-full"
                                        placeholder="ex. 0123"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">Street / Block</label>
                                    <input
                                        type="text" name="street" value={form.street}
                                        onChange={handleChange}
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
                                <input
                                    type="tel" name="contactNumber" value={form.contactNumber}
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
import { X, Asterisk } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import useSharedRfidUsb from "./useSharedRfidUsb";
import ConfirmationModal from "./confirmationModal";
import SuccessToast from "../assets/Toast";
import BASE_URL from "../config";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PH_MOBILE_REGEX = /^09\d{9}$/;
const MIN_BIRTH_DATE = "1900-01-01";

const normalizeContactNumber = (input) => {
    if (!input || typeof input !== "string") return null;
    let digits = input.replace(/\D/g, "");
    if (digits.startsWith("63") && digits.length === 12) digits = "0" + digits.slice(2);
    else if (digits.length === 10 && digits.startsWith("9")) digits = "0" + digits;
    return digits;
};

const capitalizeWords = (str) =>
    str.replace(/(^|[\s-])(\S)/g, (_m, sep, ch) => sep + ch.toUpperCase());

const formatFullnameInput = (raw) =>
    capitalizeWords(
        raw.replace(/[0-9_!@#$%^&*()+=[\]{};:"\\|<>/?~`]/g, "")
            .replace(/^\s+/, "")
            .replace(/\s{2,}/g, " ")
    );

const formatHouseNoInput = (raw) =>
    raw.replace(/[^A-Za-z0-9\s\-/#.,]/g, "")
        .replace(/^\s+/, "")
        .replace(/\s{2,}/g, " ");

const formatStreetInput = (raw) =>
    capitalizeWords(
        raw.replace(/[^A-Za-z0-9\s\-/#.,'’]/g, "")
            .replace(/^\s+/, "")
            .replace(/\s{2,}/g, " ")
    );

const formatEmailInput = (raw) => raw.replace(/\s/g, "").toLowerCase();
const formatFamilyMemberInput = (raw) => raw.replace(/\D/g, "").slice(0, 2);

const extractContactDigits = (raw) => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits.slice(0, 10);
};

const formatContactDisplay = (digits) => {
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const FIELD_FORMATTERS = {
    fullname: formatFullnameInput,
    houseNo: formatHouseNoInput,
    street: formatStreetInput,
    email: formatEmailInput,
    familyMember: formatFamilyMemberInput,
    contactNumber: extractContactDigits,
};

const getTodayISO = () => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${mm}-${dd}`;
};

const emptyForm = () => ({
    fullname: "", birthday: "", familyMember: "", houseNo: "", street: "",
    contactNumber: "", email: "", rfid: "",
});

export default function AddHousehold({ isOpen, onClose }) {
    const [active, setActive] = useState(false);
    const [showToast, setShowToast] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [form, setForm] = useState(emptyForm);

    const [wifiStatus, setWifiStatus] = useState("Wi-Fi polling waiting");
    const rfidValueRef = useRef("");

    const handleUsbUid = (uid) => {
        if (rfidValueRef.current) return;
        rfidValueRef.current = uid;
        setForm((prev) => ({ ...prev, rfid: uid }));
        setError("");
    };
    const { usbConnected, usbStatus, connectUsb: connectRfidUsb } = useSharedRfidUsb({
        isActive: isOpen,
        onUid: handleUsbUid,
    });

    // Wi-Fi fallback: poll the existing backend endpoint while the modal is open.
    // USB and Wi-Fi race to deliver the first UID; the first valid UID wins.
    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        setWifiStatus("Wi-Fi polling active");

        const pollLatestScan = async () => {
            if (cancelled || rfidValueRef.current) return;
            try {
                const response = await fetch(`${BASE_URL}/api/rfid/latest-scan`, {
                    cache: "no-store",
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                if (cancelled || rfidValueRef.current) return;

                if (data?.success && typeof data.rfid === "string") {
                    const uid = data.rfid.trim().toUpperCase();
                    if (/^(?:[0-9A-F]{2}-){3,9}[0-9A-F]{2}$/.test(uid)) {
                        rfidValueRef.current = uid;
                        setForm((prev) => ({ ...prev, rfid: uid }));
                        setWifiStatus(`RFID received via Wi-Fi: ${uid}`);
                        setError("");
                    }
                }
            } catch (err) {
                if (!cancelled) setWifiStatus("Wi-Fi polling unavailable; USB can still receive scans.");
            }
        };

        void pollLatestScan();
        const interval = setInterval(pollLatestScan, 2000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setForm(emptyForm());
            rfidValueRef.current = "";
            setError("");
            setActive(false);
        }
    }, [isOpen]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        const formatter = FIELD_FORMATTERS[name];
        setForm((prev) => ({ ...prev, [name]: formatter ? formatter(value) : value }));
        setError("");
    };

    const isEmailTaken = async (email) => {
        try {
            const res = await fetch(`${BASE_URL}/api/households/check-email?email=${encodeURIComponent(email)}`);
            const data = await res.json();
            return data?.success ? !!data.exists : false;
        } catch {
            return false;
        }
    };

    const isContactTaken = async (contactNumber) => {
        try {
            const res = await fetch(`${BASE_URL}/api/households/check-contact?contactNumber=${encodeURIComponent(contactNumber)}`);
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
        }

        setLoading(true);
        try {
            const [emailTaken, contactTaken] = await Promise.all([
                normalizedEmail ? isEmailTaken(normalizedEmail) : Promise.resolve(false),
                isContactTaken(normalizedContact),
            ]);
            if (emailTaken) {
                setError("This email is already registered.");
                return;
            }
            if (contactTaken) {
                setError("This contact number is already registered.");
                return;
            }
            setForm((prev) => ({ ...prev, contactNumber: normalizedContact, email: normalizedEmail }));
            setActive(true);
        } finally {
            setLoading(false);
        }
    };

    const handleConfirm = async () => {
        setActive(false);
        setLoading(true);
        setError("");
        try {
            const response = await fetch(`${BASE_URL}/api/households`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fullname: form.fullname.trim(),
                    birthday: form.birthday || null,
                    familyMember: form.familyMember ? parseInt(form.familyMember, 10) : null,
                    address: {
                        houseNo: form.houseNo.trim() || null,
                        street: form.street.trim() || null,
                    },
                    contactNumber: normalizeContactNumber(form.contactNumber),
                    email: form.email.trim().toLowerCase() || null,
                    rfid: form.rfid.trim().toUpperCase(),
                }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data.message || "Something went wrong.");
                return;
            }
            setShowToast(true);
            setForm(emptyForm());
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
                <div className="flex justify-between items-center px-4 sm:px-6 py-4 border-b">
                    <h2 className="text-lg sm:text-xl font-bold">Register Household</h2>
                    <button type="button" onClick={() => { onClose(); }} aria-label="Close">
                        <X className="text-gray-500 hover:text-red-400 cursor-pointer" />
                    </button>
                </div>

                <div className="overflow-y-auto px-4 sm:px-6 py-5">
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col">
                            <label className="font-semibold flex items-center gap-1">Fullname <Asterisk className="text-red-500 w-3 h-3" /></label>
                            <input type="text" name="fullname" value={form.fullname} onChange={handleChange} maxLength={100} autoCapitalize="words" className="mt-1 px-3 py-2 rounded-lg border w-full" placeholder="ex. Janice Dela Cruz" />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="flex flex-col">
                                <label className="font-semibold">Birthday</label>
                                <input type="date" name="birthday" value={form.birthday} onChange={handleChange} min={MIN_BIRTH_DATE} max={getTodayISO()} className="mt-1 px-3 py-2 rounded-lg border w-full" />
                            </div>
                            <div className="flex flex-col">
                                <label className="font-semibold">Family Member</label>
                                <input type="text" inputMode="numeric" name="familyMember" value={form.familyMember} onChange={handleChange} maxLength={2} className="mt-1 px-3 py-2 rounded-lg border w-full" placeholder="ex. 5" />
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <label className="font-semibold flex items-center gap-1">Address <Asterisk className="text-red-500 w-3 h-3" /></label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">House No.</label>
                                    <input type="text" name="houseNo" value={form.houseNo} onChange={handleChange} maxLength={20} className="mt-1 px-3 py-2 rounded-lg border w-full" placeholder="ex. 0123" />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-sm font-medium">Street / Block</label>
                                    <input type="text" name="street" value={form.street} onChange={handleChange} maxLength={60} className="mt-1 px-3 py-2 rounded-lg border w-full" placeholder="ex. Rizal St." />
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col">
                            <label className="font-semibold flex items-center gap-1">Contact Number <Asterisk className="text-red-500 w-3 h-3" /></label>
                            <div className="mt-1 flex items-center border rounded-lg overflow-hidden focus-within:ring-1 focus-within:ring-gray-900">
                                <div className="bg-gray-100 px-3 py-2 text-gray-700 text-sm">🇵🇭 +63</div>
                                <input type="tel" inputMode="numeric" name="contactNumber" value={formatContactDisplay(form.contactNumber)} onChange={handleChange} placeholder="912-345-6789" className="flex-1 px-3 py-2 outline-none" />
                            </div>
                        </div>

                        <div className="flex flex-col">
                            <label className="font-semibold flex items-center gap-1">Email</label>
                            <input type="email" name="email" value={form.email} onChange={handleChange} maxLength={100} autoCapitalize="none" autoCorrect="off" className="mt-1 px-3 py-2 rounded-lg border w-full" placeholder="jdelacruz@email.com" />
                        </div>

                        <div className="flex flex-col items-center">
                            <div className="flex items-center gap-1">
                                <h3 className="text-lg font-semibold">Assign RFID</h3>
                                <Asterisk className="text-red-500 w-3 h-3" />
                            </div>
                            <p className="text-sm text-gray-500">Scan by USB or Wi-Fi. Whichever delivers the UID first will fill this field.</p>
                        </div>

                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <p role="status" className="text-xs text-gray-500 flex items-center gap-1.5">
                                    <span className={`inline-block w-2 h-2 rounded-full ${usbConnected ? "bg-green-500" : "bg-gray-300"}`} />
                                    {usbConnected ? "USB reader connected" : usbStatus}
                                </p>
                                {!usbConnected && <button type="button" onClick={() => void connectRfidUsb()} className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2">Enable USB</button>}
                            </div>
                            <p role="status" className="text-xs text-gray-500">Wi-Fi scan is also active. {wifiStatus}</p>
                            <div className="flex items-center gap-2">
                                <input readOnly type="text" name="rfid" value={form.rfid} placeholder={usbConnected ? "Waiting for RFID scan..." : "Scan RFID card"} className="w-full px-3 py-2 border rounded-lg font-mono" />
                                {form.rfid && <button type="button" onClick={() => { rfidValueRef.current = ""; setForm((prev) => ({ ...prev, rfid: "" })); setWifiStatus("Wi-Fi polling active"); }} className="text-xs text-red-500 underline">Clear</button>}
                            </div>
                        </div>

                        {error && <p className="text-red-500 text-sm">{error}</p>}

                        <div className="flex gap-2 mt-4">
                            <button type="button" onClick={handleRegisterClick} disabled={loading} className="flex-1 bg-green-600 text-white py-2 rounded-lg disabled:opacity-50">
                                {loading ? "Registering..." : "Register"}
                            </button>
                        </div>
                    </div>
                </div>

                <ConfirmationModal isOpen={active} onClose={() => setActive(false)} onConfirm={handleConfirm} />
                <SuccessToast show={showToast} onClose={() => setShowToast(false)} message="Household successfully added!" />
            </div>
        </div>
    );
}

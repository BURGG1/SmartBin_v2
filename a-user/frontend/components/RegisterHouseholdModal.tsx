import { useState, useRef, useEffect, useCallback } from "react";
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    Modal,
    Pressable,
    ScrollView,
    Alert,
    FlatList,
    Keyboard,
    Platform,
    StyleSheet,
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
    birthday: string; // displayed/typed as MM/DD/YYYY
    houseNo: string;
    street: string;
    email: string;
    contactNumber: string; // holds only the local part typed after +63, e.g. "9123456789"
}

interface FormErrors {
    fullname?: string;
    familyMember?: string;
    birthday?: string;
    houseNo?: string;
    street?: string;
    email?: string;
    contactNumber?: string;
    consent?: string;
}

// Sections of the form we can scroll to when an input is focused.
type SectionKey = "fullname" | "birthday" | "familyMember" | "address" | "email" | "contact";

const INITIAL_FORM: FormState = {
    fullname: "",
    familyMember: "",
    birthday: "",
    houseNo: "",
    street: "",
    email: "",
    contactNumber: "",
};

// Explicit placeholder color so Android release builds / dark mode
// don't fall back to a white-ish system default (gray-400).
const PLACEHOLDER_COLOR = "#9CA3AF";

// ── Replace with your barangay's actual streets/puroks/sitios ──
const STREET_OPTIONS = [
    "Purok 1",
    "Purok 2",
    "Purok 3",
    "Purok 4",
    "Purok 5",
    "Purok 6",
    "Purok 7",
    "Purok 8",
];

const PH_MOBILE_REGEX = /^09\d{9}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BIRTHDAY_REGEX = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const MIN_BIRTH_YEAR = 1900;

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

// ── Auto-formatting helpers ─────────────────────────────────────────────────

// Fullname: removes digits/symbols that never belong in a name, collapses
// repeated spaces, drops leading spaces, and capitalizes the first letter of
// each word (and after a hyphen). It does NOT lowercase the rest, so
// "McDonald" / "dela Cruz" typed deliberately are left alone.
const formatFullnameInput = (raw: string): string => {
    return raw
        .replace(/[0-9_!@#$%^&*()+=[\]{};:"\\|<>/?~`]/g, "")
        .replace(/^\s+/, "")
        .replace(/\s{2,}/g, " ")
        .replace(/(^|[\s-])(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
};

// House No.: letters, digits and the few separators real house numbers use
// ("12-A", "Blk 3 Lot 5", "45/B"). Collapses repeated spaces.
const formatHouseNoInput = (raw: string): string => {
    return raw
        .replace(/[^A-Za-z0-9\s\-/#.,]/g, "")
        .replace(/^\s+/, "")
        .replace(/\s{2,}/g, " ");
};

// Email: never contains spaces and is stored lowercase.
const formatEmailInput = (raw: string): string => {
    return raw.replace(/\s/g, "").toLowerCase();
};

// Contact number: keeps ONLY the 10-digit local part in state (so
// normalizeContactNumber / validation keep working exactly as before).
// Handles pasted "09123456789", "+63 912 345 6789", "912-345-6789", etc.
const extractContactDigits = (raw: string): string => {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("63") && digits.length > 10) digits = digits.slice(2);
    if (digits.startsWith("0")) digits = digits.slice(1);
    return digits.slice(0, 10);
};

// Display-only: "9123456789" -> "912-345-6789" (matches the placeholder).
const formatContactDisplay = (digits: string): string => {
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
};

// Lets the user type digits plus "/" as a separator, in whatever order feels
// natural to them, while still auto-inserting "/" when they just type digits
// straight through:
//  - Typing "/" manually is honored as "move to the next segment" — a lone
//    digit gets padded (e.g. "9/" -> "09/") instead of the slash vanishing.
//  - Typing digits with no "/" still gets auto-formatted as you go.
//  - Backspacing over an auto-inserted "/" also removes the digit before it,
//    so deleting never feels "stuck".
const formatBirthdayInput = (raw: string, previous: string): string => {
    const isBackspace = raw.length < previous.length;

    if (isBackspace && previous.endsWith("/") && raw === previous.slice(0, -1)) {
        raw = raw.slice(0, -1);
    }

    const justTypedSlash = !isBackspace && raw.length === previous.length + 1 && raw.endsWith("/");
    let digits = raw.replace(/\D/g, "");

    if (justTypedSlash) {
        if (digits.length === 1) digits = "0" + digits; // e.g. "9/" -> month "09"
        else if (digits.length === 3) digits = `${digits.slice(0, 2)}0${digits.slice(2)}`; // day
    }

    digits = digits.slice(0, 8);
    const month = digits.slice(0, 2);
    const day = digits.slice(2, 4);
    const year = digits.slice(4, 8);

    if (digits.length <= 2) {
        // Respect a manually-typed "/" right after a completed 2-digit month
        // (e.g. "12" + "/" -> "12/") instead of silently dropping it.
        return justTypedSlash && digits.length === 2 ? `${month}/` : month;
    }
    if (digits.length <= 4) {
        return justTypedSlash && digits.length === 4 ? `${month}/${day}/` : `${month}/${day}`;
    }
    return `${month}/${day}/${year}`;
};

// Validates MM/DD/YYYY is a real, non-future calendar date within a sane
// range, and returns the equivalent ISO "YYYY-MM-DD" string for the API.
const parseBirthday = (value: string): { iso: string | null; error: string | null } => {
    const match = BIRTHDAY_REGEX.exec(value);
    if (!match) {
        return { iso: null, error: "Enter a valid date, e.g. 01/25/1990." };
    }

    const month = Number(match[1]);
    const day = Number(match[2]);
    const year = Number(match[3]);

    if (year < MIN_BIRTH_YEAR) {
        return { iso: null, error: `Year must be ${MIN_BIRTH_YEAR} or later.` };
    }

    const date = new Date(year, month - 1, day);
    const isRealDate =
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day;

    if (!isRealDate) {
        return { iso: null, error: "That date doesn't exist. Please check it." };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date.getTime() > today.getTime()) {
        return { iso: null, error: "Birthday cannot be in the future." };
    }

    const iso = `${year.toString().padStart(4, "0")}-${match[1]}-${match[2]}`;
    return { iso, error: null };
};

export default function RegisterHousehold({ isOpen, onClose }: RegisterHouseholdProps) {
    const [loading, setLoading] = useState(false);
    const [form, setForm] = useState<FormState>(INITIAL_FORM);
    const [errors, setErrors] = useState<FormErrors>({});
    const [streetPickerOpen, setStreetPickerOpen] = useState(false);
    const [privacyOpen, setPrivacyOpen] = useState(false);
    const [consent, setConsent] = useState(false);

    const submittingRef = useRef(false);
    const scrollRef = useRef<ScrollView>(null);
    const sectionY = useRef<Partial<Record<SectionKey, number>>>({});

    // ── Keyboard handling ───────────────────────────────────────────────────
    // Android often shrinks the Modal's window by itself when the keyboard opens
    // (adjustResize), while iOS never does. If we also add padding on a window that
    // already shrank, the keyboard is compensated twice and the card collapses to a
    // sliver. So instead of guessing, we MEASURE: we compare where the bottom of our
    // root view sits on screen with where the keyboard starts. If the keyboard covers
    // part of the view, we pad by exactly that amount. If the window already shrank,
    // the overlap comes out as 0 and no padding is added.
    const rootRef = useRef<View>(null);
    const keyboardTopRef = useRef<number | null>(null); // where the keyboard starts on screen
    const [keyboardOverlap, setKeyboardOverlap] = useState(0);

    const recomputeOverlap = useCallback(() => {
        const kbTop = keyboardTopRef.current;
        if (kbTop == null) {
            setKeyboardOverlap(0);
            return;
        }
        rootRef.current?.measureInWindow((_x, y, _w, h) => {
            const overlap = Math.max(0, y + h - kbTop);
            setKeyboardOverlap((prev) => (Math.abs(prev - overlap) < 1 ? prev : overlap));
        });
    }, []);

    useEffect(() => {
        const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
        const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

        const showSub = Keyboard.addListener(showEvent, (e) => {
            keyboardTopRef.current = e.endCoordinates.screenY;
            recomputeOverlap();
            // Android sometimes finishes resizing the window a moment later, so measure again.
            setTimeout(recomputeOverlap, 150);
        });
        const hideSub = Keyboard.addListener(hideEvent, () => {
            keyboardTopRef.current = null;
            setKeyboardOverlap(0);
        });

        return () => {
            showSub.remove();
            hideSub.remove();
        };
    }, [recomputeOverlap]);

    // Clear keyboard state whenever the modal closes.
    useEffect(() => {
        if (!isOpen) {
            keyboardTopRef.current = null;
            setKeyboardOverlap(0);
        }
    }, [isOpen]);

    // Scrolls the focused field's section to the top of the card's scroll area.
    const focusSection = (key: SectionKey) => {
        // Give the keyboard + layout time to settle before scrolling.
        setTimeout(() => {
            const y = sectionY.current[key];
            if (y != null) {
                scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
            }
        }, 250);
    };

    const trackSection = (key: SectionKey) => ({
        onLayout: (e: { nativeEvent: { layout: { y: number } } }) => {
            sectionY.current[key] = e.nativeEvent.layout.y;
        },
    });

    const handleChange = (field: keyof FormState, value: string) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        if (errors[field]) {
            setErrors((prev) => ({ ...prev, [field]: undefined }));
        }
    };

    const resetForm = () => {
        setForm(INITIAL_FORM);
        setErrors({});
        setConsent(false);
        setPrivacyOpen(false);
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

    const validate = (normalizedContact: string | null): { errors: FormErrors; birthdayIso: string | null } => {
        const next: FormErrors = {};
        const fullname = form.fullname.trim();
        const houseNo = form.houseNo.trim();
        const street = form.street.trim();
        const email = form.email.trim();
        const birthday = form.birthday.trim();

        if (!fullname) {
            next.fullname = "Fullname is required.";
        } else if (fullname.length < 2) {
            next.fullname = "Fullname looks too short.";
        }

        // Optional, same as the web form — but if the user types something,
        // it still has to be a real, valid date.
        let birthdayIso: string | null = null;
        if (birthday) {
            const { iso, error } = parseBirthday(birthday);
            if (error) {
                next.birthday = error;
            } else {
                birthdayIso = iso;
            }
        }

        if (!houseNo) next.houseNo = "House number is required.";
        if (!street) next.street = "Please select your street/purok.";

        if (!form.contactNumber.trim()) {
            next.contactNumber = "Contact number is required.";
        } else if (!normalizedContact || !PH_MOBILE_REGEX.test(normalizedContact)) {
            next.contactNumber = "Enter a valid number, e.g. 912-345-6789.";
        }

        // Email is optional — but if provided, it must be valid
        if (email && !EMAIL_REGEX.test(email)) {
            next.email = "Enter a valid email address.";
        }

        if (form.familyMember.trim()) {
            const n = Number(form.familyMember.trim());
            if (!Number.isInteger(n) || n < 0) {
                next.familyMember = "Enter a valid number of family members.";
            }
        }

        if (!consent) {
            next.consent = "You must agree to the Data Privacy Notice to continue.";
        }

        return { errors: next, birthdayIso };
    };

    const submitRequest = async (normalizedContact: string, birthdayIso: string | null) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setLoading(true);

        const hasEmail = !!form.email.trim();

        try {
            const response = await fetch(`${API_BASE}/api/requests`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fullname: form.fullname.trim(),
                    familyMember: form.familyMember.trim()
                        ? parseInt(form.familyMember.trim(), 10)
                        : null,
                    birthday: birthdayIso, // YYYY-MM-DD, same key/format the web app sends
                    address: {
                        houseNo: form.houseNo.trim(),
                        street: form.street.trim(),
                    },
                    email: hasEmail ? form.email.trim().toLowerCase() : null,
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
                hasEmail
                    ? "Your registration is pending admin approval. You will receive your credentials via email once approved."
                    : "Your registration is pending admin approval. You will be contacted once it is approved.",
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

        const { errors: validationErrors, birthdayIso } = validate(normalizedContact);
        setErrors(validationErrors);
        if (Object.keys(validationErrors).length > 0) return;

        // normalizedContact is guaranteed valid past this point; birthdayIso may be
        // null if the user left birthday blank (it's optional, like on the web form)
        const emailValue = form.email.trim().toLowerCase();

        const [emailTaken, contactTaken] = await Promise.all([
            // Email is optional: skip the duplicate lookup when it's empty
            emailValue ? isEmailTaken(emailValue) : Promise.resolve(false),
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
                {
                    text: "Confirm",
                    onPress: () => submitRequest(normalizedContact as string, birthdayIso),
                },
            ]
        );
    };

    // Only the X button calls this. Tapping outside the card or pressing the
    // Android back button no longer closes the modal.
    const handleClose = () => {
        if (loading) return;
        resetForm();
        onClose();
    };

    return (
        <Modal
            visible={isOpen}
            animationType="fade"
            statusBarTranslucent
            onRequestClose={() => {}} // Android back button does nothing; use the X button
        >
            {/* Root: we measure this view against the keyboard's top edge to know
                how much (if any) bottom padding is really needed. */}
            <View
                ref={rootRef}
                collapsable={false}
                onLayout={recomputeOverlap}
                style={{ flex: 1, backgroundColor: "white" }}
            >
                {/* Bottom padding is only added when the keyboard really overlaps us,
                    so the card (and its ScrollView) always fit above the keyboard. */}
                <View
                    className="flex-1 bg-black/40 justify-center items-center p-4"
                    style={{ paddingBottom: 16 + keyboardOverlap }}
                >
                    {/* Card (plain View so it doesn't intercept scroll gestures) */}
                    <View className="bg-white w-full max-w-lg max-h-full rounded-2xl overflow-hidden">
                        {/* HEADER */}
                        <View className="flex-row justify-between items-center px-6 py-4 border-b border-gray-200">
                            <Text className="text-lg font-bold">Register Household</Text>
                            <TouchableOpacity onPress={handleClose} disabled={loading} hitSlop={8}>
                                <Ionicons name="close" size={22} color="gray" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView
                            ref={scrollRef}
                            style={{ flexShrink: 1 }}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
                            showsVerticalScrollIndicator={false}
                            overScrollMode="never"
                            contentContainerStyle={{ padding: 20, paddingBottom: 24 }}
                        >
                            {/* Fullname */}
                            <View className="mb-3" {...trackSection("fullname")}>
                                <View className="flex-row items-center">
                                    <Text className="text-lg font-semibold">Fullname</Text>
                                    <Text className="text-red-500 ml-1">*</Text>
                                </View>
                                <TextInput
                                    placeholder="ex. Janice S. Dela Cruz"
                                    placeholderTextColor={PLACEHOLDER_COLOR}
                                    value={form.fullname}
                                    onChangeText={(v) => handleChange("fullname", formatFullnameInput(v))}
                                    onFocus={() => focusSection("fullname")}
                                    autoCapitalize="words"
                                    maxLength={100}
                                    editable={!loading}
                                    className={`border rounded-lg px-3 py-2 mt-1 text-black ${errors.fullname ? "border-red-500" : "border-gray-300"
                                        }`}
                                />
                                {errors.fullname && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.fullname}</Text>
                                )}
                            </View>

                            {/* Birthday */}
                            <View className="mb-3" {...trackSection("birthday")}>
                                <Text className="text-lg font-semibold">Birthday</Text>
                                <TextInput
                                    placeholder="MM/DD/YYYY"
                                    placeholderTextColor={PLACEHOLDER_COLOR}
                                    keyboardType="default"
                                    value={form.birthday}
                                    onChangeText={(v) => handleChange("birthday", formatBirthdayInput(v, form.birthday))}
                                    onFocus={() => focusSection("birthday")}
                                    maxLength={10}
                                    editable={!loading}
                                    className={`border rounded-lg px-3 py-2 mt-1 text-black ${errors.birthday ? "border-red-500" : "border-gray-300"
                                        }`}
                                />
                                {errors.birthday && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.birthday}</Text>
                                )}
                            </View>

                            {/* Family Member */}
                            <View className="mb-3" {...trackSection("familyMember")}>
                                <Text className="text-lg font-semibold">Family Member</Text>
                                <TextInput
                                    placeholder="ex. 5"
                                    placeholderTextColor={PLACEHOLDER_COLOR}
                                    keyboardType="numeric"
                                    value={form.familyMember}
                                    onChangeText={(v) => handleChange("familyMember", v.replace(/[^0-9]/g, ""))}
                                    onFocus={() => focusSection("familyMember")}
                                    maxLength={2}
                                    editable={!loading}
                                    className={`border rounded-lg px-3 py-2 mt-1 text-black ${errors.familyMember ? "border-red-500" : "border-gray-300"
                                        }`}
                                />
                                {errors.familyMember && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.familyMember}</Text>
                                )}
                            </View>

                            {/* Address */}
                            <View className="mb-3" {...trackSection("address")}>
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
                                            placeholderTextColor={PLACEHOLDER_COLOR}
                                            value={form.houseNo}
                                            onChangeText={(v) => handleChange("houseNo", formatHouseNoInput(v))}
                                            onFocus={() => focusSection("address")}
                                            maxLength={20}
                                            editable={!loading}
                                            className={`border rounded-lg px-3 py-2 mt-1 text-black ${errors.houseNo ? "border-red-500" : "border-gray-300"
                                                }`}
                                        />
                                        {errors.houseNo && (
                                            <Text className="text-red-500 text-xs mt-1">{errors.houseNo}</Text>
                                        )}
                                    </View>

                                    {/* ── Street/Purok picker instead of freeform text ── */}
                                    <View>
                                        <View className="flex-row items-center">
                                            <Text className="font-semibold">Purok</Text>
                                            <Text className="text-red-500 ml-1">*</Text>
                                        </View>
                                        <TouchableOpacity
                                            onPress={() => {
                                                if (loading) return;
                                                Keyboard.dismiss();
                                                setStreetPickerOpen(true);
                                            }}
                                            disabled={loading}
                                            className={`border rounded-lg px-3 py-2 mt-1 flex-row justify-between items-center ${errors.street ? "border-red-500" : "border-gray-300"
                                                }`}
                                        >
                                            <Text className={form.street ? "text-black" : "text-gray-400"}>
                                                {form.street || "Select your Purok"}
                                            </Text>
                                            <Ionicons name="chevron-down" size={18} color="gray" />
                                        </TouchableOpacity>
                                        {errors.street && (
                                            <Text className="text-red-500 text-xs mt-1">{errors.street}</Text>
                                        )}
                                    </View>
                                </View>
                            </View>

                            {/* Email (optional) */}
                            <View className="mb-3" {...trackSection("email")}>
                                <View className="flex-row items-center">
                                    <Text className="text-lg font-semibold">Email</Text>
                                </View>
                                <TextInput
                                    placeholder="ex. janicedelacruz@gmail.com"
                                    placeholderTextColor={PLACEHOLDER_COLOR}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    value={form.email}
                                    onChangeText={(v) => handleChange("email", formatEmailInput(v))}
                                    onFocus={() => focusSection("email")}
                                    maxLength={100}
                                    editable={!loading}
                                    className={`border rounded-lg px-3 py-2 mt-1 text-black ${errors.email ? "border-red-500" : "border-gray-300"
                                        }`}
                                />
                                {errors.email && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.email}</Text>
                                )}
                            </View>

                            {/* Contact Number — same +63 prefix pattern as the admin panel */}
                            <View className="mb-3" {...trackSection("contact")}>
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
                                    {/* State keeps raw digits; the dashes are display-only.
                                        No maxLength here: extractContactDigits caps at 10 digits
                                        and a hard limit would truncate pasted numbers. */}
                                    <TextInput
                                        placeholder="912-345-6789"
                                        placeholderTextColor={PLACEHOLDER_COLOR}
                                        keyboardType="phone-pad"
                                        value={formatContactDisplay(form.contactNumber)}
                                        onChangeText={(v) => handleChange("contactNumber", extractContactDigits(v))}
                                        onFocus={() => focusSection("contact")}
                                        editable={!loading}
                                        className="flex-1 px-3 py-2 text-black"
                                    />
                                </View>
                                {errors.contactNumber && (
                                    <Text className="text-red-500 text-xs mt-1">{errors.contactNumber}</Text>
                                )}
                            </View>

                            {/* Consent (RA 10173). The notice itself opens in a modal when the
                                bold "Data Privacy Notice" text is tapped. */}
                            <TouchableOpacity
                                onPress={() => {
                                    if (loading) return;
                                    setConsent((c) => !c);
                                    if (errors.consent) setErrors((prev) => ({ ...prev, consent: undefined }));
                                }}
                                disabled={loading}
                                activeOpacity={0.7}
                                className="flex-row items-start mt-4"
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: consent }}
                            >
                                <Ionicons
                                    name={consent ? "checkbox" : "square-outline"}
                                    size={22}
                                    color={errors.consent ? "#ef4444" : consent ? "#16a34a" : "#6B7280"}
                                />
                                <Text className="flex-1 ml-2 text-md text-gray-700 leading-5">
                                    I have read and understood the{" "}
                                    <Text
                                        className="font-bold text-md text-green-700 underline"
                                        onPress={() => setPrivacyOpen(true)}
                                        accessibilityRole="link"
                                    >
                                        Data Privacy Notice
                                    </Text>
                                    , and I voluntarily consent to the collection and processing of my
                                    personal information in accordance with RA 10173.
                                </Text>
                            </TouchableOpacity>
                            {errors.consent && (
                                <Text className="text-red-500 text-sm mt-1">{errors.consent}</Text>
                            )}

                            {/* Button */}
                            <TouchableOpacity
                                onPress={handleRegister}
                                disabled={loading}
                                className="mt-5 mb-5 bg-green-600 rounded-lg p-3 items-center"
                                activeOpacity={0.8}
                                style={{ opacity: loading ? 0.6 : 1 }}
                            >
                                <Text className="text-white font-semibold">
                                    {loading ? "Submitting..." : "Register"}
                                </Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </View>
                </View>

                {/* ── Street/Purok picker modal ── */}
                <Modal
                    visible={streetPickerOpen}
                    animationType="slide"
                    transparent
                    onRequestClose={() => setStreetPickerOpen(false)}
                >
                    <View className="flex-1 bg-black/40 justify-end items-center p-4">
                        <Pressable
                            style={StyleSheet.absoluteFill}
                            onPress={() => setStreetPickerOpen(false)}
                        />
                        <View className="w-[90%] bg-white rounded-t-2xl max-h-[70%]">
                            <View className="flex-row justify-between items-center px-5 py-4 border-b border-gray-200">
                                <Text className="text-lg font-bold">Select Purok</Text>
                                <TouchableOpacity onPress={() => setStreetPickerOpen(false)} hitSlop={8}>
                                    <Ionicons name="close" size={22} color="gray" />
                                </TouchableOpacity>
                            </View>
                            <FlatList
                                data={STREET_OPTIONS}
                                keyExtractor={(item) => item}
                                showsVerticalScrollIndicator={false}
                                overScrollMode="never"
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
                        </View>
                    </View>
                </Modal>

                {/* ── Data Privacy Notice modal (RA 10173) ── */}
                <Modal
                    visible={privacyOpen}
                    animationType="fade"
                    transparent
                    statusBarTranslucent
                    onRequestClose={() => setPrivacyOpen(false)}
                >
                    <View className="flex-1 bg-black/40 justify-center items-center p-4">
                        <Pressable
                            style={StyleSheet.absoluteFill}
                            onPress={() => setPrivacyOpen(false)}
                        />
                        <View className="w-full max-w-lg max-h-[80%] bg-white rounded-2xl overflow-hidden">
                            <View className="flex-row justify-between items-center px-5 py-4 border-b border-gray-200">
                                <View className="flex-row items-center">
                                    <Ionicons name="shield-checkmark-outline" size={20} color="#16a34a" />
                                    <Text className="ml-2 text-lg font-bold text-gray-800">
                                        Data Privacy Notice
                                    </Text>
                                </View>
                                <TouchableOpacity onPress={() => setPrivacyOpen(false)} hitSlop={8}>
                                    <Ionicons name="close" size={22} color="gray" />
                                </TouchableOpacity>
                            </View>

                            <ScrollView
                                showsVerticalScrollIndicator={false}
                                overScrollMode="never"
                                contentContainerStyle={{ padding: 20 }}
                            >
                                <Text className="text-md text-gray-700 leading-5">
                                    In compliance with Republic Act No. 10173, or the Data Privacy Act of 2012, the
                                    Barangay collects your full name, birthday, number of family members, address,
                                    email, and contact number solely to register your household, verify your identity,
                                    send your account credentials, and deliver barangay services.
                                </Text>
                                <Text className="text-md text-gray-700 leading-5 mt-3">
                                    Your information will be kept confidential, stored securely, accessed only by
                                    authorized barangay personnel, and will not be shared with third parties without
                                    your consent, except as required by law.
                                </Text>
                                <Text className="text-md text-gray-700 leading-5 mt-3">
                                    You have the right to be informed, to access, correct, object to, or request
                                    erasure of your personal data, and to file a complaint with the National Privacy
                                    Commission. For concerns, contact the Barangay Data Protection Officer.
                                </Text>
                            </ScrollView>

                            <View className="px-5 py-4 border-t border-gray-200">
                                <TouchableOpacity
                                    onPress={() => setPrivacyOpen(false)}
                                    activeOpacity={0.8}
                                    className="bg-green-600 rounded-lg p-3 items-center"
                                >
                                    <Text className="text-white font-semibold">Close</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>
            </View>
        </Modal>
    );
}
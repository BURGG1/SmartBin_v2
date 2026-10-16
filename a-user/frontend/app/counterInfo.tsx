import React, { useCallback, useMemo, useRef, useState } from "react";
import {
    View, Text, TouchableOpacity, ActivityIndicator, Alert, Image,
    Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store"; // same token lookup as CollectorHome
import { API_BASE } from "@/config";

const REQUEST_TIMEOUT_MS = 20_000;

interface Bin { id: string; type?: string; location?: string; collectorDone?: boolean; }

interface BagPreview {
    logId: string;
    stampNumber: string;
    binId: string;
    household: any; // populated object, raw id string, or null
    householdId?: string;
    scannedAt: string;
    flagged: boolean;
    flaggedAt: string | null;
}

// ── Look & feel (matches CollectorHome) ──────────────────────────────────────
const cardShadow = {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
} as const;

const card = {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    marginTop: 20,
    ...cardShadow,
} as const;

// reads the login token from wherever the login screen saved it (same as CollectorHome)
async function getToken() {
    const secure = await SecureStore.getItemAsync("authToken");
    if (secure) return secure;
    return (await AsyncStorage.getItem("token")) ?? (await AsyncStorage.getItem("authToken"));
}

async function apiFetch(path: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
    const token = await getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            ...init,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            signal: controller.signal,
        });
        let body: any = null;
        try { body = await res.json(); } catch { /* non-JSON response */ }
        return { res, body };
    } finally {
        clearTimeout(timer);
    }
}

function describeError(status: number, body: any, fallback: string) {
    if (status === 401) return "Session expired. Please log in again.";
    return body?.message ?? fallback;
}

function networkMessage(err: unknown) {
    return err instanceof Error && err.name === "AbortError"
        ? "The request timed out. Please try again."
        : "Could not reach the server. Check your connection.";
}

function toDateStr(d: string | Date) {
    return new Date(d).toISOString().split("T")[0];
}

// Turns whatever the server sends (plain id string, or an object with _id)
// into the same "HH-XXXXXXXX" format used in the Counter Information screen.
function formatHouseholdId(h: any): string | null {
    if (!h) return null;
    const raw = typeof h === "string" ? h : String(h._id ?? h.id ?? "");
    if (!raw) return null;
    if (raw.startsWith("HH-")) return raw;
    return `HH-${raw.slice(-8).toUpperCase()}`;
}

function getHouseholdId(p: BagPreview) {
    return formatHouseholdId(p.householdId) ?? formatHouseholdId(p.household) ?? "Unknown";
}

// Fallback: the Counter Information screen gets the household from /api/rfid/logs,
// so if the stamp lookup doesn't include it, find the same bag in that day's logs.
async function findHouseholdFromLogs(p: BagPreview, binId: string) {
    try {
        const day = toDateStr(p.scannedAt);
        const params = new URLSearchParams({
            binId, action: "dispose", page: "1", limit: "100", from: day, to: day,
        });
        const { res, body } = await apiFetch(`/api/rfid/logs?${params}`, { method: "GET" });
        if (!res.ok || !body?.success || !Array.isArray(body.data)) return null;
        const match = body.data.find(
            (l: any) =>
                String(l._id) === String(p.logId) ||
                String(l.disposalOrder) === String(Number(p.stampNumber))
        );
        return match?.household ?? null;
    } catch {
        return null;
    }
}

function toFilePart(uri: string) {
    const filename = uri.split("/").pop() ?? "photo.jpg";
    const ext = filename.split(".").pop()?.toLowerCase();
    return {
        uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
        name: filename,
        type: ext === "png" ? "image/png" : "image/jpeg",
    } as any;
}

export default function TypeNumberScreen() {
    const { bin: binParam } = useLocalSearchParams<{ bin?: string }>();
    const bin = useMemo<Bin | null>(() => {
        try { return binParam ? (JSON.parse(binParam) as Bin) : null; }
        catch { return null; }
    }, [binParam]);

    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);

    const [busy, setBusy] = useState<"idle" | "reading" | "flagging" | "completing">("idle");
    const [value, setValue] = useState("");
    const [error, setError] = useState("");
    const [preview, setPreview] = useState<BagPreview | null>(null);
    const [photoUri, setPhotoUri] = useState<string | null>(null);

    // true once this collector reported the bin as done
    const [doneMarked, setDoneMarked] = useState(false);
    const isDone = doneMarked || !!bin?.collectorDone;

    // custom confirmation modal for "Done Collection"
    const [confirmDoneOpen, setConfirmDoneOpen] = useState(false);

    // Proof-photo flow (only used when flagging)
    const [proofOpen, setProofOpen] = useState(false);
    const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
    const [capturing, setCapturing] = useState(false);

    const reset = useCallback(() => {
        setValue("");
        setError("");
        setPreview(null);
        setPhotoUri(null);
        setBusy("idle");
        setProofOpen(false);
        setPendingPhoto(null);
        setCapturing(false);
    }, []);

    // ── Lookup by typed number ───────────────────────────────────────────────
    const handleLookup = async () => {
        if (!bin?.id || busy !== "idle") return;
        if (!/^\d{1,6}$/.test(value)) {
            setError("Enter the number printed on the bag (up to 6 digits).");
            setPreview(null);
            return;
        }
        Keyboard.dismiss();
        setError("");
        setPreview(null);
        setPhotoUri(null);
        setBusy("reading");
        try {
            const { res, body } = await apiFetch(
                `/api/rfid/stamp/${encodeURIComponent(bin.id)}/${value}`, { method: "GET" }
            );
            if (!res.ok || !body?.success) {
                setError(describeError(res.status, body, "Trash bag record not found."));
                return;
            }
            // DEBUG: shows what the server really sends (check your Metro terminal).
            // You can delete this line once the household ID shows correctly.
            console.log("Stamp lookup data:", JSON.stringify(body.data));
            let data = body.data as BagPreview;
            if (getHouseholdId(data) === "Unknown") {
                const hh = await findHouseholdFromLogs(data, bin.id);
                if (hh) data = { ...data, household: hh };
            }
            setPreview(data);
        } catch (err) {
            setError(networkMessage(err));
        } finally {
            setBusy("idle");
        }
    };

    // ── Flag ─────────────────────────────────────────────────────────────────
    const submitFlag = async (evidenceUri: string) => {
        if (!preview || !bin?.id || busy !== "idle") return;
        setBusy("flagging");
        try {
            const form = new FormData();
            form.append("source", "mobile-manual");
            form.append("evidencePhoto", toFilePart(evidenceUri));

            const { res, body } = await apiFetch(
                `/api/rfid/stamp/${encodeURIComponent(bin.id)}/${preview.stampNumber}/flag`,
                { method: "PATCH", body: form },
                30_000
            );

            if (res.status === 409) {
                setPreview({ ...preview, flagged: true });
                return;
            }
            if (!res.ok || !body?.success) {
                Alert.alert("Could not flag", describeError(res.status, body, "Please try again."));
                return;
            }
            Alert.alert(
                "Household flagged",
                `Household ${getHouseholdId(preview)} was flagged for bag #${preview.stampNumber}. The admin will review it.`,
                [{ text: "Done", onPress: reset }]
            );
        } catch (err) {
            Alert.alert("Error", networkMessage(err));
        } finally {
            setBusy("idle");
        }
    };

    const openProofCamera = async () => {
        if (!permission?.granted) {
            const result = await requestPermission();
            if (!result.granted) {
                Alert.alert("Camera needed", "Camera access is required to take a proof photo.");
                return;
            }
        }
        setPendingPhoto(null);
        setProofOpen(true);
    };

    const handleFlagPress = () => {
        if (!preview || busy !== "idle") return;
        if (photoUri) {
            submitFlag(photoUri);
            return;
        }
        Alert.alert(
            "Take a photo first",
            "Please take a clear photo of the bag as proof before flagging this household.",
            [
                { text: "Cancel", style: "cancel" },
                { text: "Take photo", onPress: openProofCamera },
            ]
        );
    };

    const handleProofCapture = async () => {
        if (!cameraRef.current || capturing) return;
        setCapturing(true);
        try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.7 });
            if (photo?.uri) setPendingPhoto(photo.uri);
        } catch {
            Alert.alert("Error", "Could not take the photo. Try again.");
        } finally {
            setCapturing(false);
        }
    };

    const handleUsePhoto = () => {
        if (!pendingPhoto) return;
        const uri = pendingPhoto;
        setPhotoUri(uri);
        setPendingPhoto(null);
        setProofOpen(false);
        submitFlag(uri);
    };

    // ── Done Collection ──────────────────────────────────────────────────────
    // Tells the server the collector finished. The admin gets a notification and
    // confirms on their side; the bin stays assigned to the collector until then.
    const submitDone = async () => {
        if (!bin?.id || busy !== "idle" || isDone) return;
        setBusy("completing");
        try {
            const { res, body } = await apiFetch(
                `/api/collectors/me/bins/${encodeURIComponent(bin.id)}/done`,
                { method: "PATCH" }
            );

            if (res.status === 409) {
                setDoneMarked(true);
                Alert.alert("Already done", body?.message ?? "This bin was already marked as done.");
                return;
            }
            if (res.status === 404) {
                // The admin may have reassigned this bin to someone else.
                Alert.alert(
                    "No longer assigned",
                    "This bin is no longer assigned to you. The admin may have reassigned it.",
                    [{ text: "OK", onPress: () => router.back() }]
                );
                return;
            }
            if (!res.ok || !body?.success) {
                Alert.alert("Could not submit", describeError(res.status, body, "Please try again."));
                return;
            }

            setDoneMarked(true);
            Alert.alert(
                "Collection done",
                `${bin.id} was reported to the admin for confirmation.`,
                [{ text: "OK", onPress: () => router.back() }]
            );
        } catch (err) {
            Alert.alert("Error", networkMessage(err));
        } finally {
            setBusy("idle");
        }
    };

    // Opens the confirmation modal so a misclick can't report a bin as collected.
    const handleDonePress = () => {
        if (!bin?.id || busy !== "idle" || isDone) return;
        setConfirmDoneOpen(true);
    };

    const handleConfirmDone = () => {
        setConfirmDoneOpen(false);
        submitDone();
    };

    // ── UI ───────────────────────────────────────────────────────────────────
    const renderDetails = () => {
        if (!preview) return null;
        const when = new Date(preview.scannedAt);
        const householdId = getHouseholdId(preview);
        return (
            <View style={card}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <Feather name="clipboard" size={20} color="green" />
                    <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827" }}>Bag details</Text>
                </View>

                {photoUri && (
                    <Image source={{ uri: photoUri }} style={{ width: "100%", height: 160, borderRadius: 12, marginBottom: 8 }} resizeMode="cover" />
                )}

                <Row label="Stamp number" value={`#${preview.stampNumber}`} />
                <Row label="Household ID" value={householdId} />
                <Row label="Bin" value={preview.binId} />
                <Row
                    label="Disposed"
                    value={`${when.toLocaleDateString()} • ${when.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
                    last
                />

                {preview.flagged ? (
                    <View style={{ marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: "#FEE2E2", borderRadius: 12, paddingVertical: 12 }}>
                        <Feather name="flag" size={16} color="#B91C1C" />
                        <Text style={{ color: "#B91C1C", fontSize: 14, fontWeight: "600" }}>This bag is already flagged.</Text>
                    </View>
                ) : (
                    <TouchableOpacity
                        onPress={handleFlagPress}
                        disabled={busy !== "idle"}
                        activeOpacity={0.8}
                        style={{ marginTop: 16, backgroundColor: "#DC2626", paddingVertical: 14, borderRadius: 12, alignItems: "center", opacity: busy !== "idle" ? 0.6 : 1 }}
                    >
                        {busy === "flagging"
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Flag violation</Text>}
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    onPress={reset}
                    disabled={busy === "flagging"}
                    activeOpacity={0.8}
                    style={{ marginTop: 10, paddingVertical: 14, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#D1D5DB", backgroundColor: "#FFFFFF" }}
                >
                    <Text style={{ color: "#374151", fontSize: 16, fontWeight: "600" }}>Search another</Text>
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#F3F4F6" }}>
            {/* Header (same style as the dashboard header + round white button) */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    activeOpacity={0.7}
                    style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", ...cardShadow }}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Feather name="chevron-left" size={22} color="#111827" />
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 22, fontWeight: "700", color: "#111827" }}>Find Trash Bag</Text>
                    <Text style={{ fontSize: 14, color: "#4B5563", marginTop: 1 }}>Look up a bag by its stamp number</Text>
                </View>
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
                <ScrollView
                    contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Bin card (same look as the welcome card on the dashboard) */}
                    <View style={{ backgroundColor: "#16A34A", borderRadius: 16, padding: 20, marginTop: 12, ...cardShadow }}>
                        <Text style={{ color: "#DCFCE7", fontSize: 14 }}>Collecting from</Text>
                        <Text style={{ color: "#FFFFFF", fontSize: 26, fontWeight: "700", marginTop: 2 }}>{bin?.id ?? "—"}</Text>
                        {!!(bin?.type ?? bin?.location) && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, alignSelf: "flex-start", backgroundColor: "#15803D", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
                                <Feather name="trash-2" size={14} color="white" />
                                <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "600" }}>{bin?.type ?? bin?.location}</Text>
                            </View>
                        )}
                    </View>

                    {/* Search card */}
                    <View style={card}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <Feather name="search" size={20} color="green" />
                            <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827" }}>Type the stamp number</Text>
                        </View>
                        <Text style={{ color: "#4B5563", fontSize: 14, marginBottom: 14 }}>
                            Enter the number printed on the trash bag.
                        </Text>

                        <TextInput
                            value={value}
                            onChangeText={(t) => {
                                setValue(t.replace(/\D/g, "").slice(0, 6));
                                if (error) setError("");
                                if (preview) { setPreview(null); setPhotoUri(null); }
                            }}
                            keyboardType="number-pad"
                            maxLength={6}
                            autoFocus
                            selectionColor="#16A34A"
                            returnKeyType="search"
                            onSubmitEditing={handleLookup}
                            placeholder="000000"
                            placeholderTextColor="#D1D5DB"
                            textAlign="center"
                            textAlignVertical="center"
                            style={{ height: 56, borderWidth: 1, borderColor: error ? "#FCA5A5" : "#E5E7EB", borderRadius: 12, backgroundColor: "#F9FAFB", paddingVertical: 0, paddingHorizontal: 12, fontSize: 22, fontWeight: "600", letterSpacing: 4, textAlign: "center", color: "#111827" }}
                        />

                        {!!error && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 }}>
                                <Feather name="alert-circle" size={16} color="#DC2626" />
                                <Text style={{ flex: 1, color: "#DC2626", fontSize: 14 }}>{error}</Text>
                            </View>
                        )}

                        {/* Find button only shows while there is no result yet */}
                        {!preview && (
                            <TouchableOpacity
                                onPress={handleLookup}
                                disabled={busy !== "idle" || value.length === 0}
                                activeOpacity={0.8}
                                style={{ marginTop: 16, paddingVertical: 14, borderRadius: 12, backgroundColor: "#16A34A", alignItems: "center", opacity: busy !== "idle" || value.length === 0 ? 0.5 : 1 }}
                            >
                                {busy === "reading"
                                    ? <ActivityIndicator color="#fff" />
                                    : <Text style={{ fontWeight: "600", color: "#fff", fontSize: 16 }}>Find</Text>}
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* After a match: only "Flag violation" + "Search another" are shown */}
                    {renderDetails()}
                </ScrollView>

                {/* pinned at the very bottom of the screen */}
                <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: 1, borderTopColor: "#E5E7EB", backgroundColor: "#FFFFFF" }}>
                    <TouchableOpacity
                        onPress={handleDonePress}
                        disabled={busy !== "idle" || isDone}
                        activeOpacity={0.8}
                        style={{
                            paddingVertical: 14,
                            borderRadius: 12,
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: "row",
                            gap: 8,
                            backgroundColor: isDone ? "#DBEAFE" : "#16A34A",
                            opacity: busy !== "idle" ? 0.6 : 1,
                        }}
                    >
                        {busy === "completing" ? (
                            <ActivityIndicator color="#fff" />
                        ) : (
                            <>
                                <Feather name={isDone ? "check" : "check-circle"} size={18} color={isDone ? "#1D4ED8" : "#fff"} />
                                <Text style={{ color: isDone ? "#1E40AF" : "#fff", fontSize: 16, fontWeight: "600" }}>
                                    {isDone ? "Done · Awaiting admin" : "Done Collection"}
                                </Text>
                            </>
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>

            {/* Confirmation modal: Done Collection */}
            <Modal
                visible={confirmDoneOpen}
                transparent
                animationType="fade"
                onRequestClose={() => setConfirmDoneOpen(false)}
            >
                <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 24 }}>
                    <View style={{ width: "100%", maxWidth: 360, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 20, ...cardShadow }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#DCFCE7", alignItems: "center", justifyContent: "center" }}>
                                <Feather name="check-circle" size={22} color="#16A34A" />
                            </View>
                            <Text style={{ flex: 1, fontSize: 20, fontWeight: "700", color: "#111827" }}>
                                Finish collection?
                            </Text>
                        </View>

                        <Text style={{ fontSize: 15, lineHeight: 22, color: "#4B5563", marginTop: 14 }}>
                            Only confirm if you have collected everything from{" "}
                            <Text style={{ fontWeight: "700", color: "#111827" }}>{bin?.id ?? "this bin"}</Text>.
                        </Text>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 12 }}>
                            <Feather name="bell" size={16} color="#6B7280" />
                            <Text style={{ flex: 1, fontSize: 13, color: "#4B5563" }}>
                                The admin will be notified and will confirm on their side.
                            </Text>
                        </View>

                        <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
                            <TouchableOpacity
                                onPress={() => setConfirmDoneOpen(false)}
                                activeOpacity={0.8}
                                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#D1D5DB", alignItems: "center" }}
                            >
                                <Text style={{ fontSize: 16, fontWeight: "600", color: "#374151" }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleConfirmDone}
                                activeOpacity={0.8}
                                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: "#16A34A", alignItems: "center" }}
                            >
                                <Text style={{ fontSize: 16, fontWeight: "600", color: "#FFFFFF" }}>Yes, I'm done</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Proof photo (camera + review), shown only when flagging */}
            <Modal visible={proofOpen} animationType="slide" onRequestClose={() => { setProofOpen(false); setPendingPhoto(null); }}>
                <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
                    {pendingPhoto ? (
                        <View style={{ flex: 1, backgroundColor: "#000" }}>
                            <Image source={{ uri: pendingPhoto }} style={{ flex: 1 }} resizeMode="contain" />
                            <View style={{ padding: 16, backgroundColor: "#111827" }}>
                                <Text style={{ color: "#fff", fontSize: 15, textAlign: "center", marginBottom: 12 }}>
                                    Is the bag clearly visible?
                                </Text>
                                <View style={{ flexDirection: "row", gap: 10 }}>
                                    <TouchableOpacity
                                        onPress={() => setPendingPhoto(null)}
                                        style={{ flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "#9CA3AF", alignItems: "center" }}
                                    >
                                        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Retake</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={handleUsePhoto}
                                        style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: "#DC2626", alignItems: "center" }}
                                    >
                                        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>Use photo & flag</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ) : (
                        <View style={{ flex: 1 }}>
                            <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
                            <View pointerEvents="none" style={{ position: "absolute", top: 12, left: 0, right: 0, alignItems: "center" }}>
                                <Text style={{ color: "#fff", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, fontSize: 13, overflow: "hidden" }}>
                                    Take a clear photo of the bag
                                </Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", padding: 20, backgroundColor: "#111827" }}>
                                <TouchableOpacity onPress={() => setProofOpen(false)} style={{ width: 70, alignItems: "center" }}>
                                    <Text style={{ color: "#fff", fontSize: 16 }}>Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={handleProofCapture}
                                    disabled={capturing}
                                    style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: "#fff", borderWidth: 4, borderColor: "#DC2626", alignItems: "center", justifyContent: "center", opacity: capturing ? 0.6 : 1 }}
                                >
                                    <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "#DC2626" }} />
                                </TouchableOpacity>
                                <View style={{ width: 70 }} />
                            </View>
                        </View>
                    )}
                </SafeAreaView>
            </Modal>
        </SafeAreaView>
    );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
    return (
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: "#F3F4F6" }}>
            <Text style={{ color: "#4B5563", fontSize: 14 }}>{label}</Text>
            <Text style={{ color: "#111827", fontSize: 16, fontWeight: "600", flexShrink: 1, textAlign: "right", marginLeft: 12 }}>{value}</Text>
        </View>
    );
}
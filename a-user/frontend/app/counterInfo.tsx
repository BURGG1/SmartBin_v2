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
import { API_BASE } from "@/config";

const REQUEST_TIMEOUT_MS = 20_000;

interface Bin { id: string; type?: string; location?: string; }

interface BagPreview {
    logId: string;
    stampNumber: string;
    binId: string;
    household: string | { _id?: string; id?: string } | null; // populated object or raw ObjectId string
    householdId?: string;
    scannedAt: string;
    flagged: boolean;
    flaggedAt: string | null;
}

async function apiFetch(path: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
    const token = await AsyncStorage.getItem("token");
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

function getHouseholdId(p: BagPreview) {
    if (p.householdId) return String(p.householdId);
    const h = p.household;
    if (!h) return "Unknown";
    return typeof h === "string" ? h : String(h._id ?? h.id ?? "Unknown");
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

    const [busy, setBusy] = useState<"idle" | "reading" | "flagging">("idle");
    const [value, setValue] = useState("");
    const [error, setError] = useState("");
    const [preview, setPreview] = useState<BagPreview | null>(null);
    const [photoUri, setPhotoUri] = useState<string | null>(null);

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
            setPreview(body.data as BagPreview);
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

    // ── UI ───────────────────────────────────────────────────────────────────
    const renderDetails = () => {
        if (!preview) return null;
        const when = new Date(preview.scannedAt);
        const householdId = getHouseholdId(preview);
        return (
            <View style={{ marginTop: 20 }}>
                {photoUri && (
                    <Image source={{ uri: photoUri }} style={{ width: "100%", height: 160, borderRadius: 12, marginBottom: 12 }} resizeMode="cover" />
                )}
                <View style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: "#E5E7EB" }}>
                    <Row label="Stamp number" value={`#${preview.stampNumber}`} />
                    <Row label="Household ID" value={householdId} />
                    <Row label="Bin" value={preview.binId} />
                    <Row label="Disposed" value={`${when.toLocaleDateString()} ${when.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`} />
                </View>

                {preview.flagged ? (
                    <View style={{ marginTop: 16, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12 }}>
                        <Text style={{ color: "#B91C1C", textAlign: "center", fontWeight: "600" }}>This bag is already flagged.</Text>
                    </View>
                ) : (
                    <TouchableOpacity
                        onPress={handleFlagPress}
                        disabled={busy !== "idle"}
                        style={{ marginTop: 16, backgroundColor: "#DC2626", paddingVertical: 14, borderRadius: 10, alignItems: "center", opacity: busy !== "idle" ? 0.6 : 1 }}
                    >
                        {busy === "flagging"
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={{ color: "#fff", fontWeight: "700" }}>Flag violation</Text>}
                    </TouchableOpacity>
                )}

                <TouchableOpacity
                    onPress={reset}
                    disabled={busy === "flagging"}
                    style={{ marginTop: 10, paddingVertical: 12, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "#D1D5DB" }}
                >
                    <Text style={{ color: "#374151", fontWeight: "600" }}>Search another</Text>
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Feather name="chevron-left" size={22} color="#4B5563" />
                </TouchableOpacity>
                <Text style={{ fontSize: 15, fontWeight: "600", color: "#4B5563" }}>Find Trash Bag</Text>
                <View style={{ width: 22 }} />
            </View>

            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#111827" }}>
                    {bin?.id ?? "—"}{" "}
                    <Text style={{ fontWeight: "400", color: "#374151" }}>- {bin?.type ?? bin?.location ?? ""}</Text>
                </Text>
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
                <ScrollView
                    contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
                    keyboardShouldPersistTaps="handled"
                >
                    <Text style={{ fontSize: 16, fontWeight: "700", color: "#111827", marginBottom: 4 }}>Type the stamp number</Text>
                    <Text style={{ color: "#6B7280", fontSize: 12, marginBottom: 12 }}>
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
                        textAlign="center"
                        textAlignVertical="center"
                        style={{ height: 56, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingVertical: 0, paddingHorizontal: 12, fontSize: 20, letterSpacing: 4, textAlign: "center", color: "#111827" }}
                    />
                    {!!error && <Text style={{ color: "#DC2626", marginTop: 8, fontSize: 12 }}>{error}</Text>}

                    <TouchableOpacity
                        onPress={handleLookup}
                        disabled={busy !== "idle" || value.length === 0}
                        style={{ marginTop: 14, paddingVertical: 14, borderRadius: 10, backgroundColor: "#16A34A", alignItems: "center", opacity: busy !== "idle" || value.length === 0 ? 0.6 : 1 }}
                    >
                        {busy === "reading"
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={{ fontWeight: "700", color: "#fff" }}>Find</Text>}
                    </TouchableOpacity>

                    {renderDetails()}
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Proof photo (camera + review), shown only when flagging */}
            <Modal visible={proofOpen} animationType="slide" onRequestClose={() => { setProofOpen(false); setPendingPhoto(null); }}>
                <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
                    {pendingPhoto ? (
                        <View style={{ flex: 1, backgroundColor: "#000" }}>
                            <Image source={{ uri: pendingPhoto }} style={{ flex: 1 }} resizeMode="contain" />
                            <View style={{ padding: 16, backgroundColor: "#111827" }}>
                                <Text style={{ color: "#fff", textAlign: "center", marginBottom: 12 }}>
                                    Is the bag clearly visible?
                                </Text>
                                <View style={{ flexDirection: "row", gap: 10 }}>
                                    <TouchableOpacity
                                        onPress={() => setPendingPhoto(null)}
                                        style={{ flex: 1, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: "#9CA3AF", alignItems: "center" }}
                                    >
                                        <Text style={{ color: "#fff", fontWeight: "600" }}>Retake</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={handleUsePhoto}
                                        style={{ flex: 1, paddingVertical: 14, borderRadius: 10, backgroundColor: "#DC2626", alignItems: "center" }}
                                    >
                                        <Text style={{ color: "#fff", fontWeight: "700" }}>Use photo & flag</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ) : (
                        <View style={{ flex: 1 }}>
                            <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
                            <View pointerEvents="none" style={{ position: "absolute", top: 12, left: 0, right: 0, alignItems: "center" }}>
                                <Text style={{ color: "#fff", backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, fontSize: 13 }}>
                                    Take a clear photo of the bag
                                </Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", padding: 20, backgroundColor: "#111827" }}>
                                <TouchableOpacity onPress={() => setProofOpen(false)} style={{ width: 70, alignItems: "center" }}>
                                    <Text style={{ color: "#fff" }}>Cancel</Text>
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

function Row({ label, value }: { label: string; value: string }) {
    return (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: "#6B7280", fontSize: 13 }}>{label}</Text>
            <Text style={{ color: "#111827", fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{value}</Text>
        </View>
    );
}
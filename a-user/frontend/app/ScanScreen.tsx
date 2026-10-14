import React, { useCallback, useMemo, useRef, useState } from "react";
import {
    View, Text, TouchableOpacity, ActivityIndicator, Alert, Image,
    Modal, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "@/config";

const REQUEST_TIMEOUT_MS = 20_000;
const OCR_TIMEOUT_MS = 40_000; // Render cold start + first OCR can be slow

interface Bin { id: string; type?: string; location?: string; }

interface BagPreview {
    logId: string;
    stampNumber: string;
    binId: string;
    household: { fullname?: string } | null;
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

function toFilePart(uri: string) {
    const filename = uri.split("/").pop() ?? "photo.jpg";
    const ext = filename.split(".").pop()?.toLowerCase();
    return {
        uri: Platform.OS === "android" ? uri : uri.replace("file://", ""),
        name: filename,
        type: ext === "png" ? "image/png" : "image/jpeg",
    } as any;
}

export default function ScanScreen() {
    const { bin: binParam } = useLocalSearchParams<{ bin?: string }>();
    const bin = useMemo<Bin | null>(() => {
        try { return binParam ? (JSON.parse(binParam) as Bin) : null; }
        catch { return null; }
    }, [binParam]);

    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);

    const [busy, setBusy] = useState<"idle" | "reading" | "flagging">("idle");
    const [preview, setPreview] = useState<BagPreview | null>(null);
    const [photoUri, setPhotoUri] = useState<string | null>(null);
    const [error, setError] = useState("");

    const [manualOpen, setManualOpen] = useState(false);
    const [manualValue, setManualValue] = useState("");
    const [manualError, setManualError] = useState("");

    // Proof-photo flow
    const [proofOpen, setProofOpen] = useState(false);            // camera / review screen visible
    const [pendingPhoto, setPendingPhoto] = useState<string | null>(null); // captured, awaiting "Use photo"
    const [capturing, setCapturing] = useState(false);

    const reset = useCallback(() => {
        setPreview(null);
        setPhotoUri(null);
        setError("");
        setBusy("idle");
        setProofOpen(false);
        setPendingPhoto(null);
        setCapturing(false);
    }, []);

    // ── Scan: take photo -> backend OCR + lookup ─────────────────────────────
    const handleScan = async () => {
        if (!bin?.id || !cameraRef.current || busy !== "idle") return;
        setError("");
        setBusy("reading");
        try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
            if (!photo?.uri) throw new Error("No photo captured");

            const form = new FormData();
            form.append("binId", bin.id);
            form.append("photo", toFilePart(photo.uri));

            const { res, body } = await apiFetch(
                "/api/rfid/stamp/scan", { method: "POST", body: form }, OCR_TIMEOUT_MS
            );
            if (!res.ok || !body?.success) {
                setError(describeError(res.status, body, "Could not read the stamp. Try again."));
                return;
            }
            setPhotoUri(photo.uri);
            setPreview(body.data as BagPreview);
        } catch (err) {
            setError(networkMessage(err));
        } finally {
            setBusy("idle");
        }
    };

    // ── Typed-number fallback ────────────────────────────────────────────────
    const handleManualLookup = async () => {
        if (!bin?.id) return;
        if (!/^\d{1,6}$/.test(manualValue)) {
            setManualError("Enter the number printed on the bag (up to 6 digits).");
            return;
        }
        setManualError("");
        setBusy("reading");
        try {
            const { res, body } = await apiFetch(
                `/api/rfid/stamp/${encodeURIComponent(bin.id)}/${manualValue}`, { method: "GET" }
            );
            if (!res.ok || !body?.success) {
                setManualError(describeError(res.status, body, "Trash bag record not found."));
                return;
            }
            setPhotoUri(null);
            setPreview(body.data as BagPreview);
            setManualOpen(false);
            setManualValue("");
        } catch (err) {
            setManualError(networkMessage(err));
        } finally {
            setBusy("idle");
        }
    };

    // ── Flag ─────────────────────────────────────────────────────────────────
    // Sends the flag request using the given photo.
    const submitFlag = async (evidenceUri: string) => {
        if (!preview || !bin?.id || busy !== "idle") return;
        setBusy("flagging");
        try {
            const form = new FormData();
            form.append("source", "mobile-scan");
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
                `${preview.household?.fullname ?? "This household"} was flagged for bag #${preview.stampNumber}. The admin will review it.`,
                [{ text: "Scan next", onPress: reset }]
            );
        } catch (err) {
            Alert.alert("Error", networkMessage(err));
        } finally {
            setBusy("idle");
        }
    };

    // Flag button: if there's no photo yet, ask the collector to take one first.
    const handleFlagPress = () => {
        if (!preview || busy !== "idle") return;
        if (photoUri) {
            submitFlag(photoUri); // scanned bags already have a photo
            return;
        }
        Alert.alert(
            "Take a photo first",
            "Please take a clear photo of the bag as proof before flagging this household.",
            [
                { text: "Cancel", style: "cancel" },
                { text: "Take photo", onPress: () => setProofOpen(true) },
            ]
        );
    };

    // ── Proof photo ──────────────────────────────────────────────────────────
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
        submitFlag(uri); // photo is clear -> proceed with the flag
    };

    // ── UI ───────────────────────────────────────────────────────────────────
    const renderBody = () => {
        if (!permission) {
            return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#16A34A" /></View>;
        }
        if (!permission.granted) {
            return (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
                    <Text style={{ textAlign: "center", color: "#374151", marginBottom: 16 }}>
                        Camera access is needed to scan the stamped number on trash bags.
                    </Text>
                    <TouchableOpacity onPress={requestPermission} style={{ backgroundColor: "#16A34A", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}>
                        <Text style={{ color: "#fff", fontWeight: "600" }}>Allow camera</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        // Proof photo: review step (after capture)
        if (preview && proofOpen && pendingPhoto) {
            return (
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
            );
        }

        // Proof photo: camera step
        if (preview && proofOpen) {
            return (
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
            );
        }

        if (preview) {
            const when = new Date(preview.scannedAt);
            return (
                <View style={{ flex: 1, padding: 16 }}>
                    {photoUri && (
                        <Image source={{ uri: photoUri }} style={{ width: "100%", height: 160, borderRadius: 12, marginBottom: 12 }} resizeMode="cover" />
                    )}
                    <View style={{ backgroundColor: "#F9FAFB", borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: "#E5E7EB" }}>
                        <Row label="Stamp number" value={`#${preview.stampNumber}`} />
                        <Row label="Household" value={preview.household?.fullname ?? "Unknown"} />
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

                    <TouchableOpacity onPress={reset} disabled={busy === "flagging"} style={{ marginTop: 10, paddingVertical: 12, alignItems: "center", borderRadius: 10, borderWidth: 1, borderColor: "#D1D5DB" }}>
                        <Text style={{ color: "#374151", fontWeight: "600" }}>{preview.flagged ? "Scan another" : "Rescan"}</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return (
            <View style={{ flex: 1 }}>
                <View style={{ flex: 1 }}>
                    <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
                    <View pointerEvents="none" style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center" }}>
                        <View style={{ width: 260, height: 90, borderWidth: 3, borderColor: "#fff", borderRadius: 12 }} />
                        <Text style={{ color: "#fff", marginTop: 12, fontSize: 13 }}>Align the stamped number inside the box</Text>
                    </View>
                    {!!error && (
                        <View style={{ position: "absolute", top: 12, left: 12, right: 12, backgroundColor: "#DC2626", padding: 10, borderRadius: 8 }}>
                            <Text style={{ color: "#fff", textAlign: "center" }}>{error}</Text>
                        </View>
                    )}
                    {busy === "reading" && (
                        <View style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" }}>
                            <ActivityIndicator size="large" color="#fff" />
                            <Text style={{ color: "#fff", marginTop: 10 }}>Reading stamp…</Text>
                        </View>
                    )}
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-around", padding: 20, backgroundColor: "#111827" }}>

                    <View style={{ width: 70 }} />

                    <TouchableOpacity
                        onPress={handleScan}
                        disabled={busy !== "idle"}
                        style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: "#fff", borderWidth: 4, borderColor: "#16A34A", alignItems: "center", justifyContent: "center", opacity: busy !== "idle" ? 0.6 : 1 }}
                    >
                        <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: "#16A34A" }} />
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => { setManualError(""); setManualOpen(true); }} disabled={busy !== "idle"} style={{ width: 70, alignItems: "center" }}>
                        <Feather name="hash" size={24} color="#fff" />
                        <Text style={{ color: "#fff", fontSize: 11, marginTop: 4 }}>Type number</Text>
                    </TouchableOpacity>

                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Feather name="chevron-left" size={22} color="#4B5563" />
                </TouchableOpacity>
                <Text style={{ fontSize: 15, fontWeight: "600", color: "#4B5563" }}>Scan Trash Bag</Text>
                <View style={{ width: 22 }} />
            </View>

            <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#111827" }}>
                    {bin?.id ?? "—"}{" "}
                    <Text style={{ fontWeight: "400", color: "#374151" }}>- {bin?.type ?? bin?.location ?? ""}</Text>
                </Text>
            </View>

            {renderBody()}

            <Modal visible={manualOpen} transparent animationType="fade" onRequestClose={() => setManualOpen(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 }}>
                    <View style={{ backgroundColor: "#fff", borderRadius: 14, padding: 20 }}>
                        <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 4 }}>Type the stamp number</Text>
                        <Text style={{ color: "#6B7280", fontSize: 12, marginBottom: 12 }}>Use this if the camera can't read it.</Text>
                        <TextInput
                            value={manualValue}
                            onChangeText={(t) => setManualValue(t.replace(/\D/g, "").slice(0, 6))}
                            placeholder="004281"
                            keyboardType="number-pad"
                            maxLength={6}
                            autoFocus
                            style={{ borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, padding: 12, fontSize: 20, letterSpacing: 4, textAlign: "center" }}
                        />
                        {!!manualError && <Text style={{ color: "#DC2626", marginTop: 8, fontSize: 12 }}>{manualError}</Text>}
                        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                            <TouchableOpacity onPress={() => setManualOpen(false)} style={{ flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: "#D1D5DB", alignItems: "center" }}>
                                <Text style={{ fontWeight: "600", color: "#374151" }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={handleManualLookup} disabled={busy !== "idle"} style={{ flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: "#16A34A", alignItems: "center", opacity: busy !== "idle" ? 0.6 : 1 }}>
                                {busy === "reading" ? <ActivityIndicator color="#fff" /> : <Text style={{ fontWeight: "600", color: "#fff" }}>Find</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
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
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
    View, Text, TouchableOpacity, FlatList, Alert,
    ActivityIndicator, Modal, Image, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { API_BASE } from "@/config";

const LOGS_LIMIT = 10;

// ── Types ─────────────────────────────────────────────────────────────────────
interface Bin {
    id: string;
    type?: string;
    location?: string;
    fill?: number;
}

interface HouseholdRef {
    _id: string;
    fullname?: string;
    contactNumber?: string;
    email?: string;
}

interface RfidLogEntry {
    _id: string;
    rfid: string;
    household: HouseholdRef | null;
    binId: string | null;
    action: string;
    disposalOrder: number | null;
    flagged?: boolean;
    flaggedAt?: string | null;
    evidencePhoto?: string | null;
    scannedAt: string;
    note?: string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CounterInformationScreen() {
    const { bin: binParam } = useLocalSearchParams<{ bin?: string }>();

    let bin: Bin | null = null;
    if (binParam) {
        try { bin = JSON.parse(binParam) as Bin; }
        catch { bin = null; }
    }

    const [logs, setLogs] = useState<RfidLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [flaggingId, setFlaggingId] = useState<string | null>(null);

    // ── Camera modal state ────────────────────────────────────────────────────
    const [cameraVisible, setCameraVisible] = useState(false);
    const [pendingLog, setPendingLog] = useState<RfidLogEntry | null>(null);
    const [capturedUri, setCapturedUri] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [facing, setFacing] = useState<CameraType>("back");
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);

    // ── Fetch logs ────────────────────────────────────────────────────────────
    const fetchLogs = useCallback(async () => {
        if (!bin?.id) { setError("No bin selected."); setLoading(false); return; }
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams({
                binId: bin.id, action: "dispose", page: "1", limit: String(LOGS_LIMIT),
            });
            const res = await fetch(`${API_BASE}/api/rfid/logs?${params}`);
            if (!res.ok) throw new Error(`Server error (${res.status})`);
            const data = await res.json();
            if (data.success) setLogs(data.data);
            else setError(data.message || "Failed to load logs.");
        } catch {
            setError("Network error. Could not load logs.");
        } finally {
            setLoading(false);
        }
    }, [bin?.id]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    // ── Open camera modal ─────────────────────────────────────────────────────
    const openFlagModal = async (log: RfidLogEntry) => {
        // If already flagged, unflag without photo
        if (log.flagged) {
            await submitFlag(log, null, false);
            return;
        }

        if (!permission?.granted) {
            const result = await requestPermission();
            if (!result.granted) {
                Alert.alert("Permission required", "Camera access is needed to take evidence photos.");
                return;
            }
        }

        setPendingLog(log);
        setCapturedUri(null);
        setCameraVisible(true);
    };

    // ── Take photo ────────────────────────────────────────────────────────────
    const takePhoto = async () => {
        if (!cameraRef.current) return;
        try {
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.7, base64: false });
            if (photo?.uri) setCapturedUri(photo.uri);
        } catch {
            Alert.alert("Error", "Failed to take photo. Please try again.");
        }
    };

    // ── Pick from gallery ─────────────────────────────────────────────────────
    const pickFromGallery = async () => {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.7,
            allowsEditing: true,
        });
        if (!result.canceled && result.assets[0]?.uri) {
            setCapturedUri(result.assets[0].uri);
        }
    };

    // ── Submit flag with photo ────────────────────────────────────────────────
    const submitFlag = async (
        log: RfidLogEntry,
        photoUri: string | null,
        nextFlagged: boolean
    ) => {
        setFlaggingId(log._id);

        // Optimistic update
        setLogs((prev) =>
            prev.map((l) => l._id === log._id ? { ...l, flagged: nextFlagged } : l)
        );
        setCameraVisible(false);
        setUploading(true);

        try {
            const formData = new FormData();
            formData.append("flagged", String(nextFlagged));

            if (photoUri && nextFlagged) {
                const filename = photoUri.split("/").pop() ?? "evidence.jpg";
                const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
                const mimeType = ext === "png" ? "image/png" : "image/jpeg";

                formData.append("evidencePhoto", {
                    uri: Platform.OS === "android" ? photoUri : photoUri.replace("file://", ""),
                    name: filename,
                    type: mimeType,
                } as any);
            }

            const res = await fetch(`${API_BASE}/api/rfid/logs/${log._id}/flag`, {
                method: "PATCH",
                body: formData,
            });

            if (!res.ok) throw new Error(`Server error (${res.status})`);
            const data = await res.json();
            if (!data.success) throw new Error(data.message || "Failed to update flag");

            // Update with server-confirmed data
            setLogs((prev) =>
                prev.map((l) => l._id === log._id ? { ...l, ...data.data } : l)
            );

            if (nextFlagged) {
                Alert.alert(
                    "Household Flagged",
                    `${log.household?.fullname ?? "This household"} has been flagged with evidence photo.`
                );
            }
        } catch {
            // Roll back
            setLogs((prev) =>
                prev.map((l) => l._id === log._id ? { ...l, flagged: log.flagged } : l)
            );
            Alert.alert("Error", "Could not update flag status. Please try again.");
        } finally {
            setFlaggingId(null);
            setUploading(false);
            setPendingLog(null);
            setCapturedUri(null);
        }
    };

    // ── Render row ────────────────────────────────────────────────────────────
    const renderItem = ({ item: log }: { item: RfidLogEntry }) => {
        const scannedAt = new Date(log.scannedAt);
        const date = scannedAt.toISOString().split("T")[0];
        const time = scannedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        const hh = log.household;
        const householdId = hh?._id ? `HH-${hh._id.slice(-8).toUpperCase()}` : "—";
        const isFlagged = !!log.flagged;
        const isBusy = flaggingId === log._id || uploading;

        return (
            <View style={{
                flexDirection: "row", alignItems: "center",
                paddingHorizontal: 16, paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: "#F3F4F6",
                backgroundColor: isFlagged ? "#FEF2F2" : "#FFFFFF",
            }}>
                <View style={{ width: 90 }}>
                    <Text style={{ fontSize: 13, color: "#111827" }}>{date}</Text>
                    <Text style={{ fontSize: 11, color: "#6B7280" }}>{time}</Text>
                </View>

                <View style={{ flex: 1, paddingHorizontal: 8 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: "#111827" }}>
                        #{log.disposalOrder ?? "—"}
                    </Text>
                </View>

                <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, color: "#1F2937" }}>{householdId}</Text>
                    {log.evidencePhoto && (
                        <Text style={{ fontSize: 10, color: "#16A34A", marginTop: 2 }}>
                            📷 Evidence attached
                        </Text>
                    )}
                </View>

                <TouchableOpacity
                    disabled={isBusy}
                    onPress={() => openFlagModal(log)}
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        borderWidth: 1,
                        borderRadius: 8,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderColor: "#DC2626",
                        backgroundColor: isFlagged ? "#DC2626" : "#FFFFFF",
                        opacity: isBusy ? 0.5 : 1,
                    }}
                >
                    <Feather name="flag" size={16} color={isFlagged ? "#fff" : "#DC2626"} />
                    <Text style={{
                        fontSize: 12,
                        fontWeight: "600",
                        color: isFlagged ? "#FFFFFF" : "#DC2626",
                    }}>
                        {isFlagged ? "Flagged" : "Flag"}
                    </Text>
                </TouchableOpacity>
            </View>
        );
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#FFFFFF" }}>

            {/* Header */}
            <View style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingHorizontal: 16, paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
            }}>
                <TouchableOpacity onPress={() => router.back()}>
                    <Feather name="chevron-left" size={22} color="#4B5563" />
                </TouchableOpacity>
                <Text style={{ fontSize: 15, fontWeight: "600", color: "#4B5563" }}>
                    Counter Information
                </Text>
                <View style={{ width: 22 }} />
            </View>

            {/* Bin Info */}
            <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#111827" }}>
                    {bin?.id ?? "—"}{" "}
                    <Text style={{ fontWeight: "400", color: "#374151" }}>
                        — {bin?.type ?? bin?.location ?? ""}
                    </Text>
                </Text>
            </View>

            {/* Table header */}
            <View style={{
                flexDirection: "row", alignItems: "center",
                paddingHorizontal: 16, paddingVertical: 8,
                backgroundColor: "#F9FAFB",
                borderBottomWidth: 1, borderBottomColor: "#E5E7EB",
            }}>
                <View style={{ width: 90 }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: "#6B7280", textTransform: "uppercase" }}>Date</Text>
                </View>
                <View style={{ flex: 1, paddingHorizontal: 8 }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: "#6B7280", textTransform: "uppercase" }}>Order</Text>
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: "#6B7280", textTransform: "uppercase" }}>Household</Text>
                </View>
                <View style={{ width: 92, alignItems: "center" }}>
                    <Text style={{ fontSize: 11, fontWeight: "600", color: "#6B7280", textTransform: "uppercase" }}>Action</Text>
                </View>
            </View>

            {/* List */}
            {loading ? (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <ActivityIndicator color="#16A34A" />
                </View>
            ) : error ? (
                <Text style={{ textAlign: "center", color: "#EF4444", paddingVertical: 24 }}>{error}</Text>
            ) : (
                <FlatList
                    data={logs}
                    keyExtractor={(item) => String(item._id)}
                    renderItem={renderItem}
                    ListEmptyComponent={
                        <Text style={{ textAlign: "center", color: "#6B7280", paddingVertical: 24 }}>
                            No records found for this bin.
                        </Text>
                    }
                    contentContainerStyle={{ paddingBottom: 24 }}
                />
            )}

            {/* ── Camera / Evidence Modal ───────────────────────────────────── */}
            <Modal
                visible={cameraVisible}
                animationType="slide"
                onRequestClose={() => { if (!uploading) { setCameraVisible(false); setPendingLog(null); setCapturedUri(null); } }}
            >
                <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>

                    {/* Modal header */}
                    <View style={{
                        flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                        paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#111827",
                    }}>
                        <TouchableOpacity
                            onPress={() => { setCameraVisible(false); setPendingLog(null); setCapturedUri(null); }}
                            disabled={uploading}
                        >
                            <Feather name="x" size={22} color="#fff" />
                        </TouchableOpacity>
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 15 }}>
                            Take Evidence Photo
                        </Text>
                        <TouchableOpacity onPress={() => setFacing(f => f === "back" ? "front" : "back")}>
                            <Feather name="refresh-cw" size={20} color="#fff" />
                        </TouchableOpacity>
                    </View>

                    {capturedUri ? (
                        /* Preview captured photo */
                        <View style={{ flex: 1 }}>
                            <Image
                                source={{ uri: capturedUri }}
                                style={{ flex: 1 }}
                                resizeMode="contain"
                            />
                            <View style={{
                                flexDirection: "row", gap: 12,
                                padding: 16, backgroundColor: "#111827",
                            }}>
                                <TouchableOpacity
                                    onPress={() => setCapturedUri(null)}
                                    disabled={uploading}
                                    style={{
                                        flex: 1, paddingVertical: 12, borderRadius: 10,
                                        borderWidth: 1, borderColor: "#fff",
                                        alignItems: "center",
                                        opacity: uploading ? 0.5 : 1,
                                    }}
                                >
                                    <Text style={{ color: "#fff", fontWeight: "600" }}>Retake</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    onPress={() => pendingLog && submitFlag(pendingLog, capturedUri, true)}
                                    disabled={uploading}
                                    style={{
                                        flex: 1, paddingVertical: 12, borderRadius: 10,
                                        backgroundColor: "#DC2626",
                                        alignItems: "center",
                                        opacity: uploading ? 0.6 : 1,
                                    }}
                                >
                                    {uploading ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <Text style={{ color: "#fff", fontWeight: "600" }}>
                                            Submit Flag
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        /* Camera view */
                        <View style={{ flex: 1 }}>
                            <CameraView
                                ref={cameraRef}
                                style={{ flex: 1 }}
                                facing={facing}
                            />
                            <View style={{
                                flexDirection: "row", alignItems: "center", justifyContent: "space-around",
                                padding: 24, backgroundColor: "#111827",
                            }}>
                                {/* Gallery picker */}
                                <TouchableOpacity onPress={pickFromGallery}>
                                    <Feather name="image" size={28} color="#fff" />
                                </TouchableOpacity>

                                {/* Shutter */}
                                <TouchableOpacity
                                    onPress={takePhoto}
                                    style={{
                                        width: 70, height: 70, borderRadius: 35,
                                        backgroundColor: "#fff",
                                        borderWidth: 4, borderColor: "#DC2626",
                                        alignItems: "center", justifyContent: "center",
                                    }}
                                >
                                    <View style={{
                                        width: 56, height: 56, borderRadius: 28,
                                        backgroundColor: "#DC2626",
                                    }} />
                                </TouchableOpacity>

                                {/* Flip placeholder to balance layout */}
                                <View style={{ width: 28 }} />
                            </View>
                        </View>
                    )}
                </SafeAreaView>
            </Modal>

        </SafeAreaView>
    );
}
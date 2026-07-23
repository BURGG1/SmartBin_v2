import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    View, Text, TouchableOpacity, FlatList, Alert,
    ActivityIndicator, Modal, Image, Platform, TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { CameraView, CameraType, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { API_BASE } from "@/config";
import Pagination from "@/components/UserPagination";

const LOGS_LIMIT = 11;

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

function toDateStr(d: string | Date) {
    return new Date(d).toISOString().split("T")[0];
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

    // ── Search (disposal order) ───────────────────────────────────────────────
    // Client-side only: filters the logs already loaded for the current page.
    // Doesn't reach across pages — see note where it's applied below.
    const [searchQuery, setSearchQuery] = useState("");

    // ── Date filter state ─────────────────────────────────────────────────────
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [anchorDate, setAnchorDate] = useState<string | null>(null);
    const [pickerVisible, setPickerVisible] = useState(false);
    const logsAbortRef = useRef<AbortController | null>(null);

    // ── Pagination state ──────────────────────────────────────────────────────
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);

    // ── Camera modal state ────────────────────────────────────────────────────
    const [cameraVisible, setCameraVisible] = useState(false);
    const [pendingLog, setPendingLog] = useState<RfidLogEntry | null>(null);
    const [capturedUri, setCapturedUri] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [facing, setFacing] = useState<CameraType>("back");
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);

    useEffect(() => {
        setPage(1);
        setAnchorDate(null);
    }, [selectedDate, bin?.id]);

    // ── Fetch logs (paginated, scoped to a single day) ───────────────────────
    const fetchLogs = useCallback(async () => {
        if (!bin?.id) { setError("No bin selected."); setLoading(false); return; }

        logsAbortRef.current?.abort();
        const controller = new AbortController();
        logsAbortRef.current = controller;

        setLoading(true);
        setError("");

        try {
            let dateForQuery = selectedDate;

            if (!dateForQuery) {
                if (!anchorDate) {
                    const peekParams = new URLSearchParams({
                        binId: bin.id, action: "dispose", page: "1", limit: "1",
                    });
                    const peekRes = await fetch(`${API_BASE}/api/rfid/logs?${peekParams}`, {
                        signal: controller.signal,
                    });
                    const peekData = await peekRes.json();
                    const latest = peekData?.success && peekData.data?.length > 0 ? peekData.data[0] : null;

                    if (logsAbortRef.current !== controller) return;

                    if (!latest) {
                        setLogs([]);
                        setTotal(0);
                        setLoading(false);
                        return;
                    }

                    setAnchorDate(toDateStr(latest.scannedAt));
                    return;
                }
                dateForQuery = anchorDate;
            }

            const params = new URLSearchParams({
                binId: bin.id,
                action: "dispose",
                page: String(page),
                limit: String(LOGS_LIMIT),
                from: dateForQuery,
                to: dateForQuery,
            });

            const res = await fetch(`${API_BASE}/api/rfid/logs?${params}`, {
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`Server error (${res.status})`);
            const data = await res.json();

            if (logsAbortRef.current !== controller) return;

            if (data.success) {
                setLogs(data.data);
                setTotal(data.total ?? data.pagination?.total ?? data.count ?? data.data.length);
            } else {
                setError(data.message || "Failed to load logs.");
            }
        } catch (err: any) {
            if (err?.name !== "AbortError") setError("Network error. Could not load logs.");
        } finally {
            if (logsAbortRef.current === controller) setLoading(false);
        }
    }, [bin?.id, selectedDate, anchorDate, page]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    useEffect(() => () => { logsAbortRef.current?.abort(); }, []);

    // ── Filtered view (search applies only to what's currently loaded) ──────
    const visibleLogs = useMemo(() => {
        const q = searchQuery.trim();
        if (!q) return logs;
        return logs.filter((log) => String(log.disposalOrder ?? "").includes(q));
    }, [logs, searchQuery]);

    // ── Date picker handlers ──────────────────────────────────────────────────
    const onChangeDate = (event: DateTimePickerEvent, date?: Date) => {
        if (Platform.OS === "android") setPickerVisible(false);
        if (event.type === "dismissed" || !date) return;
        setSelectedDate(toDateStr(date));
    };

    const clearDateFilter = () => setSelectedDate(null);

    // ── Open camera modal ─────────────────────────────────────────────────────
    const openFlagModal = async (log: RfidLogEntry) => {
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
                            Evidence attached
                        </Text>
                    )}
                </View>

                <TouchableOpacity
                    disabled={isBusy || isFlagged}
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
                        opacity: isBusy || isFlagged ? 0.5 : 1,
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

    const displayedDateLabel = selectedDate ?? anchorDate ?? "Latest day";

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

            {/* Search bar */}
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                <View style={{
                    flexDirection: "row", alignItems: "center", gap: 8,
                    borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 8,
                }}>
                    <Feather name="search" size={16} color="#9CA3AF" />
                    <TextInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholder="Search disposal order (e.g. 3)"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="number-pad"
                        style={{ flex: 1, fontSize: 13, color: "#111827", padding: 0 }}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery("")}>
                            <Feather name="x" size={16} color="#9CA3AF" />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Date filter row */}
            <View style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingHorizontal: 16, paddingBottom: 10,
            }}>
                <TouchableOpacity
                    onPress={() => setPickerVisible(true)}
                    style={{
                        flexDirection: "row", alignItems: "center", gap: 6,
                        borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8,
                        paddingHorizontal: 10, paddingVertical: 6,
                    }}
                >
                    <Feather name="calendar" size={14} color="#4B5563" />
                    <Text style={{ fontSize: 12, color: "#374151" }}>
                        {displayedDateLabel}
                    </Text>
                </TouchableOpacity>

                {selectedDate && (
                    <TouchableOpacity onPress={clearDateFilter}>
                        <Text style={{ fontSize: 13, color: "#DC2626", fontWeight: "600" }}>
                            Clear
                        </Text>
                    </TouchableOpacity>
                )}
            </View>

            {pickerVisible && (
                <DateTimePicker
                    value={selectedDate ? new Date(selectedDate) : new Date()}
                    mode="date"
                    display={Platform.OS === "ios" ? "inline" : "default"}
                    maximumDate={new Date()}
                    onChange={onChangeDate}
                />
            )}

            {/* Table header */}
            <View style={{
                flexDirection: "row", alignItems: "center",
                paddingHorizontal: 16, paddingVertical: 8,
                backgroundColor: "#abf7ce",
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
            <View style={{ flex: 1 }}>
                {loading ? (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <ActivityIndicator color="#16A34A" />
                    </View>
                ) : error ? (
                    <Text style={{ textAlign: "center", color: "#EF4444", paddingVertical: 24 }}>{error}</Text>
                ) : (
                    <FlatList
                        data={visibleLogs}
                        keyExtractor={(item) => String(item._id)}
                        renderItem={renderItem}
                        ListEmptyComponent={
                            <Text style={{ textAlign: "center", color: "#6B7280", paddingVertical: 24 }}>
                                {searchQuery
                                    ? `No results for order "${searchQuery}" on this page.`
                                    : `No records found${selectedDate ? " for this date." : " for this bin."}`}
                            </Text>
                        }
                        contentContainerStyle={{ paddingBottom: 24 }}
                    />
                )}
            </View>

            {/* Pagination — fixed below the list so it doesn't scroll away */}
            {!loading && !error && logs.length > 0 && (
                <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                    <Pagination
                        currentPage={page}
                        totalItems={total}
                        itemsPerPage={LOGS_LIMIT}
                        onPageChange={setPage}
                    />
                </View>
            )}

            {/* ── Camera / Evidence Modal ───────────────────────────────────── */}
            <Modal
                visible={cameraVisible}
                animationType="slide"
                onRequestClose={() => { if (!uploading) { setCameraVisible(false); setPendingLog(null); setCapturedUri(null); } }}
            >
                <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>

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
                                <TouchableOpacity onPress={pickFromGallery}>
                                    <Feather name="image" size={28} color="#fff" />
                                </TouchableOpacity>

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

                                <View style={{ width: 28 }} />
                            </View>
                        </View>
                    )}
                </SafeAreaView>
            </Modal>

        </SafeAreaView>
    );
}
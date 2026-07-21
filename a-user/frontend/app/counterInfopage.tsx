import React, { useCallback, useEffect, useState } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    FlatList,
    Alert,
    SafeAreaView,
    ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { API_BASE } from "@/config"; // adjust path if this file lives elsewhere

const LOGS_LIMIT = 10;

// ── Types ──────────────────────────────────────────────────────────────────

interface Bin {
    id: string;
    type?: string;
    location?: string;
    fill?: number;
    scheduleDate?: string;
    scheduleTime?: string;
}

interface HouseholdRef {
    _id: string;
    fullname?: string;
    address?: string;
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
    scannedAt: string;
    note?: string | null;
}

interface RfidLogsResponse {
    success: boolean;
    data: RfidLogEntry[];
    message?: string;
}

interface FlagResponse {
    success: boolean;
    data?: RfidLogEntry;
    message?: string;
}

/**
 * Expo Router screen — navigate to it with:
 *   router.push({
 *     pathname: "/(collectorTabs)/counterInfopage",
 *     params: { bin: JSON.stringify(bin) },
 *   })
 *
 * Displays: Date, Disposal Order, Household ID, and a Flag action button.
 * Flag state is persisted to the backend (see flag-route + flag-schema files).
 */
export default function CounterInformationScreen() {
    const { bin: binParam } = useLocalSearchParams<{ bin?: string }>();

    // Guard against malformed/missing JSON instead of letting JSON.parse throw
    let bin: Bin | null = null;
    if (binParam) {
        try {
            bin = JSON.parse(binParam) as Bin;
        } catch {
            bin = null;
        }
    }

    const [logs, setLogs] = useState<RfidLogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [flaggingId, setFlaggingId] = useState<string | null>(null); // disables the button mid-request

    const fetchLogs = useCallback(async () => {
        if (!bin?.id) {
            setError("No bin selected.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError("");
        try {
            const params = new URLSearchParams({
                binId: bin.id,
                action: "dispose",
                page: "1",
                limit: String(LOGS_LIMIT),
            });
            const res = await fetch(`${API_BASE}/api/rfid/logs?${params}`);
            if (!res.ok) throw new Error(`Server error (${res.status})`);
            const data: RfidLogsResponse = await res.json();
            if (data.success) {
                setLogs(data.data);
            } else {
                setError(data.message || "Failed to load logs.");
            }
        } catch (err) {
            setError("Network error. Could not load logs.");
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bin?.id]);

    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    const toggleFlag = async (log: RfidLogEntry) => {
        const nextFlagged = !log.flagged;
        setFlaggingId(log._id);

        // Optimistic update
        setLogs((prev) =>
            prev.map((l) => (l._id === log._id ? { ...l, flagged: nextFlagged } : l))
        );

        try {
            const res = await fetch(`${API_BASE}/api/rfid/logs/${log._id}/flag`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ flagged: nextFlagged }),
            });
            if (!res.ok) throw new Error(`Server error (${res.status})`);
            const data: FlagResponse = await res.json();

            if (!data.success) {
                throw new Error(data.message || "Failed to update flag");
            }

            if (nextFlagged) {
                Alert.alert(
                    "Household Flagged",
                    `${log.household?.fullname ?? "This household"} has been flagged for review.`
                );
            }
        } catch (err) {
            // Roll back on failure
            setLogs((prev) =>
                prev.map((l) => (l._id === log._id ? { ...l, flagged: log.flagged } : l))
            );
            Alert.alert("Error", "Could not update flag status. Please try again.");
        } finally {
            setFlaggingId(null);
        }
    };

    const renderItem = ({ item: log }: { item: RfidLogEntry }) => {
        const scannedAt = new Date(log.scannedAt);
        const date = scannedAt.toISOString().split("T")[0];
        const time = scannedAt.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
        });
        const hh = log.household;
        const householdId = hh?._id ? `HH-${hh._id.slice(-8).toUpperCase()}` : "—";
        const isFlagged = !!log.flagged;
        const isBusy = flaggingId === log._id;

        return (
            <View
                className={`flex-row items-center justify-content px-4 py-3 border-b border-gray-100 ${isFlagged ? "bg-red-50" : ""
                    }`}
            >
                <View className="w-[90px]">
                    <Text className="text-sm text-gray-900">{date}</Text>
                    <Text className="text-xs text-gray-500">{time}</Text>
                </View>

                <View className="flex-1 text-center px-2">
                    <Text className="text-sm font-semibold text-gray-900">
                        #{log.disposalOrder ?? "—"}
                    </Text>
                </View>
                <View className="flex-1 text-left">
                    <Text className="text-sm text-gray-800 mt-0.5">{householdId}</Text>
                </View>

                <TouchableOpacity
                    disabled={isBusy}
                    onPress={() => toggleFlag(log)}
                    className={`flex-row items-center gap-1 border rounded-lg px-2.5 py-1.5 ${isFlagged ? "bg-red-600 border-red-600" : "bg-white border-red-600"
                        } ${isBusy ? "opacity-50" : ""}`}
                >
                    <Feather name="flag" size={16} color={isFlagged ? "#fff" : "#dc2626"} />
                    <Text
                        className={`text-xs font-semibold ${isFlagged ? "text-white" : "text-red-600"
                            }`}
                    >
                        {isFlagged ? "Flagged" : "Flag"}
                    </Text>
                </TouchableOpacity>
            </View>
        );
    };

    return (
        <SafeAreaView className="flex-1 bg-white">
            {/* HEADER */}
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-200">
                <TouchableOpacity onPress={() => router.back()}>
                    <Feather name="chevron-left" size={22} color="#4b5563" />
                </TouchableOpacity>
                <Text className="text-base font-semibold text-gray-600">
                    Counter Information
                </Text>
                <View className="w-[22px]" />
            </View>

            {/* BIN INFO */}
            <View className="px-4 pt-2.5 pb-2">
                <Text className="text-base font-bold text-gray-900">
                    {bin?.id ?? "—"} -{" "}
                    <Text className="font-normal text-gray-700">{bin?.type ?? bin?.location}</Text>
                </Text>
            </View>

            {/* TABLE HEADER */}
            <View className="flex-row items-center px-4 py-2 bg-gray-50 border-b border-gray-200">
                <View className="w-[90px]">
                    <Text className="text-xs font-semibold text-gray-500 uppercase">Date</Text>
                </View>
                <View className="flex-1 px-2">
                    <Text className="text-xs font-semibold text-gray-500 uppercase">
                        Disposal Order
                    </Text>
                </View>
                <View className="flex-1 px-2">
                    <Text className="text-xs font-semibold text-gray-500 uppercase">
                        Household ID
                    </Text>
                </View>
                <View className="w-[92px] items-center">
                    <Text className="text-xs font-semibold text-gray-500 uppercase">Action</Text>
                </View>
            </View>

            {/* LIST */}
            {loading ? (
                <View className="flex-1 items-center justify-center">
                    <ActivityIndicator />
                </View>
            ) : error ? (
                <Text className="text-center text-red-500 py-6">{error}</Text>
            ) : (
                <FlatList
                    data={logs}
                    keyExtractor={(item) => String(item._id)}
                    renderItem={renderItem}
                    ListEmptyComponent={
                        <Text className="text-center text-gray-500 py-6">
                            No records found for this bin
                        </Text>
                    }
                    contentContainerStyle={{ paddingBottom: 24 }}
                />
            )}
        </SafeAreaView>
    );
}
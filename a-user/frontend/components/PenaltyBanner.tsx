import { useState, useEffect } from "react";
import { View, Text } from "react-native";
import { Feather } from "@expo/vector-icons";

export type ViolationLog = {
    _id: string;
    offenseNumber: number;
    penaltyType: string;
    pointsDeducted?: number;
    fineAmount?: number;
    communityService?: string;
    issuedBy?: string;
    createdAt: string;
};

// How long a penalty stays visible to the user after it was issued
export const PENALTY_VISIBLE_MS = 24 * 60 * 60 * 1000;

const NOTE =
    "Repeated violations may result in additional penalties and suspension of waste disposal privileges.";

// Milliseconds left before this penalty is hidden (<= 0 means expired)
const msRemaining = (v: ViolationLog, now: number) => {
    const issuedAt = new Date(v.createdAt).getTime();
    if (Number.isNaN(issuedAt)) return 0;
    // Clamp so a device clock slightly behind the server never shows more than 24h
    return Math.min(PENALTY_VISIBLE_MS, PENALTY_VISIBLE_MS - (now - issuedAt));
};

const formatCountdown = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
};

type Props = {
    /** Violations from the violation log (newest first). Expired ones are filtered out here. */
    records: ViolationLog[];
};

export default function PenaltyBanner({ records }: Props) {
    const [now, setNow] = useState(() => Date.now());

    const active = records
        .filter((v) => msRemaining(v, now) > 0)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const hasActive = active.length > 0;

    // Tick every second only while something is visible; stops once everything has expired
    useEffect(() => {
        setNow(Date.now());
        if (!hasActive) return;
        const id = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(id);
    }, [hasActive, records]);

    // Nothing active (or still loading) → the banner is hidden
    if (!hasActive) return null;

    const totalDeducted = active.reduce((sum, v) => sum + (v.pointsDeducted ?? 0), 0);

    return (
        <View className="bg-red-50 border border-red-200 shadow-lg rounded-2xl p-5 mb-5 gap-4">
            {/* Header */}
            <View className="flex-row items-start gap-3">
                <View className="w-11 h-11 rounded-full bg-red-100 items-center justify-center">
                    <Feather name="alert-triangle" size={22} color="#B91C1C" />
                </View>
                <View className="flex-1">
                    <Text className="text-lg font-semibold text-red-700">Penalties & Deductions</Text>
                    <Text className="text-sm text-red-600 mt-0.5">
                        Based on Republic Act No. 9003 - Ecological Solid Waste Management Act
                    </Text>
                </View>
            </View>

            {/* Summary */}
            <View className="bg-white border border-red-200 rounded-xl px-4 py-3 flex-row items-center justify-between">
                <View>
                    <Text className="text-sm text-gray-600">New penalties</Text>
                    <Text className="text-xl font-extrabold text-red-600">{active.length}</Text>
                </View>
                {totalDeducted > 0 && (
                    <View className="items-end">
                        <Text className="text-sm text-gray-600">Points deducted</Text>
                        <Text className="text-xl font-extrabold text-red-600">-{totalDeducted}</Text>
                    </View>
                )}
            </View>

            {/* Records */}
            <View className="gap-3">
                {active.map((v) => (
                    <View key={v._id} className="bg-white border border-red-200 rounded-xl p-4 gap-3">
                        <View className="flex-row items-start justify-between gap-3">
                            <View className="flex-1 gap-0.5">
                                <Text className="text-base font-semibold text-gray-900">
                                    Offense #{v.offenseNumber} · {v.penaltyType}
                                </Text>
                                <Text className="text-sm text-gray-500">
                                    {new Date(v.createdAt).toLocaleDateString("en-CA")} ·{" "}
                                    {new Date(v.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </Text>
                                {!!v.fineAmount && (
                                    <Text className="text-sm text-gray-700 mt-1">Fine: ₱{v.fineAmount}</Text>
                                )}
                                {!!v.communityService && (
                                    <Text className="text-sm text-gray-700">Community service: {v.communityService}</Text>
                                )}
                                {!!v.issuedBy && (
                                    <Text className="text-xs text-gray-500 mt-1">Issued by {v.issuedBy}</Text>
                                )}
                            </View>
                            <Text className="text-red-600 font-bold text-base">
                                {v.pointsDeducted ? `-${v.pointsDeducted} pts` : "No deduction"}
                            </Text>
                        </View>

                        {/* 24-hour countdown */}
                        <View className="flex-row items-center gap-2 bg-red-50 rounded-lg px-3 py-2 self-start">
                            <Feather name="clock" size={14} color="#B91C1C" />
                            <Text className="text-xs text-red-700 font-medium">
                                Shown for {formatCountdown(msRemaining(v, now))} more
                            </Text>
                        </View>
                    </View>
                ))}
            </View>

            {/* Note */}
            <View className="bg-white border border-red-300 rounded-xl p-3 gap-1">
                <Text className="text-sm text-red-600">
                    <Text className="font-bold">Note: </Text>
                    {NOTE}
                </Text>
                <Text className="text-xs text-gray-500">
                    Penalties are shown here for 24 hours. Your full history stays under Violations on the Home tab.
                </Text>
            </View>
        </View>
    );
}
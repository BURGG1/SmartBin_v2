import { Modal, View, Text, ScrollView, Image, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

// ── Shared type ───────────────────────────────────────────────────────────────
export type Rule = {
    _id: string;
    name: string;
    description?: string;
    decs?: string; // legacy field name
    frequency?: string;
    freq?: string; // legacy field name
    points?: number;
    image?: string;
    [key: string]: any;
};

// ── Helpers (shared by Home + Rules) ──────────────────────────────────────────
export const getRuleDescription = (r: Rule) => r.description ?? r.decs ?? "";
export const getRuleFrequency = (r: Rule) => r.frequency ?? r.freq ?? "";

// Keys that already have a dedicated spot in the UI
const HIDDEN_KEYS = new Set([
    "_id", "__v", "image", "name", "description", "decs",
    "frequency", "freq", "points", "createdAt", "updatedAt",
]);

const prettifyKey = (key: string) =>
    key
        .replace(/([A-Z])/g, " $1")
        .replace(/[_-]+/g, " ")
        .trim()
        .replace(/^\w/, (c) => c.toUpperCase());

const getExtraFields = (rule: Rule) =>
    Object.entries(rule).filter(
        ([k, v]) =>
            !HIDDEN_KEYS.has(k) &&
            (typeof v === "string" || typeof v === "number" || typeof v === "boolean") &&
            v !== ""
    );

/**
 * Searches every detail of a rule: rule number, name, description,
 * frequency, points and any extra fields.
 *  - "rule 3", "rule3", "#3"  → exact rule number match
 *  - "30", "+30", "30 pts"    → matches points (and any other text)
 *  - multiple words           → every word must match somewhere
 */
export function matchesRuleSearch(rule: Rule, ruleNumber: number, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;

    const exact = q.match(/^(?:rule\s*#?|#)\s*(\d+)$/);
    if (exact) return Number(exact[1]) === ruleNumber;

    const pts = rule.points ?? "";
    const haystack = [
        `rule ${ruleNumber}`,
        `#${ruleNumber}`,
        rule.name,
        getRuleDescription(rule),
        getRuleFrequency(rule),
        `${pts}`,
        pts !== "" ? `+${pts} ${pts} points pts` : "",
        ...getExtraFields(rule).map(([, v]) => String(v)),
    ]
        .join(" ")
        .toLowerCase();

    return q.split(/\s+/).every((token) => haystack.includes(token));
}

// ── Horizontal rule card ──────────────────────────────────────────────────────
export function RuleCard({
    rule,
    ruleNumber,
    onPress,
}: {
    rule: Rule;
    ruleNumber: number;
    onPress: () => void;
}) {
    const description = getRuleDescription(rule);
    const frequency = getRuleFrequency(rule);

    return (
        <TouchableOpacity
            activeOpacity={0.8}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`Rule ${ruleNumber}, ${rule.name}, plus ${rule.points ?? 0} points. Tap for details`}
            className="flex-row bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
        >
            {/* Image (left) */}
            {rule.image ? (
                <Image
                    source={{ uri: rule.image }}
                    style={{ width: 96, minHeight: 156 }}
                    resizeMode="cover"
                />
            ) : (
                <View
                    className="bg-gray-100 items-center justify-center"
                    style={{ width: 96, minHeight: 156 }}
                >
                    <Feather name="image" size={26} color="#9CA3AF" />
                    <Text className="text-gray-500 text-sm mt-1">No image</Text>
                </View>
            )}

            {/* Content (right) */}
            <View className="flex-1 p-4 justify-between gap-3">
                <View className="gap-2">
                    {/* Rule number + points */}
                    <View className="flex-row items-center justify-between">
                        <Text className="text-sm font-bold text-green-700 uppercase tracking-wide">
                            Activity {ruleNumber}
                        </Text>
                        <View className="bg-green-600 rounded-full px-3 py-1">
                            <Text className="text-white font-extrabold text-base">
                                +{rule.points ?? 0} pts
                            </Text>
                        </View>
                    </View>

                    {/* Name */}
                    <Text className="text-xl font-bold text-gray-900 leading-6" numberOfLines={2}>
                        {rule.name}
                    </Text>

                    {/* Description */}
                    {!!description && (
                        <Text className="text-base text-gray-600 leading-6" numberOfLines={2}>
                            {description}
                        </Text>
                    )}
                </View>

                {/* Footer */}
                <View className="flex-row items-center justify-between gap-2">
                    {!!frequency ? (
                        <View className="bg-gray-100 px-3 py-1 rounded-full flex-shrink">
                            <Text className="text-sm text-gray-800 font-semibold" numberOfLines={1}>
                                {frequency}
                            </Text>
                        </View>
                    ) : (
                        <View />
                    )}
                    <View className="flex-row items-center gap-1">
                        <Text className="text-base font-bold text-green-700">Details</Text>
                        <Feather name="chevron-right" size={20} color="#15803D" />
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );
}

// ── Rule details page (full-screen) ───────────────────────────────────────────
type RuleDetailsProps = {
    rule: Rule | null;
    ruleNumber: number;
    visible: boolean;
    onClose: () => void;
};

export default function RuleDetails({ rule, ruleNumber, visible, onClose }: RuleDetailsProps) {
    const description = rule ? getRuleDescription(rule) : "";
    const frequency = rule ? getRuleFrequency(rule) : "";
    const extras = rule ? getExtraFields(rule) : [];

    const formatDate = (value?: string) => {
        if (!value) return "";
        const d = new Date(value);
        return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA");
    };
    const updated = rule ? formatDate(rule.updatedAt ?? rule.createdAt) : "";

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={onClose}
        >
            <SafeAreaView className="flex-1 bg-gray-50" edges={["top", "bottom"]}>
                {/* Top bar */}
                <View className="flex-row items-center px-4 py-3 bg-white border-b border-gray-200">
                    <TouchableOpacity
                        onPress={onClose}
                        accessibilityRole="button"
                        accessibilityLabel="Go back"
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        className="flex-row items-center gap-1 pr-3"
                    >
                        <Feather name="arrow-left" size={22} color="#15803D" />
                        <Text className="text-base font-semibold text-green-700">Back</Text>
                    </TouchableOpacity>
                    <Text className="flex-1 text-center text-lg font-bold text-gray-900 pr-16" numberOfLines={1}>
                        Activity {ruleNumber}
                    </Text>
                </View>

                {rule && (
                    <ScrollView
                        className="flex-1"
                        contentContainerStyle={{ paddingBottom: 32 }}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Hero image */}
                        {rule.image ? (
                            <Image source={{ uri: rule.image }} style={{ width: "100%", height: 240 }} resizeMode="cover" />
                        ) : (
                            <View className="w-full bg-gray-100 items-center justify-center" style={{ height: 180 }}>
                                <Feather name="image" size={36} color="#9CA3AF" />
                                <Text className="text-gray-500 text-sm mt-2">No image available</Text>
                            </View>
                        )}

                        <View className="px-4 pt-5 gap-5">
                            {/* Title block */}
                            <View className="gap-2">
                                <View className="bg-green-100 self-start px-3 py-1 rounded-full">
                                    <Text className="text-green-800 text-sm font-semibold">Activity {ruleNumber}</Text>
                                </View>
                                <Text className="text-2xl font-extrabold text-gray-900 leading-8">{rule.name}</Text>
                            </View>

                            {/* Reward card */}
                            <View className="bg-green-600 rounded-2xl p-5 flex-row items-center justify-between shadow">
                                <View className="flex-row items-center gap-3">
                                    <Feather name="award" size={28} color="white" />
                                    <Text className="text-green-50 text-base font-medium">Points reward</Text>
                                </View>
                                <Text className="text-4xl font-extrabold text-white">
                                    +{rule.points ?? 0}
                                    <Text className="text-green-100 text-base font-medium"> pts</Text>
                                </Text>
                            </View>

                            {/* Description */}
                            <View className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm gap-2">
                                <View className="flex-row items-center gap-2">
                                    <Feather name="file-text" size={18} color="#16A34A" />
                                    <Text className="text-lg font-bold text-gray-900">Description</Text>
                                </View>
                                <Text className="text-base text-gray-700 leading-6">
                                    {description || "No description provided for this rule."}
                                </Text>
                            </View>

                            {/* Quick facts */}
                            <View className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                                <View className="flex-row items-center gap-2 mb-2">
                                    <Feather name="info" size={18} color="#16A34A" />
                                    <Text className="text-lg font-bold text-gray-900">Details</Text>
                                </View>

                                <DetailRow label="Activity number" value={`Activity ${ruleNumber}`} />
                                <DetailRow label="Points" value={`+${rule.points ?? 0} points`} />
                                <DetailRow label="Frequency" value={frequency || "Not specified"} />
                               
                                {!!updated && <DetailRow label="Last updated" value={updated} />}
                            </View>

                            <TouchableOpacity
                                onPress={onClose}
                                activeOpacity={0.85}
                                accessibilityRole="button"
                                className="bg-green-600 rounded-xl py-4 items-center"
                            >
                                <Text className="text-white text-base font-bold">Back to rules</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                )}
            </SafeAreaView>
        </Modal>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <View className="flex-row justify-between items-start py-3 border-t border-gray-100 gap-4">
            <Text className="text-base text-gray-600">{label}</Text>
            <Text className="text-base font-semibold text-gray-900 flex-1 text-right">{value}</Text>
        </View>
    );
}
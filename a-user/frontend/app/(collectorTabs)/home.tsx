import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  RefreshControl, // NEW: pull-to-refresh
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage"; // ⚠️ confirm this matches your actual token storage
import { API_BASE } from "@/config";
import * as SecureStore from "expo-secure-store";

type Bin = {
  id: string;
  location: string;
  scheduleDate?: string;
  scheduleTime?: string;
  scheduleEndTime?: string; // end of the collection window (optional)
  fill: number;
};

type CollectionActivity = {
  bin: string;
  location: string;
  date: string;
  time: string;
  status: string;
};

type Collector = {
  name: string;
};

type AppNotification = {
  id: string;
  binId: string;
  title: string;
  message: string;
  timeframe: string | null;
  createdAt: number;
  read: boolean;
};

const NOTIFS_KEY = "collector_notifications";
const SEEN_KEY = "collector_seen_bins";
const POLL_MS = 30000;
const BANNER_MS = 5000;

// reads the login token from wherever the login screen saved it
const getToken = async () => {
  const secure = await SecureStore.getItemAsync("authToken");
  if (secure) return secure;
  return (await AsyncStorage.getItem("token")) ?? (await AsyncStorage.getItem("authToken"));
};

// "Oct 15, 8:00 AM – 10:00 AM" (or just the start time if there is no end time)
const getTimeframe = (bin: Bin) => {
  if (!bin.scheduleDate) return null;
  if (!bin.scheduleTime) return bin.scheduleDate;
  return bin.scheduleEndTime
    ? `${bin.scheduleDate}, ${bin.scheduleTime} – ${bin.scheduleEndTime}`
    : `${bin.scheduleDate}, ${bin.scheduleTime}`;
};

const timeAgo = (timestamp: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.floor(hours / 24)} d ago`;
};

export default function CollectorHome() {
  const [collector, setCollector] = useState<Collector | null>(null);
  const [assignedBins, setAssignedBins] = useState<Bin[]>([]);
  const [recentCollections, setRecentCollections] = useState<CollectionActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // notification state
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [banner, setBanner] = useState<{ title: string; message: string } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // NEW: true while pull-to-refresh / refresh button is running
  const bannerY = useRef(new Animated.Value(-160)).current;
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenBinsRef = useRef<string[] | null>(null);
  const storageIdRef = useRef("default"); // id of the logged-in collector, keeps notifications per account
  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await getToken();
      if (__DEV__) console.log("[dashboard] token found:", !!token); // DEBUG: remove later
      const res = await fetch(`${API_BASE}/api/collectors/me/dashboard`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.status === 401) {
        if (__DEV__) console.log("[dashboard] 401 body:", await res.text()); // DEBUG: remove later
        throw new Error("Not authenticated — please log in again.");
      }
      if (!res.ok) {
        throw new Error(`Server responded ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed to load dashboard.");

      setCollector(data.data.collector);
      setAssignedBins(data.data.assignedBins);
      setRecentCollections(data.data.recentCollections);
    } catch (err) {
      console.error("Failed to fetch collector dashboard:", err);
      const message = err instanceof Error ? err.message : "Could not load your dashboard. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // background refresh (no spinner) so new assignments are picked up while the screen is open
  const refreshQuietly = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/collectors/me/dashboard`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401) {
        // don't keep showing old bins when the session is no longer valid
        setError("Not authenticated — please log in again.");
        return;
      }
      if (!res.ok) {
        if (__DEV__) console.log("[dashboard] refresh failed:", res.status); // DEBUG: remove later
        return;
      }
      const data = await res.json();
      if (!data.success) {
        if (__DEV__) console.log("[dashboard] refresh rejected:", data.message); // DEBUG: remove later
        return;
      }
      if (__DEV__) console.log("[dashboard] bins from server:", (data.data.assignedBins ?? []).length); // DEBUG: remove later
      setCollector(data.data.collector);
      setAssignedBins(data.data.assignedBins ?? []);
      setRecentCollections(data.data.recentCollections ?? []);
    } catch (err) {
      if (__DEV__) console.log("[dashboard] refresh error:", err); // DEBUG: remove later
    }
  }, []);

  // NEW: used by pull-to-refresh AND the refresh button. Reuses refreshQuietly, so no new logic.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshQuietly();
    setRefreshing(false);
  }, [refreshQuietly]);

  useEffect(() => {
    const interval = setInterval(refreshQuietly, POLL_MS);
    return () => clearInterval(interval);
  }, [refreshQuietly]);

  // refresh when returning to this tab (e.g. back from ScanScreen) so collected bins disappear
  const hasFocusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (hasFocusedRef.current) refreshQuietly();
      else hasFocusedRef.current = true;
    }, [refreshQuietly])
  );

  // restore saved notifications and the list of bins already seen
  useEffect(() => {
    (async () => {
      try {
        const rawUser = await AsyncStorage.getItem("user");
        if (rawUser) {
          const u = JSON.parse(rawUser);
          storageIdRef.current = String(u?._id ?? u?.id ?? u?.email ?? "default");
        }
        AsyncStorage.multiRemove([NOTIFS_KEY, SEEN_KEY]).catch(() => {}); // old shared keys
        const [storedNotifs, storedSeen] = await Promise.all([
          AsyncStorage.getItem(`${NOTIFS_KEY}:${storageIdRef.current}`),
          AsyncStorage.getItem(`${SEEN_KEY}:${storageIdRef.current}`),
        ]);
        if (storedNotifs) setNotifications(JSON.parse(storedNotifs));
        if (storedSeen) seenBinsRef.current = JSON.parse(storedSeen);
      } catch {
        // start fresh
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(`${NOTIFS_KEY}:${storageIdRef.current}`, JSON.stringify(notifications)).catch(() => {});
  }, [notifications, hydrated]);

  const hideBanner = useCallback(() => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    Animated.timing(bannerY, { toValue: -160, duration: 220, useNativeDriver: true }).start(() =>
      setBanner(null)
    );
  }, [bannerY]);

  const showBanner = useCallback(
    (title: string, message: string) => {
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      setBanner({ title, message });
      bannerY.setValue(-160);
      Animated.spring(bannerY, { toValue: 0, useNativeDriver: true }).start();
      bannerTimer.current = setTimeout(hideBanner, BANNER_MS);
    },
    [bannerY, hideBanner]
  );

  // detect bins that were not assigned before and notify
  useEffect(() => {
    if (loading || !hydrated || !collector) return;

    const ids = assignedBins.map((b) => b.id);
    const seen = seenBinsRef.current;
    seenBinsRef.current = ids;
    AsyncStorage.setItem(`${SEEN_KEY}:${storageIdRef.current}`, JSON.stringify(ids)).catch(() => {});

    if (seen === null) return; // first run on this device: just remember what is assigned

    const fresh = assignedBins.filter((b) => !seen.includes(b.id));
    if (fresh.length === 0) return;

    const now = Date.now();
    const created: AppNotification[] = fresh.map((bin) => ({
      id: `${bin.id}-${now}`,
      binId: bin.id,
      title: "New collection assignment",
      message: `${bin.id} • ${bin.location}`,
      timeframe: getTimeframe(bin),
      createdAt: now,
      read: false,
    }));

    setNotifications((prev) => [...created, ...prev].slice(0, 30));

    if (created.length === 1) {
      showBanner(
        created[0].title,
        created[0].timeframe ? `${created[0].message}\n${created[0].timeframe}` : created[0].message
      );
    } else {
      showBanner(`${created.length} new collection assignments`, "Tap to review your assigned bins.");
    }
  }, [assignedBins, loading, hydrated, collector, showBanner]);

  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));

  const onNotificationPress = (notification: AppNotification) => {
    setNotifications((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)));
    const bin = assignedBins.find((b) => b.id === notification.binId);
    if (bin) {
      setPanelOpen(false);
      router.push(`/ScanScreen?bin=${encodeURIComponent(JSON.stringify(bin))}` as any);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-gray-100 items-center justify-center">
        <ActivityIndicator size="large" color="#16a34a" />
        <Text className="text-gray-600 text-base mt-3">Loading your dashboard...</Text>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="flex-1 bg-gray-100">
        {/* NEW: ScrollView so you can pull down to retry on the error screen too */}
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={fetchDashboard} tintColor="#16a34a" colors={["#16a34a"]} />
          }
        >
          <View className="w-16 h-16 rounded-full bg-red-100 items-center justify-center mb-4">
            <Feather name="alert-circle" size={30} color="#dc2626" />
          </View>
          <Text className="text-lg font-bold text-gray-900 mb-1">Something went wrong</Text>
          <Text className="text-red-600 text-base text-center mb-5">{error}</Text>
          <TouchableOpacity onPress={fetchDashboard} className="bg-green-600 px-6 py-3 rounded-xl">
            <Text className="text-white text-base font-semibold">Retry</Text>
          </TouchableOpacity>
          <Text className="text-gray-500 text-sm mt-4">Or pull down to try again</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-gray-100">
      <ScrollView
        className="flex-1 px-4 py-2"
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" colors={["#16a34a"]} />
        }
      >
        {/* HEADER */}
        <View className="flex-row items-start justify-between mb-5">
          <View className="flex-1 pr-3">
            <Text className="text-3xl font-bold text-gray-900">Collector Dashboard</Text>
            <Text className="text-base text-gray-600 mt-1">Manage today's waste collection</Text>
          </View>

          <View className="flex-row items-center gap-2">
          

            {/* NOTIFICATION BELL */}
            <TouchableOpacity
              onPress={() => setPanelOpen(true)}
              activeOpacity={0.7}
              className="w-11 h-11 rounded-full bg-white items-center justify-center shadow"
              accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            >
              <Feather name="bell" size={20} color="#111827" />
              {unreadCount > 0 && (
                <View className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-red-500 items-center justify-center border-2 border-gray-100">
                  <Text className="text-white text-xs font-bold">{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* COLLECTOR INFO */}
        <View className="bg-green-600 rounded-2xl shadow p-6 gap-1">
          <Text className="text-green-100 text-base">Welcome back,</Text>
          <Text className="text-3xl text-white font-bold">{collector?.name ?? "—"}</Text>
          <View className="flex-row items-center gap-2 mt-3 self-start bg-green-700 rounded-full px-3 py-1.5">
            <Feather name="trash-2" size={14} color="white" />
            <Text className="text-white text-sm font-semibold">
              {assignedBins.length} {assignedBins.length === 1 ? "bin" : "bins"} assigned
            </Text>
          </View>
        </View>

        {/* ASSIGNED BINS */}
        <View className="bg-white rounded-2xl p-5 shadow mt-5">
          <View className="flex-row items-center gap-2 mb-4">
            <Feather name="clipboard" size={20} color="green" />
            <Text className="text-xl font-bold text-gray-900">Assigned Bins</Text>
          </View>

          {assignedBins.length === 0 ? (
            <Text className="text-gray-500 text-base text-center py-4">No bins currently assigned</Text>
          ) : (
            assignedBins.map((bin, i) => (
              <TouchableOpacity
                key={bin.id}
                activeOpacity={0.7}
                onPress={() => {
                  router.push(`/counterInfo?bin=${encodeURIComponent(JSON.stringify(bin))}` as any);
                }}
                className="flex-row justify-between items-center mb-3 border border-gray-200 bg-gray-50 p-4 rounded-xl"
              >
                <View className="flex-1 pr-3">
                  <Text className="text-lg font-bold text-gray-900">{bin.id}</Text>
                  <Text className="text-base text-gray-600 mt-0.5">{bin.location}</Text>
                  <Text className="text-sm text-green-700 font-medium mt-1">
                    {bin.scheduleDate
                      ? `Scheduled: ${bin.scheduleDate} • ${bin.scheduleTime}`
                      : "Not yet scheduled"}
                  </Text>
                  {/* COLLECTION TIMEFRAME */}
                  {bin.scheduleDate && bin.scheduleTime && (
                    <View className="flex-row items-center gap-1.5 mt-2 self-start bg-green-100 rounded-full px-3 py-1">
                      <Feather name="clock" size={14} color="#15803d" />
                      <Text className="text-sm text-green-800 font-semibold">
                        {bin.scheduleEndTime
                          ? `Collect between ${bin.scheduleTime} – ${bin.scheduleEndTime}`
                          : `Collect at ${bin.scheduleTime}`}
                      </Text>
                    </View>
                  )}
                </View>
                <View className="flex-row items-center gap-2">
                  <View className="bg-red-100 rounded-full px-2.5 py-1">
                    <Text className="text-red-600 text-base font-bold">{bin.fill}%</Text>
                  </View>
                  <Feather name="chevron-right" size={20} color="#6b7280" />
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>

        {/* RECENT COLLECTION ACTIVITY */}
        <View className="bg-white rounded-2xl p-5 shadow mt-5">
          <View className="flex-row items-center gap-2 mb-4">
            <Feather name="check-circle" size={20} color="green" />
            <Text className="text-xl font-bold text-gray-900">Recent Collection Activity</Text>
          </View>

          {recentCollections.length === 0 ? (
            <Text className="text-gray-500 text-base text-center py-4">No recent collections yet</Text>
          ) : (
            recentCollections.map((activity, i) => (
              <View
                key={i}
                className={`flex-row justify-between items-center py-3 ${
                  i !== recentCollections.length - 1 ? "border-b border-gray-100" : ""
                }`}
              >
                <View className="flex-1 pr-3">
                  <Text className="text-base font-semibold text-gray-900">{activity.bin}</Text>
                  <Text className="text-sm text-gray-600 mt-0.5">{activity.location}</Text>
                  <Text className="text-sm text-gray-500 mt-0.5">
                    {activity.date} • {activity.time}
                  </Text>
                </View>

                <View
                  className={`rounded-full px-3 py-1 ${
                    activity.status === "Collected" ? "bg-green-100" : "bg-orange-100"
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      activity.status === "Collected" ? "text-green-700" : "text-orange-600"
                    }`}
                  >
                    {activity.status}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* NOTIFICATION BANNER */}
      {banner && (
        <Animated.View
          style={{
            position: "absolute",
            top: insets.top + 8,
            left: 16,
            right: 16,
            transform: [{ translateY: bannerY }],
          }}
        >
          <Pressable
            onPress={() => {
              hideBanner();
              setPanelOpen(true);
            }}
            accessibilityRole="alert"
            className="bg-gray-900 rounded-2xl p-4 flex-row items-center gap-3 shadow-lg"
          >
            <View className="w-10 h-10 rounded-full bg-green-600 items-center justify-center">
              <Feather name="bell" size={18} color="white" />
            </View>
            <View className="flex-1">
              <Text className="text-white text-base font-bold" numberOfLines={1}>
                {banner.title}
              </Text>
              <Text className="text-gray-200 text-sm mt-0.5" numberOfLines={3}>
                {banner.message}
              </Text>
            </View>
            <TouchableOpacity onPress={hideBanner} hitSlop={10} accessibilityLabel="Dismiss notification">
              <Feather name="x" size={20} color="#d1d5db" />
            </TouchableOpacity>
          </Pressable>
        </Animated.View>
      )}

      {/* NOTIFICATION PANEL */}
      <Modal
        visible={panelOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPanelOpen(false)}
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setPanelOpen(false)} />
        <View
          className="bg-white rounded-t-3xl px-5 pt-3"
          style={{ maxHeight: "75%", paddingBottom: insets.bottom + 12 }}
        >
          <View className="self-center w-10 h-1 rounded-full bg-gray-300 mb-3" />

          <View className="flex-row items-center justify-between mb-3">
            <View className="flex-row items-center gap-2">
              <Text className="text-2xl font-bold text-gray-900">Notifications</Text>
              {unreadCount > 0 && (
                <View className="bg-red-500 rounded-full px-2.5 py-0.5">
                  <Text className="text-white text-sm font-bold">{unreadCount}</Text>
                </View>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setPanelOpen(false)}
              hitSlop={10}
              accessibilityLabel="Close notifications"
            >
              <Feather name="x" size={24} color="#4b5563" />
            </TouchableOpacity>
          </View>

          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllRead} className="mb-2 self-start">
              <Text className="text-base font-semibold text-green-700">Mark all as read</Text>
            </TouchableOpacity>
          )}

          {notifications.length === 0 ? (
            <View className="items-center py-12">
              <View className="w-14 h-14 rounded-full bg-gray-100 items-center justify-center mb-3">
                <Feather name="bell-off" size={24} color="#6b7280" />
              </View>
              <Text className="text-lg text-gray-800 font-semibold">No notifications yet</Text>
              <Text className="text-gray-500 text-base text-center mt-1 px-6">
                You'll be notified here when a new bin is assigned to you.
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {notifications.map((n) => (
                <TouchableOpacity
                  key={n.id}
                  activeOpacity={0.7}
                  onPress={() => onNotificationPress(n)}
                  className="flex-row items-start gap-3 py-3 border-b border-gray-100"
                >
                  <View className="w-10 h-10 rounded-full bg-green-100 items-center justify-center">
                    <Feather name="clipboard" size={18} color="#16a34a" />
                  </View>
                  <View className="flex-1">
                    <Text
                      className={`text-base ${n.read ? "font-medium text-gray-700" : "font-bold text-gray-900"}`}
                    >
                      {n.title}
                    </Text>
                    <Text className="text-base text-gray-600 mt-0.5">{n.message}</Text>
                    {n.timeframe && (
                      <View className="flex-row items-center gap-1 mt-1">
                        <Feather name="clock" size={14} color="#15803d" />
                        <Text className="text-sm text-green-800 font-medium">{n.timeframe}</Text>
                      </View>
                    )}
                    <Text className="text-sm text-gray-500 mt-1">{timeAgo(n.createdAt)}</Text>
                  </View>
                  {!n.read && <View className="w-2.5 h-2.5 rounded-full bg-green-600 mt-2" />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}
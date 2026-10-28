import { SafeAreaView } from "react-native-safe-area-context";
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from "react-native";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "@/config"; // Import the API base URL
import Pagination from "@/components/UserPagination"; // adjust to your path

const API = `${API_BASE}/api/bins`;

// Match the web dashboard's poll cadence (and the ESP32's FILL_SEND_INTERVAL_MS)
const POLL_INTERVAL_MS = 10000;

// Pagination only appears when there are more than this many bins
const ITEMS_PER_PAGE = 4;

const DEFAULT_LAT = 14.86313;
const DEFAULT_LNG = 120.7508;

type Bin = {
  id: string;
  location: string;
  fill: number;
  capacity: string;
  lat: number;
  lng: number;
};

type Status = "good" | "warning" | "critical";

const getStatusFromFill = (fill: number): Status => {
  if (fill >= 90) return "critical";
  if (fill >= 61) return "warning";
  return "good";
};

const statusColors: Record<
  Status,
  { bar: string; badge: string; dot: string; pin: string; label: string }
> = {
  good: {
    bar: "bg-green-600",
    badge: "bg-green-100 text-green-800",
    dot: "bg-green-600",
    pin: "#16a34a",
    label: "Good",
  },
  warning: {
    bar: "bg-yellow-500",
    badge: "bg-yellow-100 text-yellow-800",
    dot: "bg-yellow-500",
    pin: "#f59e0b",
    label: "Warning",
  },
  critical: {
    bar: "bg-red-600",
    badge: "bg-red-100 text-red-800",
    dot: "bg-red-600",
    pin: "#dc2626",
    label: "Critical",
  },
};

// Static HTML shell for the Leaflet map. Bins are injected after load via
// injectJavaScript(), so this string never needs to change at runtime.
//
// Exposed on window:
//   renderBins(bins, selectedId) - add/update/remove markers in place (keeps
//                                  popups open and does NOT move the camera)
//   selectBin(id | null)         - highlight a marker + fly to it, or reset
//                                  the view to show every bin when null
//
// Messages sent back to React Native:
//   { type: "select", id }       - user tapped a marker on the map
const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { height: 100%; margin: 0; padding: 0; }
      .leaflet-popup-content-wrapper { border-radius: 14px; box-shadow: 0 4px 14px rgba(0,0,0,0.25); }
      .leaflet-popup-content { margin: 12px 14px; }
      .pin-wrap { position: relative; }
      .pin {
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        border: 2px solid white;
        box-shadow: 0 1px 4px rgba(0,0,0,0.45);
        box-sizing: border-box;
      }
      .pin-selected { animation: bounce 0.9s ease-in-out infinite; }
      .pin-ring {
        position: absolute;
        border-radius: 50%;
        opacity: 0;
        animation: pulse 1.6s ease-out infinite;
      }
      @keyframes pulse {
        0%   { transform: scale(0.3); opacity: 0.75; }
        100% { transform: scale(1.6); opacity: 0; }
      }
      @keyframes bounce {
        0%, 100% { margin-top: 0; }
        50%      { margin-top: -6px; }
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const map = L.map('map', { zoomControl: false }).setView([${DEFAULT_LAT}, ${DEFAULT_LNG}], 15);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const markers = {};   // id -> L.Marker
      const binsById = {};  // id -> latest bin data
      let selectedId = null;
      let hasFitted = false;
      let openTimer = null;

      function esc(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      }

      function post(msg) {
        if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
      }

      function pinIcon(color, selected) {
        const s = selected ? 26 : 16;
        const tipY = Math.round(s * 1.2);
        const ringSize = 44;
        const ring = selected
          ? '<div class="pin-ring" style="width:' + ringSize + 'px;height:' + ringSize + 'px;' +
            'left:' + (s / 2 - ringSize / 2) + 'px;top:' + (tipY - ringSize / 2) + 'px;' +
            'background:' + color + ';"></div>'
          : '';
        return L.divIcon({
          className: '',
          html:
            '<div class="pin-wrap" style="width:' + s + 'px;height:' + s + 'px;">' + ring +
              '<div class="pin' + (selected ? ' pin-selected' : '') + '" style="background:' + color +
              ';width:' + s + 'px;height:' + s + 'px;"></div>' +
            '</div>',
          iconSize: [s, s],
          iconAnchor: [s / 2, tipY],
          popupAnchor: [0, -tipY],
        });
      }

      function popupHtml(bin) {
        return (
          '<div style="width:180px;font-family:sans-serif">' +
            '<b style="font-size:15px">' + esc(bin.id) + '</b><br/>' +
            '<span style="color:#4b5563;font-size:13px">' + esc(bin.location) + '</span>' +
            '<div style="margin-top:8px;font-size:13px;font-weight:600">Fill Level</div>' +
            '<div style="background:#e5e7eb;height:8px;border-radius:4px;margin-top:4px;">' +
              '<div style="width:' + Number(bin.fill) + '%;height:8px;border-radius:4px;background:' + bin.pinColor + ';"></div>' +
            '</div>' +
            '<div style="font-size:13px;margin-top:4px;font-weight:600">' + Number(bin.fill) + '%</div>' +
            '<div style="font-size:13px;margin-top:6px;color:#4b5563">Capacity: ' + esc(bin.capacity) + '</div>' +
          '</div>'
        );
      }

      // Only swap the icon when something visual actually changed, so the
      // selected marker's pulse animation isn't restarted on every poll.
      function refreshIcon(id) {
        const m = markers[id];
        const bin = binsById[id];
        if (!m || !bin) return;
        const selected = id === selectedId;
        const sig = bin.pinColor + '|' + selected;
        if (m._sig === sig) return;
        m._sig = sig;
        m.setIcon(pinIcon(bin.pinColor, selected));
        m.setZIndexOffset(selected ? 1000 : 0);
      }

      function fitAll() {
        const list = Object.keys(markers).map(function (k) { return markers[k]; });
        if (!list.length) return;
        if (list.length === 1) {
          map.flyTo(list[0].getLatLng(), 17, { duration: 0.8 });
          return;
        }
        map.flyToBounds(L.featureGroup(list).getBounds().pad(0.3), { duration: 0.8 });
      }

      window.renderBins = function (bins, sel) {
        selectedId = sel || null;
        const seen = {};

        bins.forEach(function (bin) {
          seen[bin.id] = true;
          binsById[bin.id] = bin;
          let m = markers[bin.id];
          if (m) {
            m.setLatLng([bin.lat, bin.lng]);
            m.setPopupContent(popupHtml(bin));
          } else {
            m = L.marker([bin.lat, bin.lng], { icon: pinIcon(bin.pinColor, false) }).addTo(map);
            m._sig = bin.pinColor + '|false';
            m.bindPopup(popupHtml(bin), { closeButton: false });
            m.on('click', function () { post({ type: 'select', id: bin.id }); });
            markers[bin.id] = m;
          }
          refreshIcon(bin.id);
        });

        Object.keys(markers).forEach(function (id) {
          if (!seen[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
            delete binsById[id];
          }
        });

        // Frame all bins once on first load only; later polls never move the camera.
        if (!hasFitted && bins.length) {
          hasFitted = true;
          const list = Object.keys(markers).map(function (k) { return markers[k]; });
          if (list.length === 1) map.setView(list[0].getLatLng(), 17);
          else map.fitBounds(L.featureGroup(list).getBounds().pad(0.3));
        }
      };

      window.selectBin = function (id) {
        selectedId = id || null;
        clearTimeout(openTimer);
        Object.keys(markers).forEach(refreshIcon);

        if (selectedId && markers[selectedId]) {
          const m = markers[selectedId];
          map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 17), { duration: 0.8 });
          // Open the popup once the camera has (mostly) arrived.
          openTimer = setTimeout(function () {
            if (selectedId && markers[selectedId]) markers[selectedId].openPopup();
          }, 850);
        } else {
          map.closePopup();
          fitAll();
        }
      };

      true; // required for injectedJavaScript on some Android WebView versions
    </script>
  </body>
</html>
`;

export default function BinLocationMap() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const webviewRef = useRef<WebView>(null);

  // Keep the latest selection readable inside effects without re-triggering them.
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const fetchBins = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const res = await fetch(API);
      const json = await res.json();
      if (!json.success) throw new Error("Bad response from server");

      const nextBins: Bin[] = json.data.map((bin: any) => ({
        id: bin.binId,
        location: bin.location,
        fill: bin.fill ?? 0,
        capacity: bin.capacity,
        // Fallback coordinates if a bin hasn't been geo-tagged yet
        lat: bin.lat ?? DEFAULT_LAT,
        lng: bin.lng ?? DEFAULT_LNG,
      }));

      setBins(nextBins);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      console.error("Failed to fetch bins:", err);
      setError("Couldn't load bin locations. Pull down or tap the refresh button to retry.");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  // Header refresh button
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchBins(false);
    setRefreshing(false);
  }, [fetchBins]);

  useEffect(() => {
    fetchBins(true);
    const interval = setInterval(() => fetchBins(false), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchBins]);

  // The WebView unmounts while loading / when there are no bins, so the map
  // must be treated as "not ready" again until it finishes loading anew.
  useEffect(() => {
    if (loading || bins.length === 0) setMapReady(false);
  }, [loading, bins.length]);

  // If the selected bin disappears from the data, drop the selection.
  useEffect(() => {
    if (selectedId && !bins.some((b) => b.id === selectedId)) setSelectedId(null);
  }, [bins, selectedId]);

  // Keep the current page valid if the number of bins shrinks
  useEffect(() => {
    const total = Math.max(1, Math.ceil(bins.length / ITEMS_PER_PAGE));
    if (currentPage > total) setCurrentPage(total);
  }, [bins.length, currentPage]);

  // Push the latest bins into the WebView any time they change (initial load,
  // poll refresh, fill-level update). Markers are updated in place.
  useEffect(() => {
    if (!mapReady || !webviewRef.current) return;

    const payload = bins.map((bin) => ({
      ...bin,
      pinColor: statusColors[getStatusFromFill(bin.fill)].pin,
    }));

    webviewRef.current.injectJavaScript(
      `window.renderBins(${JSON.stringify(payload)}, ${JSON.stringify(
        selectedIdRef.current
      )}); true;`
    );
  }, [bins, mapReady]);

  // Highlight the marker + move the map whenever the selection changes.
  useEffect(() => {
    if (!mapReady || !webviewRef.current) return;
    webviewRef.current.injectJavaScript(
      `window.selectBin(${JSON.stringify(selectedId)}); true;`
    );
  }, [selectedId, mapReady]);

  // Tapping a card toggles selection (tap again to deselect and see all bins).
  const onCardPress = useCallback((id: string) => {
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  // Tapping a marker selects its card and jumps to the page that contains it.
  const onWebViewMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg.type === "select" && typeof msg.id === "string") {
          setSelectedId(msg.id);
          const index = bins.findIndex((b) => b.id === msg.id);
          if (index >= 0) setCurrentPage(Math.floor(index / ITEMS_PER_PAGE) + 1);
        }
      } catch {
        // ignore malformed messages
      }
    },
    [bins]
  );

  const counts = bins.reduce(
    (acc, b) => {
      acc[getStatusFromFill(b.fill)] += 1;
      return acc;
    },
    { good: 0, warning: 0, critical: 0 } as Record<Status, number>
  );

  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedBins = bins.slice(startIndex, startIndex + ITEMS_PER_PAGE);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-1 p-4 py-2">
        {/* HEADER */}
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center gap-3 flex-1">
            {/* <View className="w-11 h-11 rounded-full bg-green-100 items-center justify-center">
              <Feather name="map-pin" color="#16a34a" size={22} />
            </View> */}

            <View className="flex-1 pr-3">
              <Text className="text-3xl font-bold text-gray-900">Bin Location Map</Text>
              <Text className="text-base text-gray-600 mt-1">
                {updatedLabel ? `Live view · Updated ${updatedLabel}` : "Live view of all smart bin locations"}
              </Text>
            </View>
          </View>

          {/* <TouchableOpacity
            onPress={onRefresh}
            disabled={refreshing}
            activeOpacity={0.7}
            className="w-10 h-10 rounded-full bg-white border border-gray-200 items-center justify-center"
            accessibilityLabel="Refresh bins"
          >
            {refreshing ? (
              <ActivityIndicator size="small" color="#16a34a" />
            ) : (
              <Feather name="refresh-cw" size={18} color="#16a34a" />
            )}
          </TouchableOpacity> */}
        </View>

        {/* STATUS SUMMARY */}
        <View className="flex-row gap-2 mb-3">
          {(["good", "warning", "critical"] as Status[]).map((s) => (
            <View
              key={s}
              className="flex-1 flex-row items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2"
            >
              <View className={`w-2.5 h-2.5 rounded-full ${statusColors[s].dot}`} />
              <Text className="text-gray-900 font-bold text-base">{counts[s]}</Text>
              <Text className="text-gray-600 font-semibold text-lg">{statusColors[s].label}</Text>
            </View>
          ))}
        </View>

        <View style={{ flex: 1, gap: 12 }}>
          {/* MAP */}
          <View
            style={{ flex: 1 }}
            className="rounded-2xl overflow-hidden border border-gray-200 bg-white"
          >
            {loading ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="#16a34a" />
                <Text className="text-gray-600 text-base mt-2">Loading bins...</Text>
              </View>
            ) : bins.length === 0 ? (
              <View className="flex-1 items-center justify-center">
                <Feather name="trash-2" size={32} color="#9ca3af" />
                <Text className="text-gray-600 text-base mt-2">No bins found.</Text>
              </View>
            ) : (
              <>
                <WebView
                  ref={webviewRef}
                  originWhitelist={["*"]}
                  source={{ html: LEAFLET_HTML }}
                  onLoadEnd={() => setMapReady(true)}
                  onMessage={onWebViewMessage}
                  javaScriptEnabled
                  domStorageEnabled
                  style={{ flex: 1, backgroundColor: "transparent" }}
                />

                {/* Legend */}
                <View
                  pointerEvents="none"
                  className="absolute left-2 bottom-2 flex-row items-center gap-3 bg-white/90 rounded-full px-3 py-1.5 border border-gray-200"
                >
                  {(["good", "warning", "critical"] as Status[]).map((s) => (
                    <View key={s} className="flex-row items-center gap-1">
                      <View className={`w-2 h-2 rounded-full ${statusColors[s].dot}`} />
                      <Text className="text-gray-700 text-xs">{statusColors[s].label}</Text>
                    </View>
                  ))}
                </View>

                {/* Reset view button (only while a bin is selected) */}
                {selectedId && (
                  <TouchableOpacity
                    onPress={() => setSelectedId(null)}
                    activeOpacity={0.8}
                    className="absolute top-2 right-2 flex-row items-center gap-1.5 bg-white rounded-full px-3 py-2 border border-gray-200"
                    style={{ elevation: 3 }}
                  >
                    <Feather name="maximize" size={14} color="#16a34a" />
                    <Text className="text-green-700 text-sm font-semibold">Show all</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>

          {/* BIN LIST (paginated; the ScrollView only exists to enable pull-to-refresh) */}
          <ScrollView
            style={{ flex: 1 }}
            className="border border-gray-200 bg-white rounded-2xl"
            contentContainerStyle={{
              flexGrow: 1,
              padding: 12,
              justifyContent: "space-between",
            }}
            showsVerticalScrollIndicator={false}
            alwaysBounceVertical
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#16a34a"
                colors={["#16a34a"]}
              />
            }
          >
            <View>
              <View className="flex-row items-center justify-between mb-2">
                <Text className="font-bold text-xl text-gray-900">Bins in Barangay</Text>
                {bins.length > 0 && (
                  <Text className="text-gray-500 text-sm">Tap a bin to locate it</Text>
                )}
              </View>

              {error && (
                <View className="flex-row items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 mb-2">
                  <Feather name="alert-circle" size={16} color="#b91c1c" />
                  <Text className="text-red-700 text-sm font-medium flex-1">{error}</Text>
                </View>
              )}

              {!loading && bins.length === 0 && !error && (
                <Text className="text-gray-600 text-base">No bins found.</Text>
              )}

              {paginatedBins.map((bin) => {
                const status = getStatusFromFill(bin.fill);
                const colors = statusColors[status];
                const isSelected = bin.id === selectedId;

                return (
                  <TouchableOpacity
                    key={bin.id}
                    activeOpacity={0.85}
                    onPress={() => onCardPress(bin.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={`${bin.id}, ${bin.fill} percent full. Tap to show on map.`}
                    className={`mb-2 p-3 rounded-xl border-2 ${isSelected ? "border-green-500 bg-green-50" : "border-gray-200 bg-gray-50"
                      }`}
                  >
                    <View className="flex-row justify-between items-center">
                      <View className="flex-row items-center gap-2 flex-1">
                        <View
                          className={`w-7 h-7 rounded-full items-center justify-center ${isSelected ? "bg-green-600" : "bg-gray-200"
                            }`}
                        >
                          <Feather
                            name="trash-2"
                            size={14}
                            color={isSelected ? "#ffffff" : "#4b5563"}
                          />
                        </View>
                        <Text className="text-base font-bold text-gray-900">{bin.id}</Text>
                      </View>
                      <Text className="text-base font-bold text-gray-900">{bin.fill}%</Text>
                    </View>

                    <View className="flex-row items-center gap-1 mt-1">
                      <Feather name="map-pin" size={12} color="#6b7280" />
                      <Text className="text-sm text-gray-600 flex-1" numberOfLines={1}>
                        {bin.location}
                      </Text>
                    </View>

                    <View className="bg-gray-200 h-2 rounded-full mt-2 overflow-hidden">
                      <View
                        className={`h-2 rounded-full ${colors.bar}`}
                        style={{ width: `${Math.min(Math.max(bin.fill, 0), 100)}%` }}
                      />
                    </View>

                    <View className="flex-row items-center justify-between mt-2">
                      <Text
                        className={`self-start px-3 py-0.5 rounded-full text-xs font-semibold capitalize overflow-hidden ${colors.badge}`}
                      >
                        {status}
                      </Text>

                      {isSelected ? (
                        <View className="flex-row items-center gap-1">
                          <Feather name="navigation" size={12} color="#15803d" />
                          <Text className="text-green-700 text-xs font-semibold">Showing on map</Text>
                        </View>
                      ) : (
                        <View className="flex-row items-center gap-1">
                          <Feather name="crosshair" size={12} color="#6b7280" />
                          <Text className="text-gray-500 text-xs">Locate</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Only renders when there are more than ITEMS_PER_PAGE (4) bins */}
            <Pagination
              currentPage={currentPage}
              totalItems={bins.length}
              itemsPerPage={ITEMS_PER_PAGE}
              onPageChange={setCurrentPage}
            />
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}
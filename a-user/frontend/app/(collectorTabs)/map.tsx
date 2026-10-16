import { SafeAreaView } from "react-native-safe-area-context";
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from "react-native"; // NEW: RefreshControl, TouchableOpacity
import { WebView } from "react-native-webview";
import { Feather } from "@expo/vector-icons";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "@/config"; // Import the API base URL

const API = `${API_BASE}/api/bins`;

// Match the web dashboard's poll cadence (and the ESP32's FILL_SEND_INTERVAL_MS)
const POLL_INTERVAL_MS = 10000;

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

const statusColors: Record<Status, { bar: string; badge: string; pin: string }> = {
  good: { bar: "bg-green-600", badge: "bg-green-100 text-green-800", pin: "#16a34a" },
  warning: { bar: "bg-yellow-500", badge: "bg-yellow-100 text-yellow-800", pin: "#f59e0b" },
  critical: { bar: "bg-red-600", badge: "bg-red-100 text-red-800", pin: "#dc2626" },
};

// Static HTML shell for the Leaflet map. Bins are injected after load via
// injectJavaScript(), so this string never needs to change at runtime —
// it just needs to expose a `renderBins(bins)` function on window.
const LEAFLET_HTML = `
<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html, body, #map { height: 100%; margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      const map = L.map('map', { zoomControl: true }).setView([14.86313, 120.7508], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      let markers = [];

      function clearMarkers() {
        markers.forEach((m) => map.removeLayer(m));
        markers = [];
      }

      function pinIcon(color) {
        return L.divIcon({
          className: '',
          html:
            '<div style="background:' + color + ';width:16px;height:16px;border-radius:50% 50% 50% 0;' +
            'transform:rotate(-45deg);border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,0.4);"></div>',
          iconSize: [17, 17],
          iconAnchor: [10, 16],
        });
      }

      // Called from React Native via injectJavaScript whenever bins update.
      window.renderBins = function (bins) {
        clearMarkers();
        if (!bins.length) return;

        bins.forEach((bin) => {
          const marker = L.marker([bin.lat, bin.lng], { icon: pinIcon(bin.pinColor) }).addTo(map);
          marker.bindPopup(
            '<div style="width:170px;font-family:sans-serif">' +
              '<b style="font-size:15px">' + bin.id + '</b><br/>' +
              '<span style="color:#4b5563;font-size:13px">' + bin.location + '</span>' +
              '<div style="margin-top:8px;font-size:13px;font-weight:600">Fill Level</div>' +
              '<div style="background:#e5e7eb;height:8px;border-radius:4px;margin-top:4px;">' +
                '<div style="width:' + bin.fill + '%;height:8px;border-radius:4px;background:' + bin.pinColor + ';"></div>' +
              '</div>' +
              '<div style="font-size:13px;margin-top:4px;font-weight:600">' + bin.fill + '%</div>' +
              '<div style="font-size:13px;margin-top:6px;color:#4b5563">Capacity: ' + bin.capacity + '</div>' +
            '</div>'
          );
          markers.push(marker);
        });

        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.3));
      };

      true; // note: required for injectedJavaScript on some Android WebView versions
    </script>
  </body>
</html>
`;

export default function BinLocationMap() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false); // NEW
  const webviewRef = useRef<WebView>(null);

  // Mirror bins in a ref so the polling interval always has the latest
  // data without needing to be re-created every render.
  const binsRef = useRef<Bin[]>(bins);
  useEffect(() => {
    binsRef.current = bins;
  }, [bins]);

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
        lat: bin.lat ?? 14.86313,
        lng: bin.lng ?? 120.7508,
      }));

      setBins(nextBins);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch bins:", err);
      setError("Couldn't load bin locations. Pull down to retry.");
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  // NEW: used by pull-to-refresh AND the refresh button. Reuses fetchBins.
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

  // Push the latest bins into the WebView any time bins change (initial
  // load, poll refresh, or fill-level update) — but only once the map
  // itself has finished loading and window.renderBins actually exists.
  useEffect(() => {
    if (!mapReady || !webviewRef.current) return;

    const payload = bins.map((bin) => ({
      ...bin,
      pinColor: statusColors[getStatusFromFill(bin.fill)].pin,
    }));

    webviewRef.current.injectJavaScript(
      `window.renderBins(${JSON.stringify(payload)}); true;`
    );
  }, [bins, mapReady]);

  return (
    <SafeAreaView className="flex-1 bg-gray-50">
      <View className="flex-1 p-3">

        {/* HEADER */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center gap-3 flex-1">
            <View className="w-11 h-11 rounded-full bg-green-100 items-center justify-center">
              <Feather name="map-pin" color="#16a34a" size={22} />
            </View>
            <View className="flex-1">
              <Text className="font-bold text-2xl text-gray-900">Bin Location Map</Text>
              <Text className="text-gray-600 text-base">Live view of all smart bin locations</Text>
            </View>
          </View>

        </View>

        <View style={{ flex: 1, gap: 12 }}>

          {/* MAP */}
          <View style={{ flex: 2 }} className="rounded-2xl overflow-hidden border border-gray-200 bg-white">
            {loading ? (
              <View className="flex-1 items-center justify-center">
                <ActivityIndicator size="large" color="green" />
                <Text className="text-gray-600 text-base mt-2">Loading bins...</Text>
              </View>
            ) : bins.length === 0 ? (
              <View className="flex-1 items-center justify-center">
                <Text className="text-gray-600 text-base">No bins found.</Text>
              </View>
            ) : (
              <WebView
                ref={webviewRef}
                originWhitelist={["*"]}
                source={{ html: LEAFLET_HTML }}
                onLoadEnd={() => setMapReady(true)}
                style={{ flex: 1, backgroundColor: "transparent" }}
              />
            )}
          </View>

          {/* BIN LIST (pull down here to refresh) */}
          <ScrollView
            style={{ flex: 1 }}
            className="w-full border border-gray-200 bg-white rounded-2xl p-4"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" colors={["#16a34a"]} />
            }
          >
            <Text className="font-bold text-xl text-gray-900 mb-3">Bins in Barangay</Text>

            {error && (
              <View className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                <Text className="text-red-700 text-sm font-medium">{error}</Text>
              </View>
            )}

            {!loading && bins.length === 0 && !error && (
              <Text className="text-gray-600 text-base">No bins found.</Text>
            )}

            {bins.map((bin) => {
              const status = getStatusFromFill(bin.fill);
              const colors = statusColors[status];

              return (
                <View key={bin.id} className="mb-3 p-4 border border-gray-200 bg-gray-50 rounded-xl">
                  <View className="flex-row justify-between items-center">
                    <Text className="text-lg font-bold text-gray-900">{bin.id}</Text>
                    <Text className="text-lg font-bold text-gray-900">{bin.fill}%</Text>
                  </View>

                  <Text className="text-base text-gray-600 mt-0.5">{bin.location}</Text>

                  <View className="bg-gray-200 h-2.5 rounded-full mt-3 overflow-hidden">
                    <View
                      className={`h-2.5 rounded-full ${colors.bar}`}
                      style={{ width: `${bin.fill}%` }}
                    />
                  </View>

                  <Text
                    className={`mt-3 self-start px-3 py-1 rounded-full text-sm font-semibold capitalize overflow-hidden ${colors.badge}`}
                  >
                    {status}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

        </View>
      </View>
    </SafeAreaView>
  );
}
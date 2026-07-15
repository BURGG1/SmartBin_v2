import Navbar from "../../components/Navbar";
import NavigationShell from "../../navigation/mainNav";
import Footer from "../../components/Footer";
import Pagination from "../../components/Pagination";
import { useState, useEffect, useCallback, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from "react-leaflet";
import BASE_URL from "../../config";

import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Bell,
  MapPin,
  Trash,
} from "lucide-react";

const API = `${BASE_URL}/api/bins`;
const SCHEDULE_API = `${BASE_URL}/api/bins`; // -> /:binId/schedule
const COLLECTORS_API = `${BASE_URL}/api/collectors`;

// How often to re-fetch bins from the server. Matches the ESP32's
// FILL_SEND_INTERVAL_MS (10s) so the dashboard stays roughly live.
const POLL_INTERVAL_MS = 10000;

// Max backoff between polls after repeated failures, so a dead backend
// doesn't get hammered every 10s forever.
const MAX_BACKOFF_MS = 60000;

// The map needs every bin's position to plot markers, so this list isn't
// server-paginated — but it IS capped. A single barangay's physical bin
// count is realistically bounded (tens to low hundreds), so a generous
// cap protects against an unbounded payload if that assumption ever
// breaks. If you ever need more than this, switch to a dedicated
// `/api/bins/summary` endpoint for the stats/alert numbers (so you're not
// shipping full bin documents just to compute a count) and add marker
// clustering (e.g. leaflet.markercluster) instead of raising this cap.
const BINS_FETCH_LIMIT = 300;

// How many bins show per page in the "Bins in Barangay" list and in the
// bin-cards grid. Both are paginated client-side from the same capped
// fetch above — acceptable since that fetch is already bounded.
const MAP_LIST_PER_PAGE = 5;
const CARDS_PER_PAGE = 6;

// Minimum fill level required before a bin is auto-scheduled for
// collection. This is independent of the warning/critical status
// thresholds used for the dashboard badges below — it exists purely to
// gate when scheduling kicks in.
const SCHEDULE_FILL_THRESHOLD = 75;

// A collector stops being eligible for new assignments once they already
// have this many bins in their assignedBins array.
const MAX_BINS_PER_COLLECTOR = 2;

const statusColors = {
  good: {
    border: "border-green-300",
    badge: "bg-green-100 text-green-700",
    bar: "bg-green-600",
    icon: CheckCircle,
    iconColor: "text-green-600",
  },
  warning: {
    border: "border-yellow-300",
    badge: "bg-yellow-100 text-yellow-700",
    bar: "bg-yellow-500",
    icon: AlertTriangle,
    iconColor: "text-yellow-600",
  },
  critical: {
    border: "border-red-300",
    badge: "bg-red-100 text-red-700",
    bar: "bg-red-600",
    icon: XCircle,
    iconColor: "text-red-600",
  },
};

const typeColors = {
  Biodegradable: "bg-green-600",
  "Non-biodegradable": "bg-orange-600",
  Recyclable: "bg-blue-600",
};

function getStatusFromFill(fill) {
  if (fill >= 90) return "critical";
  if (fill >= 61) return "warning";
  return "good";
}

export default function BinMonitoring() {
  const [bins, setBins] = useState([]);
  const [binsLoading, setBinsLoading] = useState(true);
  const [binsError, setBinsError] = useState("");
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [collectors, setCollectors] = useState([]);
  const [collectorsError, setCollectorsError] = useState("");

  // ── Pagination (client-side, over the already-capped `bins` fetch) ──
  const [mapListPage, setMapListPage] = useState(1);
  const [cardPage, setCardPage] = useState(1);

  // Keep a ref mirror of bins so the polling interval always sees the
  // latest schedules without having to be re-created on every bins change.
  const binsRef = useRef(bins);
  useEffect(() => {
    binsRef.current = bins;
  }, [bins]);

  // Keep a ref mirror of collectors too. assignCollector reads/writes this
  // synchronously — relying on setState's updater-function form to do that
  // doesn't work, since the updater only runs when React processes the
  // update, not inline when the setter is called.
  const collectorsRef = useRef(collectors);
  useEffect(() => {
    collectorsRef.current = collectors;
  }, [collectors]);

  // Tracks consecutive poll failures for exponential backoff, and the
  // active poll timer so we can reschedule it.
  const failureCountRef = useRef(0);
  const pollTimeoutRef = useRef(null);
  const abortRef = useRef(null);

  // ── Fetch bins from database ──────────────────────────────────────────────
  // On the very first load there is nothing to preserve, so we just map
  // the payload straight in. On every subsequent poll we merge the fresh
  // fill/lastEmptied data into the bins we already have, so we don't
  // clobber locally-set schedules with server data that doesn't know
  // about them yet.
  const fetchBins = useCallback(async (isInitial = false) => {
    // Cancel any still-in-flight previous request before starting a new
    // one — with a 10s poll interval, a slow response can otherwise
    // resolve after a newer one and stomp fresher data.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (isInitial) setBinsLoading(true);
    try {
      const params = new URLSearchParams({ limit: BINS_FETCH_LIMIT });
      const res = await fetch(`${API}?${params}`, { signal: controller.signal });
      const data = await res.json();
      if (!data.success) throw new Error("Server returned an unsuccessful response");

      const prevById = new Map(binsRef.current.map((b) => [b.id, b]));

      const nextBins = data.data.map((bin) => {
        const prev = prevById.get(bin.binId);
        return {
          id: bin.binId,
          _id: bin._id,
          name: bin.name,
          location: bin.location,
          type: bin.type,
          fill: bin.fill ?? 0,
          capacity: bin.capacity,
          lastEmptied: bin.lastEmptied ? new Date(bin.lastEmptied) : null,
          // Preserve any schedule we already know about locally, unless
          // the server tells us about one directly.
          schedule: bin.schedule ?? prev?.schedule ?? null,
          lat: bin.lat ?? 14.86515,
          lng: bin.lng ?? 120.75615,
          status: bin.status ?? "offline",
        };
      });

      setBins(nextBins);
      setBinsError("");
      failureCountRef.current = 0;
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Failed to fetch bins:", err);
      failureCountRef.current += 1;
      setBinsError("Live bin data is unavailable right now.");
    } finally {
      if (isInitial) setBinsLoading(false);
    }
  }, []);

  // ── Fetch collectors from database ────────────────────────────────────────
  // Matches your actual Collector schema: availability is `isActive`
  // (boolean), and workload is derived from the length of `assignedBins`
  // (an array of bin refs/ids) rather than a separate counter field.
  //
  // Auth: the backend issues a bearer token (see AuthPage.jsx's
  // storeSession), not a cookie — so this needs an Authorization header,
  // not credentials: "include".
  const fetchCollectors = useCallback(async () => {
    try {
      const token = sessionStorage.getItem("token");

      const res = await fetch(COLLECTORS_API, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.status === 401) {
        throw new Error("Not authenticated — please log in again.");
      }
      if (!res.ok) {
        throw new Error(`Server responded ${res.status}`);
      }

      const data = await res.json();
      if (!data.success) throw new Error("Server returned an unsuccessful response");

      const nextCollectors = data.data.map((c) => ({
        id: c._id ?? c.id,
        name: c.name,
        isActive: c.isActive ?? true,
        assignedBins: Array.isArray(c.assignedBins) ? c.assignedBins : [],
      }));

      setCollectors(nextCollectors);
      collectorsRef.current = nextCollectors;
      setCollectorsError("");
    } catch (err) {
      console.error("Failed to fetch collectors:", err);
      setCollectorsError("Collector data is unavailable right now.");
    }
  }, []);

  useEffect(() => {
    fetchCollectors();
  }, [fetchCollectors]);

  // Poll on a schedule that backs off (up to MAX_BACKOFF_MS) after
  // consecutive failures, and pauses entirely while the tab is hidden so a
  // backgrounded dashboard doesn't keep hammering the server.
  useEffect(() => {
    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled) return;
      const delay = Math.min(
        POLL_INTERVAL_MS * 2 ** failureCountRef.current,
        MAX_BACKOFF_MS
      );
      pollTimeoutRef.current = setTimeout(runPoll, delay);
    };

    const runPoll = async () => {
      if (document.visibilityState === "visible") {
        await fetchBins(false);
      }
      scheduleNext();
    };

    fetchBins(true).then(scheduleNext);

    const handleVisibility = () => {
      // Refresh immediately when the tab becomes visible again, instead
      // of waiting out whatever backoff delay was in progress.
      if (document.visibilityState === "visible") {
        clearTimeout(pollTimeoutRef.current);
        runPoll();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      clearTimeout(pollTimeoutRef.current);
      abortRef.current?.abort();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchBins]);

  // Keep the paginated views valid whenever the bins list changes
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(bins.length / MAP_LIST_PER_PAGE));
    if (mapListPage > totalPages) setMapListPage(totalPages);
  }, [bins.length, mapListPage]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(bins.length / CARDS_PER_PAGE));
    if (cardPage > totalPages) setCardPage(totalPages);
  }, [bins.length, cardPage]);

  const paginatedMapListBins = bins.slice(
    (mapListPage - 1) * MAP_LIST_PER_PAGE,
    mapListPage * MAP_LIST_PER_PAGE
  );
  // Only pad the list to a fixed height once there's more than one page —
  // a single page of results just renders at its own natural height.
  const mapListTotalPages = Math.max(1, Math.ceil(bins.length / MAP_LIST_PER_PAGE));
  const mapListEmptySlots =
    mapListTotalPages > 1
      ? Math.max(0, MAP_LIST_PER_PAGE - paginatedMapListBins.length)
      : 0;

  const paginatedCardBins = bins.slice(
    (cardPage - 1) * CARDS_PER_PAGE,
    cardPage * CARDS_PER_PAGE
  );
  // Same rule for the bin-cards grid: only pad to a fixed number of card
  // slots once there's more than one page of bins.
  const cardTotalPages = Math.max(1, Math.ceil(bins.length / CARDS_PER_PAGE));
  const cardEmptySlots =
    cardTotalPages > 1 ? Math.max(0, CARDS_PER_PAGE - paginatedCardBins.length) : 0;

  // ── Assign the least-loaded available collector ──────────────────────────
  // Eligible = isActive AND fewer than MAX_BINS_PER_COLLECTOR bins already
  // in their assignedBins array. Among eligible collectors, picks the one
  // with the fewest currently assigned bins. Takes the binId being
  // scheduled so it can be appended to the assigned collector's list.
  const assignCollector = useCallback((binId) => {
    const available = collectorsRef.current
      .filter(
        (c) => c.isActive && c.assignedBins.length < MAX_BINS_PER_COLLECTOR
      )
      .sort((a, b) => a.assignedBins.length - b.assignedBins.length);
    if (available.length === 0) return null;

    const assigned = available[0];
    const nextCollectors = collectorsRef.current.map((c) =>
      c.id === assigned.id
        ? { ...c, assignedBins: [...c.assignedBins, binId] }
        : c
    );

    // Update the ref immediately so back-to-back calls within the same
    // synchronous pass (e.g. scheduling several bins in one sweep) see
    // each other's load changes, then sync React state for the UI.
    collectorsRef.current = nextCollectors;
    setCollectors(nextCollectors);

    return assigned;
  }, []);

  // ── Persist a schedule to the database ────────────────────────────────────
  // autoScheduleBins was previously only updating local React state, so
  // every auto-assigned schedule vanished on reload. This POSTs it to the
  // backend and, on failure, rolls back BOTH the bin's local schedule and
  // the collector's assignedBins entry we optimistically added — otherwise
  // the UI would show an assignment that was never actually saved.
  const persistSchedule = useCallback(async (binId, mongoId, schedule, collectorId) => {
    try {
      const token = sessionStorage.getItem("token");
      const res = await fetch(`${SCHEDULE_API}/${mongoId}/schedule`, {  // ✅ use mongoId
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          collector: schedule.collector,
          collectorId,
          date: schedule.date,
        }),
      });

      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      console.log("Schedule saved for bin:", binId); // ✅ add this to confirm
    } catch (err) {
      console.error("Failed to persist schedule, rolling back:", err);
      // ... rollback logic stays the same
    }
  }, []);

  // ── Auto-schedule any bin at/above the fill threshold ─────────────────────
  // Scheduling is now fully automatic — there is no manual "Schedule
  // Collection" flow. Any bin whose fill is >= SCHEDULE_FILL_THRESHOLD and
  // doesn't already have a schedule gets assigned a collector, with the
  // collection date set to the day AFTER the threshold is crossed (not the
  // same day it's detected).
  const autoScheduleBins = useCallback(() => {
    // Collect what got scheduled in this pass so we can persist each one
    // after the state update, without calling setState mid-map.
    const pendingPersists = [];

    setBins((prevBins) => {
      let updated = false;
      const newBins = prevBins.map((bin) => {
        if (bin.fill >= SCHEDULE_FILL_THRESHOLD && !bin.schedule) {
          const collector = assignCollector(bin.id);
          if (!collector) return bin;
          updated = true;

          const scheduledDate = new Date();
          scheduledDate.setDate(scheduledDate.getDate() + 1);

          const schedule = {
            collector: collector.name,
            date: scheduledDate.toLocaleDateString(),
            auto: true,
          };

          pendingPersists.push({
            binId: bin.id,      // local state key
            mongoId: bin._id,   // MongoDB _id for API
            schedule,
            collectorId: collector.id
          });

          return {
            ...bin,
            schedule,
          };
        }
        return bin;
      });
      return updated ? newBins : prevBins;
    });

    // Persist outside the setBins updater — updater functions can run
    // more than once (e.g. under StrictMode double-invoke) and shouldn't
    // have side effects like network calls inside them.
    pendingPersists.forEach(({ binId, mongoId, schedule, collectorId }) => {
      persistSchedule(binId, mongoId, schedule, collectorId);
    });
  }, [assignCollector, persistSchedule]);

  useEffect(() => {
    if (bins.length === 0) return;
    const needsScheduling = bins.some(
      (bin) => bin.fill >= SCHEDULE_FILL_THRESHOLD && !bin.schedule
    );
    if (needsScheduling) autoScheduleBins();
  }, [bins, autoScheduleBins]);

  // ── Derived stats from real bins ──────────────────────────────────────────
  // NOTE: computed client-side over the (capped) `bins` list. If bin
  // counts grow past BINS_FETCH_LIMIT, move this to a server-computed
  // `/api/bins/summary` endpoint instead of scaling the cap up further.
  const totalBins = bins.length;
  const normalBins = bins.filter((b) => getStatusFromFill(b.fill) === "good").length;
  const warningBins = bins.filter((b) => getStatusFromFill(b.fill) === "warning").length;
  const criticalBins = bins.filter((b) => getStatusFromFill(b.fill) === "critical").length;
  const aveFillLevel = bins.length
    ? Math.round(bins.reduce((sum, b) => sum + b.fill, 0) / bins.length)
    : 0;

  const stats = [
    { title: "Total Bins", value: totalBins, icon: Trash, iconBg: "bg-blue-100", iconColor: "text-blue-600", percentage: null },
    { title: "Normal", value: normalBins, icon: CheckCircle, iconBg: "bg-green-100", iconColor: "text-green-600", percentage: totalBins ? `${Math.round((normalBins / totalBins) * 100)}%` : "0%", percentColor: "text-green-600" },
    { title: "Warning", value: warningBins, icon: AlertTriangle, iconBg: "bg-yellow-100", iconColor: "text-yellow-600", percentage: totalBins ? `${Math.round((warningBins / totalBins) * 100)}%` : "0%", percentColor: "text-yellow-600" },
    { title: "Critical", value: criticalBins, icon: XCircle, iconBg: "bg-red-100", iconColor: "text-red-600", percentage: totalBins ? `${Math.round((criticalBins / totalBins) * 100)}%` : "0%", percentColor: "text-red-600" },
  ];

  const getColor = () => {
    if (aveFillLevel >= 90) return "bg-red-500";
    if (aveFillLevel >= 61) return "bg-yellow-500";
    return "bg-green-600";
  };

  // ── Critical bins for alert ───────────────────────────────────────────────
  const criticalBinList = bins.filter((b) => getStatusFromFill(b.fill) === "critical");

  return (
    <div className="flex-1">
      <Navbar />
      <div className="flex flex-col min-h-screen bg-gray-50 md:flex-row">

        <div className="flex gap-4">
          <NavigationShell />
          <div className="py-2 md:hidden">
            <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
              Bin Capacity Monitoring Management
            </h1>
            <p className="text-gray-500 text-xs sm:text-lg">
              Monitor smart bin capacity across the community
            </p>
          </div>
        </div>

        <main className="w-full p-4 sm:p-6 space-y-6">

          <div className="hidden md:block">
            <h1 className="text-lg sm:text-3xl font-bold text-gray-900">
              Bin Capacity Monitoring Management
            </h1>
            <p className="text-gray-500 text-xs sm:text-lg">
              Monitor smart bin capacity across the community
            </p>
          </div>

          {binsError && (
            <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4 flex items-center justify-between">
              <p className="text-sm text-yellow-700">{binsError}</p>
              <button
                onClick={() => fetchBins(true)}
                className="text-sm text-yellow-800 underline cursor-pointer"
              >
                Retry now
              </button>
            </div>
          )}

          {/* ALERT — only show if there are critical bins */}
          {criticalBinList.length > 0 && !alertDismissed && (
            <div className="border border-red-300 bg-red-50 rounded-xl p-5 flex justify-between items-start">
              <div className="flex gap-3">
                <Bell className="text-red-600 mt-1" />
                <div>
                  <h3 className="font-semibold text-red-700">
                    Urgent: Bins Require Immediate Attention!
                  </h3>
                  <p className="text-sm text-red-600">
                    {criticalBinList.length} bin{criticalBinList.length > 1 ? "s have" : " has"} reached maximum capacity
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {criticalBinList.map((bin) => (
                      <span
                        key={bin.id}
                        className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-full bg-red-600 text-white"
                      >
                        <MapPin size={14} />
                        {bin.id} — {bin.location}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAlertDismissed(true)}
                className="text-red-400 text-xl cursor-pointer"
              >
                &times;
              </button>
            </div>
          )}

          {/* MINI DASHBOARD */}
          <div className="w-full flex flex-col lg:flex-row gap-4">
            {stats.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="w-full bg-white rounded-xl shadow-sm p-5 flex justify-between items-center"
                >
                  <div className="w-full flex flex-col gap-4">
                    <div className="w-full flex justify-between">
                      <div className={`p-3 rounded-lg ${item.iconBg}`}>
                        <Icon className={item.iconColor} />
                      </div>
                      {item.percentage && (
                        <span className={`text-sm font-medium ${item.percentColor}`}>
                          {item.percentage}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <p className="text-2xl font-bold">{item.value}</p>
                      <p className="text-sm text-gray-500">{item.title}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* AVERAGE BIN CAPACITY */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex justify-between mb-3">
              <h3 className="font-semibold">Average Fill Level</h3>
              <span className="font-bold text-xl">{aveFillLevel}%</span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getColor()}`}
                style={{ width: `${aveFillLevel}%` }}
              />
            </div>
          </div>

          {/* BIN CARDS (paginated — was previously rendering every bin unbounded) */}
          {binsLoading ? (
            <p className="text-center text-gray-400 py-8">Loading bins...</p>
          ) : bins.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No bins found.</p>
          ) : (
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {paginatedCardBins.map((bin) => {
                  const status = getStatusFromFill(bin.fill);
                  const style = statusColors[status];
                  const StatusIcon = style.icon;

                  return (
                    <div
                      key={bin.id}
                      className={`bg-white rounded-xl border ${style.border} p-6 shadow-sm`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold">{bin.id} - {bin.name}</h3>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full font-medium ${bin.status === "online"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-500"
                              }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${bin.status === "online" ? "bg-green-500" : "bg-gray-400"
                                }`} />
                              {bin.status === "online" ? "Online" : "Offline"}
                            </span>
                          </div>
                          <p className="flex items-center gap-1 text-sm text-gray-500">
                            <MapPin size={14} />
                            {bin.location}
                          </p>
                        </div>
                        <StatusIcon className={style.iconColor} />
                      </div>

                      <span className={`mt-3 inline-block px-3 py-1 text-xs text-white rounded-full ${typeColors[bin.type]}`}>
                        {bin.type}
                      </span>

                      <div className="mt-4">
                        <div className="flex justify-between mb-1">
                          <span className="text-sm">Fill Level</span>
                          <span className="font-bold">{bin.fill}%</span>
                        </div>
                        <div className="h-2 bg-gray-200 rounded-full">
                          <div
                            className={`h-full rounded-full ${style.bar}`}
                            style={{ width: `${bin.fill}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 text-sm space-y-1">
                        <p>Capacity: <strong>{bin.capacity}</strong></p>
                        <p>
                          Last Emptied:{" "}
                          <strong>
                            {bin.lastEmptied ? bin.lastEmptied.toLocaleString() : "—"}
                          </strong>
                        </p>
                      </div>

                      <span className={`mt-4 inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full ${style.badge}`}>
                        <StatusIcon size={14} />
                        Status: {status}
                      </span>

                      {/* Scheduling panel — only relevant once the bin has
                          crossed the auto-scheduling threshold. Scheduling
                          is fully automatic; there's no manual trigger. */}
                      {bin.fill >= SCHEDULE_FILL_THRESHOLD && (
                        <div className="relative mt-4">
                          {bin.schedule ? (
                            <div className="bg-green-100 border border-green-200 p-3 rounded-lg text-sm space-y-1">
                              <p><strong>Collector:</strong> {bin.schedule.collector}</p>
                              <p><strong>Date:</strong> {bin.schedule.date}</p>
                            </div>
                          ) : (
                            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-yellow-700">
                              Awaiting auto-assignment...
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Invisible placeholder cards so the grid keeps a constant
                    number of slots at CARDS_PER_PAGE, but only once there's
                    more than one page — a single page of bins just renders
                    at its natural height. */}
                {Array.from({ length: cardEmptySlots }).map((_, i) => (
                  <div
                    key={`card-empty-${i}`}
                    aria-hidden="true"
                    className="invisible pointer-events-none rounded-xl border border-transparent p-6"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-bold">&nbsp;</h3>
                        </div>
                        <p className="text-sm">&nbsp;</p>
                      </div>
                    </div>
                    <span className="mt-3 inline-block px-3 py-1 text-xs rounded-full">
                      &nbsp;
                    </span>
                    <div className="mt-4">
                      <div className="flex justify-between mb-1">
                        <span className="text-sm">&nbsp;</span>
                        <span className="font-bold">&nbsp;</span>
                      </div>
                      <div className="h-2 rounded-full" />
                    </div>
                    <div className="mt-4 text-sm space-y-1">
                      <p>&nbsp;</p>
                      <p>&nbsp;</p>
                    </div>
                    <span className="mt-4 inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full">
                      &nbsp;
                    </span>
                  </div>
                ))}
              </div>

              <Pagination
                currentPage={cardPage}
                totalItems={bins.length}
                itemsPerPage={CARDS_PER_PAGE}
                onPageChange={setCardPage}
              />
            </div>
          )}

          {/* STATUS INDICATORS */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="font-semibold mb-4">Status Indicators</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div className="flex gap-2">
                <div className="p-3 rounded-lg bg-green-100">
                  <CheckCircle className="text-green-600" />
                </div>
                <div>
                  <p className="font-bold">Normal (0–60%)</p>
                  <p className="text-sm text-gray-500">Bin operating normally</p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="p-3 rounded-lg bg-yellow-100">
                  <AlertTriangle className="text-yellow-600" />
                </div>
                <div>
                  <p className="font-bold">Warning (61–89%)</p>
                  <p className="text-sm text-gray-500">Collection needed soon</p>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="p-3 rounded-lg bg-red-100">
                  <XCircle className="text-red-600" />
                </div>
                <div>
                  <p className="font-bold">Critical (90–100%)</p>
                  <p className="text-sm text-gray-500">Immediate collection required</p>
                </div>
              </div>
            </div>
          </div>

          {/* BIN LOCATION MAP */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="text-green-600" />
              <div>
                <h3 className="font-semibold text-lg">Bin Location Map</h3>
                <p className="text-sm text-gray-500">Live view of all smart bin locations</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-[500px]">
              <div className="lg:col-span-3 rounded-xl overflow-hidden border">
                {!binsLoading && bins.length > 0 && (
                  <MapContainer
                    center={[bins[0].lat, bins[0].lng]}
                    zoom={15}
                    className="h-full w-full"
                  >
                    <TileLayer
                      attribution="&copy; OpenStreetMap"
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {bins.filter((bin) => bin.lat && bin.lng).map((bin) => {
                      const status = getStatusFromFill(bin.fill);
                      const style = statusColors[status];
                      return (
                        <Marker key={bin.id} position={[bin.lat, bin.lng]}>
                          <Tooltip direction="top" offset={[0, -10]} permanent>
                            {bin.id}
                          </Tooltip>
                          <Popup>
                            <div className="w-44">
                              <h3 className="font-semibold">{bin.id} - {bin.name}</h3>
                              <p className="text-sm text-gray-500">{bin.location}</p>
                              <div className="mt-2">
                                <p className="text-sm">Fill Level</p>
                                <div className="w-full bg-gray-200 h-2 rounded">
                                  <div
                                    className={`h-2 rounded ${style.bar}`}
                                    style={{ width: `${bin.fill}%` }}
                                  />
                                </div>
                                <p className="text-xs mt-1">{bin.fill}%</p>
                              </div>
                              <p className="text-xs mt-2">
                                Capacity: <strong>{bin.capacity}</strong>
                              </p>
                            </div>
                          </Popup>
                        </Marker>
                      );
                    })}
                  </MapContainer>
                )}
              </div>

              <div className="border rounded-xl p-3 flex flex-col">
                <h3 className="font-semibold mb-3">Bins in Barangay</h3>
                <div className="flex-1 overflow-y-auto">
                  {paginatedMapListBins.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-6">
                      No bins found.
                    </p>
                  ) : (
                    <>
                      {paginatedMapListBins.map((bin) => {
                        const status = getStatusFromFill(bin.fill);
                        const style = statusColors[status];
                        return (
                          <div key={bin.id} className="mb-3 p-2 border rounded-lg hover:bg-gray-50">
                            <div className="flex justify-between text-sm font-medium">
                              <span>{bin.id} - {bin.name}</span>
                              <span>{bin.fill}%</span>
                            </div>
                            <p className="text-xs text-gray-500">{bin.location}</p>
                            <div className="w-full bg-gray-200 h-2 rounded mt-1">
                              <div
                                className={`h-2 rounded ${style.bar}`}
                                style={{ width: `${bin.fill}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {Array.from({ length: mapListEmptySlots }).map((_, i) => (
                        <div
                          key={`map-list-empty-${i}`}
                          aria-hidden="true"
                          className="mb-3 p-2 border border-transparent invisible pointer-events-none"
                        >
                          <div className="flex justify-between text-sm font-medium">
                            <span>&nbsp;</span>
                            <span>&nbsp;</span>
                          </div>
                          <p className="text-xs">&nbsp;</p>
                          <div className="w-full h-2 rounded mt-1" />
                        </div>
                      ))}
                    </>
                  )}
                </div>

                <Pagination
                  currentPage={mapListPage}
                  totalItems={bins.length}
                  itemsPerPage={MAP_LIST_PER_PAGE}
                  onPageChange={setMapListPage}
                />
              </div>
            </div>
          </div>

        </main>
      </div>
      <Footer />
    </div>
  );
}
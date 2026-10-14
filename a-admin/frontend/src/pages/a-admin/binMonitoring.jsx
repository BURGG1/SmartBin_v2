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
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  X,
  UserCheck,
} from "lucide-react";

const API = `${BASE_URL}/api/bins`;
const SCHEDULE_API = `${BASE_URL}/api/bins`; // -> /:binId/schedule
const COLLECTORS_API = `${BASE_URL}/api/collectors`;

// How often to re-fetch bins from the server. Matches the ESP32's
// FILL_SEND_INTERVAL_MS (10s) so the dashboard stays roughly live.
const POLL_INTERVAL_MS = 10000;

// Max backoff between polls after repeated failures.
const MAX_BACKOFF_MS = 60000;

// The map needs every bin's position, so the list isn't server-paginated,
// but it IS capped. If you outgrow this, add a `/api/bins/summary` endpoint
// for stats and marker clustering instead of raising the cap.
const BINS_FETCH_LIMIT = 300;

const MAP_LIST_PER_PAGE = 5;
const CARDS_PER_PAGE = 6;

// Minimum fill level before a bin is auto-scheduled for collection.
const SCHEDULE_FILL_THRESHOLD = 75;

// A collector stops being eligible once they hold this many bins.
const MAX_BINS_PER_COLLECTOR = 2;

// After an auto-schedule fails to save, wait this long before retrying that
// bin so a failing endpoint can't cause a tight retry loop.
const AUTO_RETRY_COOLDOWN_MS = 60000;

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

// ── Date helpers (all local time, dates stored as "YYYY-MM-DD") ─────────────
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(str) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(str ?? "");
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function formatScheduleDate(value) {
  if (!value) return "-";
  const d = parseISODate(value) ?? new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── Collector helpers ───────────────────────────────────────────────────────
// assignedBins can hold ObjectId strings, binId strings, or populated docs.
function refToString(ref) {
  if (ref && typeof ref === "object") return String(ref._id ?? ref.binId ?? ref.id);
  return String(ref);
}

// Accurate per-collector workload: a set of binIds built from (a) the
// server's assignedBins, (b) every bin whose schedule points at the
// collector, and (c) assignments still being saved. Using a Set means a bin
// is never double counted, and the numbers stay right even when the server
// and the local state use different id formats (_id vs binId).
function computeLoads(collectors, bins, pending) {
  const toBinId = new Map();
  bins.forEach((b) => {
    toBinId.set(b.id, b.id);
    if (b._id) toBinId.set(String(b._id), b.id);
  });

  const finished = new Set(
    bins.filter((b) => b.scheduleCompleted && !b.schedule).map((b) => b.id)
  );

  const loads = new Map();
  collectors.forEach((c) => {
    const ids = c.assignedBins
      .map((r) => toBinId.get(r) ?? r)
      .filter((id) => !finished.has(id));
    loads.set(c.id, new Set(ids));
  });
  bins.forEach((b) => {
    const cid = b.schedule?.collectorId;
    if (cid && loads.has(cid)) loads.get(cid).add(b.id);
  });
  pending.forEach((cid, binId) => loads.get(cid)?.add(binId));
  return loads;
}

// Eligible = active, under the cap, AND tied for the lightest workload
// among such collectors (so unassigned collectors come first, then the
// next-lightest, never someone busier while a lighter one is free).
function getEligibleCollectors(collectors, bins, pending) {
  const loads = computeLoads(collectors, bins, pending);
  const pool = collectors
    .filter((c) => c.isActive)
    .map((c) => ({ ...c, load: loads.get(c.id).size }))
    .filter((c) => c.load < MAX_BINS_PER_COLLECTOR);
  if (pool.length === 0) return [];
  const min = Math.min(...pool.map((c) => c.load));
  return pool
    .filter((c) => c.load === min)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeSchedule(s) {
  if (!s) return null;
  if (typeof s !== "object") return null;
  const collectorObj = s.collector && typeof s.collector === "object" ? s.collector : null;
  const collectorId = s.collectorId ?? collectorObj?._id ?? null;
  return {
    collector: collectorObj?.name ?? s.collectorName ?? (collectorObj ? null : s.collector) ?? "Unassigned",
    collectorId: collectorId ? String(collectorId) : null,
    date: s.date ?? null,
    createdAt: s.createdAt ? new Date(s.createdAt) : null,
    completed: Boolean(
      s.completed || s.isCompleted || s.isCollected ||
      s.status === "completed" || s.status === "collected"
    ),
  };
}

// A schedule is complete when the server says so, or when the bin has been
// emptied since the schedule was created (falls back to the scheduled date
// if the creation time is unknown). Completed schedules are dropped from the
// bin so the admin can set the next one, or the auto-scheduler can resume.
function isScheduleComplete(schedule, lastEmptied) {
  if (!schedule) return false;
  if (schedule.completed) return true;
  if (!lastEmptied) return false;
  const since = schedule.createdAt ?? parseISODate(schedule.date);
  return Boolean(since) && lastEmptied >= since;
}

// ── Calendar ────────────────────────────────────────────────────────────────
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function CalendarPicker({ value, onChange, minDate }) {
  const selected = parseISODate(value);
  const [view, setView] = useState(() => {
    const base = selected ?? minDate;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = view.getFullYear();
  const month = view.getMonth();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];

  const minMonth = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const canGoPrev = view > minMonth;
  const today = startOfToday();

  return (
    <div className="border rounded-xl p-3 select-none">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setView(new Date(year, month - 1, 1))}
          disabled={!canGoPrev}
          aria-label="Previous month"
          className="p-1.5 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer disabled:cursor-not-allowed"
        >
          <ChevronLeft size={18} />
        </button>
        <p className="text-sm font-semibold" aria-live="polite">
          {view.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </p>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          aria-label="Next month"
          className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-xs text-gray-400 mb-1">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => {
          if (!date) return <div key={`blank-${i}`} />;
          const iso = toISODate(date);
          const disabled = date < minDate;
          const isSelected = value === iso;
          const isToday = date.getTime() === today.getTime();
          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              onClick={() => onChange(iso)}
              aria-label={formatScheduleDate(iso)}
              aria-pressed={isSelected}
              className={[
                "h-9 rounded-lg text-sm transition-colors",
                disabled
                  ? "text-gray-300 cursor-not-allowed"
                  : "cursor-pointer hover:bg-gray-100",
                isSelected ? "!bg-gray-900 !text-white font-semibold" : "",
                isToday && !isSelected ? "ring-1 ring-gray-400" : "",
              ].join(" ")}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Schedule modal ──────────────────────────────────────────────────────────
function ScheduleModal({ bin, eligible, collectorsReady, onClose, onSubmit }) {
  const minDate = startOfToday();
  const [collectorId, setCollectorId] = useState("");
  const [date, setDate] = useState(toISODate(addDays(minDate, 1)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const selectRef = useRef(null);

  // If the chosen collector drops out of the eligible list (workload
  // changed after a poll), fall back to the first eligible one.
  const effectiveId = eligible.some((c) => c.id === collectorId)
    ? collectorId
    : eligible[0]?.id ?? "";

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    selectRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, submitting]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!effectiveId || !date || submitting) return;
    setSubmitting(true);
    setError("");
    const result = await onSubmit(bin.id, effectiveId, date);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
    }
    // On success the parent closes the modal.
  };

  const noOneAvailable = collectorsReady && eligible.length === 0;
  const status = getStatusFromFill(bin.fill);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-modal-title"
        onSubmit={handleSubmit}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[95vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between p-5 border-b">
          <div>
            <h2 id="schedule-modal-title" className="text-lg font-bold">
              Set Collection Schedule
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {bin.id} - {bin.name} · <span className="capitalize">{status}</span> ({bin.fill}%)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 cursor-pointer disabled:opacity-40"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Collector */}
          <div>
            <label htmlFor="collector-select" className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
              <UserCheck size={16} className="text-gray-500" />
              Collector
            </label>
            <select
              id="collector-select"
              ref={selectRef}
              value={effectiveId}
              onChange={(e) => setCollectorId(e.target.value)}
              disabled={eligible.length === 0 || submitting}
              className="w-full border rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-100 disabled:text-gray-400"
            >
              {eligible.length === 0 ? (
                <option value="">
                  {collectorsReady ? "No collector available" : "Loading collectors..."}
                </option>
              ) : (
                eligible.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} - {c.load === 0 ? "no bins assigned" : `${c.load} bin${c.load > 1 ? "s" : ""} assigned`}
                  </option>
                ))
              )}
            </select>
            {noOneAvailable ? (
              <p className="text-xs text-red-600 mt-1.5">
                Every active collector is at the {MAX_BINS_PER_COLLECTOR}-bin limit, or none are active.
              </p>
            ) : (
              <p className="text-xs text-gray-500 mt-1.5">
                Only collectors with the lightest workload are listed.
              </p>
            )}
          </div>

          {/* Date */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <CalendarDays size={16} className="text-gray-500" />
                Collection date
              </span>
              <div className="flex gap-1.5">
                {[
                  { label: "Today", d: minDate },
                  { label: "Tomorrow", d: addDays(minDate, 1) },
                ].map(({ label, d }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setDate(toISODate(d))}
                    className={`px-2.5 py-1 text-xs rounded-full border cursor-pointer ${date === toISODate(d)
                      ? "bg-gray-900 text-white border-gray-900"
                      : "hover:bg-gray-100"
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <CalendarPicker value={date} onChange={setDate} minDate={minDate} />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-5 border-t bg-gray-50 sm:rounded-b-2xl">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 text-sm rounded-lg border bg-white hover:bg-gray-100 cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!effectiveId || !date || submitting}
            className="px-4 py-2.5 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Saving..." : `Confirm${date ? ` · ${formatScheduleDate(date)}` : ""}`}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function BinMonitoring() {
  const [bins, setBins] = useState([]);
  const [binsLoading, setBinsLoading] = useState(true);
  const [binsError, setBinsError] = useState("");
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [collectors, setCollectors] = useState([]);
  const [collectorsLoaded, setCollectorsLoaded] = useState(false);
  const [collectorsError, setCollectorsError] = useState("");

  // Schedule modal + confirmation toast
  const [modalBinId, setModalBinId] = useState(null);
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);
  const [mapListPage, setMapListPage] = useState(1);
  const [cardPage, setCardPage] = useState(1);

  // Ref mirrors so callbacks/polling always see current data synchronously.
  const binsRef = useRef(bins);
  const collectorsRef = useRef(collectors);
  // binId -> collectorId for schedules currently being saved. Counted in
  // collector workload so back-to-back assignments never over-book anyone.
  const pendingRef = useRef(new Map());
  // binId -> timestamp of the last failed auto-schedule save.
  const failedAutoRef = useRef(new Map());

  const failureCountRef = useRef(0);
  const pollTimeoutRef = useRef(null);
  const abortRef = useRef(null);

  // Update bins in state AND the ref in the same step, so code that runs
  // right after (before React re-renders) reads fresh data.
  const applyBins = useCallback((updater) => {
    const next = updater(binsRef.current);
    binsRef.current = next;
    setBins(next);
  }, []);

  const showToast = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 5000);
  }, []);

  useEffect(() => () => clearTimeout(toastTimerRef.current), []);

  // ── Fetch bins ────────────────────────────────────────────────────────────
  // Merge fresh data into what we already have so locally-known schedules
  // aren't clobbered by a server payload that doesn't include them.
  const fetchBins = useCallback(async (isInitial = false) => {
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
        const lastEmptied = bin.lastEmptied ? new Date(bin.lastEmptied) : null;
        const merged = normalizeSchedule(bin.schedule) ?? prev?.schedule ?? null;
        const completed = isScheduleComplete(merged, lastEmptied);
        return {
          id: bin.binId,
          _id: bin._id,
          name: bin.name,
          location: bin.location,
          type: bin.type,
          fill: bin.fill ?? 0,
          capacity: bin.capacity,
          lastEmptied,
          // Completed schedules are cleared; the flag stops the collector's
          // stale `assignedBins` entry from still counting toward workload.
          schedule: completed ? null : merged,
          scheduleCompleted: completed || (!merged && Boolean(prev?.scheduleCompleted)),
          lat: bin.lat ?? 14.86515,
          lng: bin.lng ?? 120.75615,
          status: bin.status ?? "offline",
        };
      });

      binsRef.current = nextBins;
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

  // ── Fetch collectors ──────────────────────────────────────────────────────
  // Bearer token auth (see AuthPage.jsx's storeSession). Workload comes from
  // `assignedBins`; availability from `isActive`.
  const fetchCollectors = useCallback(async () => {
    try {
      const token = sessionStorage.getItem("token");
      const res = await fetch(COLLECTORS_API, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (res.status === 401) throw new Error("Not authenticated - please log in again.");
      if (!res.ok) throw new Error(`Server responded ${res.status}`);

      const data = await res.json();
      if (!data.success) throw new Error("Server returned an unsuccessful response");

      const nextCollectors = data.data.map((c) => ({
        id: String(c._id ?? c.id),
        name: c.name,
        isActive: c.isActive ?? true,
        assignedBins: Array.isArray(c.assignedBins) ? c.assignedBins.map(refToString) : [],
      }));

      collectorsRef.current = nextCollectors;
      setCollectors(nextCollectors);
      setCollectorsLoaded(true);
      setCollectorsError("");
    } catch (err) {
      console.error("Failed to fetch collectors:", err);
      setCollectorsError("Collector data is unavailable right now.");
    }
  }, []);

  useEffect(() => {
    fetchCollectors();
  }, [fetchCollectors]);

  // Poll bins (and collectors, so workload stays accurate when other
  // dispatchers assign bins). Backs off on failure; pauses while hidden.
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
        await Promise.all([fetchBins(false), fetchCollectors()]);
      }
      scheduleNext();
    };

    fetchBins(true).then(scheduleNext);

    const handleVisibility = () => {
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
  }, [fetchBins, fetchCollectors]);

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
  const mapListTotalPages = Math.max(1, Math.ceil(bins.length / MAP_LIST_PER_PAGE));
  const mapListEmptySlots =
    mapListTotalPages > 1
      ? Math.max(0, MAP_LIST_PER_PAGE - paginatedMapListBins.length)
      : 0;

  const paginatedCardBins = bins.slice(
    (cardPage - 1) * CARDS_PER_PAGE,
    cardPage * CARDS_PER_PAGE
  );
  const cardTotalPages = Math.max(1, Math.ceil(bins.length / CARDS_PER_PAGE));
  const cardEmptySlots =
    cardTotalPages > 1 ? Math.max(0, CARDS_PER_PAGE - paginatedCardBins.length) : 0;

  // ── Commit a schedule (used by both manual and automatic scheduling) ─────
  // 1. Re-validates the collector against CURRENT workload (not whatever the
  //    modal was showing when it opened).
  // 2. Reserves the slot synchronously (pendingRef + optimistic bin update)
  //    before any await, so concurrent calls can't pick the same slot.
  // 3. Saves to the server, then refreshes collectors from the server.
  // 4. Rolls the bin back if the save fails.
  const commitSchedule = useCallback(
    async (binId, collectorId, dateISO, auto) => {
      const bin = binsRef.current.find((b) => b.id === binId);
      if (!bin) return { ok: false, error: "This bin no longer exists." };
      if (bin.schedule || pendingRef.current.has(binId)) {
        return { ok: false, error: "This bin already has a collection scheduled." };
      }

      const eligible = getEligibleCollectors(
        collectorsRef.current,
        binsRef.current,
        pendingRef.current
      );
      const collector = eligible.find((c) => c.id === collectorId);
      if (!collector) {
        return {
          ok: false,
          error: "That collector is no longer available. Please choose another.",
        };
      }

      const schedule = {
        collector: collector.name,
        collectorId: collector.id,
        date: dateISO,
        createdAt: new Date(),
        completed: false,
      };

      pendingRef.current.set(binId, collector.id);
      applyBins((prev) => prev.map((b) => (b.id === binId ? { ...b, schedule } : b)));

      try {
        const token = sessionStorage.getItem("token");
        const res = await fetch(`${SCHEDULE_API}/${binId}/schedule`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            collector: schedule.collector,
            collectorId: schedule.collectorId,
            date: schedule.date,
            auto,
          }),
        });
        if (!res.ok) throw new Error(`Server responded ${res.status}`);

        failedAutoRef.current.delete(binId);
        await fetchCollectors();
        return { ok: true, schedule };
      } catch (err) {
        console.error("Failed to persist schedule, rolling back:", err);
        applyBins((prev) =>
          prev.map((b) => (b.id === binId ? { ...b, schedule: null } : b))
        );
        if (auto) failedAutoRef.current.set(binId, Date.now());
        return { ok: false, error: "Couldn't save the schedule. Please try again." };
      } finally {
        pendingRef.current.delete(binId);
      }
    },
    [applyBins, fetchCollectors]
  );

  // ── Auto-schedule any bin at/above the fill threshold ─────────────────────
  // Each bin gets the lightest-loaded eligible collector, collection the day
  // after it was detected. Each commitSchedule call reserves its slot
  // synchronously, so the next bin in the loop sees the updated workload.
  useEffect(() => {
    if (!collectorsLoaded) return;
    const now = Date.now();
    const tomorrow = toISODate(addDays(startOfToday(), 1));

    binsRef.current.forEach((bin) => {
      if (bin.fill < SCHEDULE_FILL_THRESHOLD || bin.schedule) return;
      if (pendingRef.current.has(bin.id)) return;
      // Don't compete with an admin who is setting this bin's schedule.
      if (modalBinId === bin.id) return;
      const failedAt = failedAutoRef.current.get(bin.id);
      if (failedAt && now - failedAt < AUTO_RETRY_COOLDOWN_MS) return;

      const eligible = getEligibleCollectors(
        collectorsRef.current,
        binsRef.current,
        pendingRef.current
      );
      if (eligible.length === 0) return;
      commitSchedule(bin.id, eligible[0].id, tomorrow, true);
    });
    // modalBinId is a dependency so auto-scheduling resumes immediately if
    // the admin cancels the modal on a bin that's already at/above threshold.
  }, [bins, collectors, collectorsLoaded, commitSchedule, modalBinId]);

  // ── Manual schedule from the modal ────────────────────────────────────────
  const handleManualSchedule = useCallback(
    async (binId, collectorId, dateISO) => {
      const result = await commitSchedule(binId, collectorId, dateISO, false);
      if (result.ok) {
        setModalBinId(null);
        showToast(
          `Collection for ${binId} scheduled on ${formatScheduleDate(dateISO)} with ${result.schedule.collector}.`
        );
      }
      return result;
    },
    [commitSchedule, showToast]
  );

  const closeModal = useCallback(() => setModalBinId(null), []);

  const modalBin = modalBinId ? bins.find((b) => b.id === modalBinId) : null;
  const eligibleCollectors = modalBin
    ? getEligibleCollectors(collectors, bins, pendingRef.current)
    : [];

  // ── Derived stats ─────────────────────────────────────────────────────────
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

          {collectorsError && (
            <div className="border border-yellow-300 bg-yellow-50 rounded-xl p-4 flex items-center justify-between">
              <p className="text-sm text-yellow-700">
                {collectorsError} Scheduling is paused until collectors load.
              </p>
              <button
                onClick={fetchCollectors}
                className="text-sm text-yellow-800 underline cursor-pointer"
              >
                Retry now
              </button>
            </div>
          )}

          {toast && (
            <div
              role="status"
              className="border border-green-300 bg-green-50 rounded-xl p-4 flex items-center justify-between"
            >
              <p className="flex items-center gap-2 text-sm text-green-800">
                <CheckCircle size={16} />
                {toast}
              </p>
              <button
                onClick={() => setToast("")}
                aria-label="Dismiss"
                className="text-green-700 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>
          )}

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
                        {bin.id} - {bin.location}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAlertDismissed(true)}
                aria-label="Dismiss alert"
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

          {/* BIN CARDS */}
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
                  const awaitingAuto =
                    !bin.schedule && bin.fill >= SCHEDULE_FILL_THRESHOLD;

                  return (
                    <div
                      key={bin.id}
                      className={`flex flex-col bg-white rounded-xl border ${style.border} p-6 shadow-sm`}
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

                      <span className={`mt-3 self-start px-3 py-1 text-xs text-white rounded-full ${typeColors[bin.type]}`}>
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
                            {bin.lastEmptied ? bin.lastEmptied.toLocaleString() : "-"}
                          </strong>
                        </p>
                      </div>

                      <span className={`mt-4 self-start inline-flex items-center gap-1 px-3 py-1 text-sm rounded-full ${style.badge}`}>
                        <StatusIcon size={14} />
                        Status: {status}
                      </span>

                      {/* Set Schedule — hidden once a collection is scheduled */}
                      {!bin.schedule && (
                        <button
                          type="button"
                          onClick={() => setModalBinId(bin.id)}
                          className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 cursor-pointer"
                        >
                          <CalendarDays size={16} />
                          Set Schedule
                        </button>
                      )}

                      {/* Schedule summary — bottom of every card, manual or auto */}
                      <div className="mt-auto pt-4">
                        {bin.schedule ? (
                          <div className="bg-green-50 border border-green-200 p-3 rounded-lg text-sm space-y-1.5">
                            <p className="flex items-center gap-1.5 font-semibold text-green-800">
                              <CalendarDays size={14} />
                              Collection scheduled
                            </p>
                            <p><strong>Collector:</strong> {bin.schedule.collector}</p>
                            <p><strong>Date:</strong> {formatScheduleDate(bin.schedule.date)}</p>
                          </div>
                        ) : awaitingAuto ? (
                          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-sm text-yellow-700">
                            Awaiting auto-assignment...
                          </div>
                        ) : (
                          <div className="bg-gray-50 border border-gray-200 p-3 rounded-lg text-sm text-gray-500">
                            No collection scheduled
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Invisible placeholders keep the grid a constant height
                    once there's more than one page. */}
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
                    <div className="mt-4 h-10" />
                    <div className="pt-4 h-24" />
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
                              {bin.schedule && (
                                <p className="text-xs mt-2">
                                  Pickup: <strong>{formatScheduleDate(bin.schedule.date)}</strong> · {bin.schedule.collector}
                                </p>
                              )}
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

      {modalBin && !modalBin.schedule && (
        <ScheduleModal
          bin={modalBin}
          eligible={eligibleCollectors}
          collectorsReady={collectorsLoaded}
          onClose={closeModal}
          onSubmit={handleManualSchedule}
        />
      )}
    </div>
  );
}
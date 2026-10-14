
import {
  Recycle,
  LogOut,
  Bell,
  Trash2,
  AlertTriangle,
  UserPlus,
  User,
  CheckCheck,
} from "lucide-react";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ConfirmationModal from "./confirmationModal";

// Use your deployed backend URL through VITE_API_URL in production.
const API_URL = (
  import.meta.env.VITE_API_URL || "http://localhost:5000"
).replace(/\/+$/, "");

const POLL_MS = 30000;

const TYPE_ICON = {
  bin_critical: <Trash2 size={16} className="text-red-500" />,
  household_flagged: (
    <AlertTriangle size={16} className="text-orange-500" />
  ),
  registration_request: (
    <UserPlus size={16} className="text-blue-500" />
  ),
  missed_collection: (
    <AlertTriangle size={16} className="text-red-500" />
  ),
};

const timeAgo = (date) => {
  const timestamp = new Date(date).getTime();

  if (!Number.isFinite(timestamp)) return "";

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 1000)
  );

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;

  return `${Math.floor(seconds / 86400)}d ago`;
};

const getAuthHeaders = () => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${sessionStorage.getItem("token")}`,
});

const readJsonResponse = async (response) => {
  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("The server returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
        data.error ||
        `Request failed with status ${response.status}.`
    );
  }

  return data;
};

export default function Navbar() {
  const [openConModal, setOpenConModal] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [openNotif, setOpenNotif] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState(false);

  // Missed-collection reassignment state.
  const [collectorOptions, setCollectorOptions] = useState([]);
  const [reassignOpenId, setReassignOpenId] = useState(null);
  const [selectedCollectorId, setSelectedCollectorId] = useState("");
  const [reassignError, setReassignError] = useState("");
  const [reassignBusy, setReassignBusy] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const navigate = useNavigate();
  const profileRef = useRef(null);
  const notifRef = useRef(null);
  const reassignBusyRef = useRef(false);

  let user = null;

  try {
    user = JSON.parse(sessionStorage.getItem("user"));
  } catch {
    user = null;
  }

  const email = user?.email || "No email on file";

  // Load notifications from the authenticated backend.
  const fetchNotifications = useCallback(async (signal) => {
    try {
      const response = await fetch(`${API_URL}/api/notifications`, {
        headers: getAuthHeaders(),
        signal,
      });

      const data = await readJsonResponse(response);

      const items = Array.isArray(data)
        ? data
        : Array.isArray(data.notifications)
          ? data.notifications
          : Array.isArray(data.data)
            ? data.data
            : [];

      setNotifications(items);
      setNotifError(false);
    } catch (error) {
      if (error.name !== "AbortError") {
        console.error("Failed to load notifications:", error);
        setNotifError(true);
      }
    } finally {
      if (!signal?.aborted) {
        setNotifLoading(false);
      }
    }
  }, []);

  // Initial load and polling. Pause polling while the tab is hidden.
  useEffect(() => {
    const controller = new AbortController();

    fetchNotifications(controller.signal);

    const interval = setInterval(() => {
      if (!document.hidden) {
        fetchNotifications(controller.signal);
      }
    }, POLL_MS);

    const handleVisibility = () => {
      if (!document.hidden) {
        fetchNotifications(controller.signal);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      controller.abort();
      clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility
      );
    };
  }, [fetchNotifications]);

  // Mark one notification as read.
  const markAsRead = async (id) => {
    const previous = notifications;

    setNotifications((current) =>
      current.map((n) =>
        n._id === id ? { ...n, read: true } : n
      )
    );

    try {
      const response = await fetch(
        `${API_URL}/api/notifications/${id}/read`,
        {
          method: "PATCH",
          headers: getAuthHeaders(),
        }
      );

      await readJsonResponse(response);
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
      setNotifications(previous);
      setNotifError(true);
    }
  };

  // Mark all notifications as read.
  const markAllAsRead = async () => {
    const previous = notifications;

    setNotifications((current) =>
      current.map((n) => ({ ...n, read: true }))
    );

    try {
      const response = await fetch(
        `${API_URL}/api/notifications/read-all`,
        {
          method: "PATCH",
          headers: getAuthHeaders(),
        }
      );

      await readJsonResponse(response);
    } catch (error) {
      console.error("Failed to mark all notifications as read:", error);
      setNotifications(previous);
      setNotifError(true);
    }
  };

  // Open the reassignment selector and load eligible collector candidates.
  const beginReassignment = async (notification) => {
    setReassignError("");
    setSelectedCollectorId("");
    setCollectorOptions([]);
    setReassignOpenId(notification._id);

    try {
      const response = await fetch(`${API_URL}/api/collectors`, {
        headers: getAuthHeaders(),
      });

      const result = await readJsonResponse(response);

      if (!result.success || !Array.isArray(result.data)) {
        throw new Error("Unable to read collector information.");
      }

      const currentCollectorId = notification.meta?.collectorId;
      const binId = notification.meta?.binId;

      const eligibleCandidates = result.data.filter((collector) => {
        const collectorId = String(collector._id || collector.id);
        const assignedBins = Array.isArray(collector.assignedBins)
          ? collector.assignedBins
          : [];

        return (
          collector.isActive === true &&
          collectorId !== String(currentCollectorId) &&
          !assignedBins.includes(binId) &&
          assignedBins.length < 2
        );
      });

      setCollectorOptions(eligibleCandidates);

      if (eligibleCandidates.length === 0) {
        setReassignError(
          "No active replacement collectors with available capacity were found."
        );
      }
    } catch (error) {
      console.error("Failed to load collectors:", error);
      setReassignError(
        error.message || "Unable to load collectors."
      );
    }
  };

  // Submit reassignment to the protected backend endpoint.
  const submitReassignment = async (notification) => {
    if (!selectedCollectorId || reassignBusyRef.current) return;

    reassignBusyRef.current = true;
    setReassignBusy(true);
    setReassignError("");

    try {
      const response = await fetch(
        `${API_URL}/api/notifications/${notification._id}/reassign`,
        {
          method: "PATCH",
          headers: getAuthHeaders(),
          body: JSON.stringify({
            collectorId: selectedCollectorId,
          }),
        }
      );

      const result = await readJsonResponse(response);

      if (!result.success) {
        throw new Error(result.message || "Reassignment failed.");
      }

      setReassignOpenId(null);
      setSelectedCollectorId("");
      setCollectorOptions([]);

      // Reload server state so the resolved notification is displayed.
      await fetchNotifications();
    } catch (error) {
      console.error("Collector reassignment failed:", error);
      setReassignError(
        error.message || "Unable to reassign this collection."
      );
    } finally {
      reassignBusyRef.current = false;
      setReassignBusy(false);
    }
  };

  const cancelReassignment = () => {
    if (reassignBusyRef.current) return;

    setReassignOpenId(null);
    setSelectedCollectorId("");
    setCollectorOptions([]);
    setReassignError("");
  };

  // Close dropdowns when clicking outside or pressing Escape.
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        profileRef.current &&
        !profileRef.current.contains(event.target)
      ) {
        setOpenProfile(false);
      }

      if (
        notifRef.current &&
        !notifRef.current.contains(event.target)
      ) {
        setOpenNotif(false);
        cancelReassignment();
      }
    };

    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpenProfile(false);
        setOpenNotif(false);
        cancelReassignment();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("role");
    sessionStorage.removeItem("user");
    navigate("/");
  };

  return (
    <header className="w-full bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-full px-4 py-4 flex justify-between items-center">
        {/* Logo (left) */}
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-green-500 rounded-lg flex items-center justify-center">
            <Recycle className="text-white" size={20} />
          </div>

          <Link
            to="/landing"
            className="text-lg font-semibold text-gray-800"
          >
            <span className="text-xl font-bold text-gray-900">
              Smart<span className="text-green-500">Bin</span>
            </span>
          </Link>
        </div>

        {/* Bell + Profile (right) */}
        <div className="flex items-center gap-3">
          {/* Notifications */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => {
                setOpenNotif((value) => !value);
                setOpenProfile(false);
              }}
              aria-label="Notifications"
              aria-expanded={openNotif}
              className="relative w-10 h-10 flex items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 cursor-pointer transition-colors"
            >
              <Bell size={20} />

              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {openNotif && (
              <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <span className="font-semibold text-gray-800">
                    Notifications
                  </span>

                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={markAllAsRead}
                      className="flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-700 cursor-pointer"
                    >
                      <CheckCheck size={14} />
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {notifLoading ? (
                    <p className="px-4 py-8 text-center text-sm text-gray-500">
                      Loading...
                    </p>
                  ) : notifError && notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-red-500">
                        Couldn't load notifications.
                      </p>
                      <button
                        type="button"
                        onClick={() => fetchNotifications()}
                        className="mt-2 text-xs text-green-600 hover:text-green-700"
                      >
                        Try again
                      </button>
                    </div>
                  ) : notifications.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-gray-500">
                      You're all caught up. New alerts will show up here.
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n._id}
                        className={`border-b border-gray-50 last:border-0 ${
                          n.read ? "bg-white" : "bg-green-50"
                        }`}
                      >
                        {/* Notification body */}
                        <button
                          type="button"
                          onClick={() => {
                            if (!n.read) markAsRead(n._id);
                          }}
                          className={`w-full text-left px-4 py-3 cursor-pointer transition-colors ${
                            n.read
                              ? "hover:bg-gray-50"
                              : "hover:bg-green-100"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 shrink-0">
                              {TYPE_ICON[n.type] || (
                                <Bell
                                  size={16}
                                  className="text-gray-400"
                                />
                              )}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-medium text-gray-800">
                                  {n.title}
                                </p>

                                {!n.read && (
                                  <span className="mt-1.5 w-2 h-2 rounded-full bg-green-500 shrink-0" />
                                )}
                              </div>

                              <p className="text-sm text-gray-600">
                                {n.message}
                              </p>

                              {n.type === "household_flagged" &&
                                n.meta?.householdId && (
                                  <p className="text-xs text-gray-500 mt-0.5">
                                    Household ID: {n.meta.householdId}
                                  </p>
                                )}

                              {n.type === "missed_collection" && (
                                <div className="mt-1 text-xs text-gray-500">
                                  <p>
                                    Bin: {n.meta?.binId || "Unknown"}
                                  </p>

                                  <p>
                                    Assigned collector:{" "}
                                    {n.meta?.collectorName || "Unknown"}
                                  </p>

                                  {n.actionTaken === "reassigned" && (
                                    <p className="mt-1 font-medium text-green-700">
                                      Reassigned successfully
                                    </p>
                                  )}
                                </div>
                              )}

                              <p className="text-xs text-gray-400 mt-1">
                                {timeAgo(n.createdAt)}
                              </p>
                            </div>
                          </div>
                        </button>

                        {/* Reassignment controls */}
                        {n.type === "missed_collection" &&
                          n.actionTaken !== "reassigned" && (
                            <div className="px-4 pb-3">
                              {reassignOpenId !== n._id ? (
                                <button
                                  type="button"
                                  onClick={() => beginReassignment(n)}
                                  className="inline-flex items-center gap-1 rounded-md bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700"
                                >
                                  <UserPlus size={14} />
                                  Reassign collector
                                </button>
                              ) : (
                                <div className="space-y-2">
                                  <label
                                    htmlFor={`collector-${n._id}`}
                                    className="block text-xs font-medium text-gray-700"
                                  >
                                    Select replacement collector
                                  </label>

                                  <select
                                    id={`collector-${n._id}`}
                                    value={selectedCollectorId}
                                    onChange={(event) =>
                                      setSelectedCollectorId(
                                        event.target.value
                                      )
                                    }
                                    disabled={reassignBusy}
                                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:opacity-50"
                                  >
                                    <option value="">
                                      Choose a collector
                                    </option>

                                    {collectorOptions.map((collector) => {
                                      const collectorId =
                                        collector._id || collector.id;

                                      return (
                                        <option
                                          key={collectorId}
                                          value={collectorId}
                                        >
                                          {collector.name} (
                                          {collector.assignedBins?.length || 0}
                                          /2 bins)
                                        </option>
                                      );
                                    })}
                                  </select>

                                  {reassignError && (
                                    <p
                                      role="alert"
                                      className="text-xs text-red-600"
                                    >
                                      {reassignError}
                                    </p>
                                  )}

                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      disabled={
                                        !selectedCollectorId ||
                                        reassignBusy
                                      }
                                      onClick={() =>
                                        submitReassignment(n)
                                      }
                                      className="rounded-md bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                    >
                                      {reassignBusy
                                        ? "Reassigning..."
                                        : "Confirm"}
                                    </button>

                                    <button
                                      type="button"
                                      disabled={reassignBusy}
                                      onClick={cancelReassignment}
                                      className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile */}
          <div className="relative" ref={profileRef}>
            <button
              type="button"
              onClick={() => {
                setOpenProfile((value) => !value);
                setOpenNotif(false);
              }}
              aria-label="Profile menu"
              aria-expanded={openProfile}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-green-100 text-black hover:bg-green-200 cursor-pointer transition-colors"
            >
              <User size={20} />
            </button>

            {openProfile && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-xs text-gray-500">
                    Signed in as
                  </p>

                  <p
                    className="text-sm font-semibold text-gray-800 truncate"
                    title={email}
                  >
                    {email}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setOpenProfile(false);
                    setOpenConModal(true);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm font-medium text-red-500 hover:bg-red-50 cursor-pointer transition-colors"
                >
                  <LogOut size={16} />
                  Logout
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={openConModal}
        onClose={() => setOpenConModal(false)}
        onConfirm={handleLogout}
      />
    </header>
  );
}

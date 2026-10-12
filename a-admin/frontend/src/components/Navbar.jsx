import { Recycle, LogOut, Bell, Trash2, AlertTriangle, UserPlus, User, CheckCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ConfirmationModal from "./confirmationModal";

// TODO: point this at your real API base (or use your existing api/axios helper)
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const POLL_MS = 30000;

const TYPE_ICON = {
  bin_critical: <Trash2 size={16} className="text-red-500" />,
  household_flagged: <AlertTriangle size={16} className="text-orange-500" />,
  registration_request: <UserPlus size={16} className="text-blue-500" />,
};

const timeAgo = (date) => {
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (Number.isNaN(s)) return "";
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export default function Navbar() {
  const [openConModal, setOpenConModal] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [openNotif, setOpenNotif] = useState(false);

  // Expected shape: { _id, title, message, createdAt, read }
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);
  const [notifError, setNotifError] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const navigate = useNavigate();
  const profileRef = useRef(null);
  const notifRef = useRef(null);

  let user = null;
  try {
    user = JSON.parse(sessionStorage.getItem("user"));
  } catch {
    user = null;
  }
  const email = user?.email || "No email on file";

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${sessionStorage.getItem("token")}`,
  });

  const fetchNotifications = useCallback(async (signal) => {
    try {
      const res = await fetch(`${API_URL}/api/notifications`, {
        headers: authHeaders(),
        signal,
      });
      if (!res.ok) throw new Error("Failed to load notifications");
      const data = await res.json();
      // supports either [..] or { notifications: [..] }
      setNotifications(Array.isArray(data) ? data : data.notifications || []);
      setNotifError(false);
    } catch (err) {
      if (err.name !== "AbortError") setNotifError(true);
    } finally {
      setNotifLoading(false);
    }
  }, []);

  // Initial load + polling (paused while the tab is hidden)
  useEffect(() => {
    const controller = new AbortController();
    fetchNotifications(controller.signal);

    const interval = setInterval(() => {
      if (!document.hidden) fetchNotifications(controller.signal);
    }, POLL_MS);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchNotifications]);

  const markAsRead = async (id) => {
    // optimistic update
    setNotifications((prev) =>
      prev.map((n) => (n._id === id ? { ...n, read: true } : n))
    );
    try {
      await fetch(`${API_URL}/api/notifications/${id}/read`, {
        method: "PATCH",
        headers: authHeaders(),
      });
    } catch {
      fetchNotifications();
    }
  };

  const markAllAsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch(`${API_URL}/api/notifications/read-all`, {
        method: "PATCH",
        headers: authHeaders(),
      });
    } catch {
      fetchNotifications();
    }
  };

  // Close dropdowns when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setOpenProfile(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setOpenNotif(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        setOpenProfile(false);
        setOpenNotif(false);
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
          <Link to="/landing" className="text-lg font-semibold text-gray-800">
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
              onClick={() => {
                setOpenNotif((v) => !v);
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
                  <span className="font-semibold text-gray-800">Notifications</span>
                  {unreadCount > 0 && (
                    <button
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
                    <p className="px-4 py-8 text-center text-sm text-red-500">
                      Couldn't load notifications.
                    </p>
                  ) : notifications.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-gray-500">
                      You're all caught up. New alerts will show up here.
                    </p>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n._id}
                        onClick={() => !n.read && markAsRead(n._id)}
                        className={`w-full text-left px-4 py-3 border-b border-gray-50 last:border-0 cursor-pointer transition-colors ${n.read
                            ? "bg-white hover:bg-gray-50"
                            : "bg-green-50 hover:bg-green-100"
                          }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 shrink-0">
                            {TYPE_ICON[n.type] || <Bell size={16} className="text-gray-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800">{n.title}</p>
                              {!n.read && (
                                <span className="mt-1.5 w-2 h-2 rounded-full bg-green-500 shrink-0" />
                              )}
                            </div>
                            <p className="text-sm text-gray-600">{n.message}</p>
                            {n.type === "household_flagged" && n.meta?.householdId && (
                              <p className="text-xs text-gray-500 mt-0.5">
                                Household ID: {n.meta.householdId}
                              </p>
                            )}
                            <p className="text-xs text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile */}
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => {
                setOpenProfile((v) => !v);
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
                  <p className="text-xs text-gray-500">Signed in as</p>
                  <p
                    className="text-sm font-semibold text-gray-800 truncate"
                    title={email}
                  >
                    {email}
                  </p>
                </div>
                <button
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
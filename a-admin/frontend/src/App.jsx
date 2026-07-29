import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import Landing from './pages/landing'
import ScrollToTop from "./assets/toScrollTop";
import HouseholdProfile from "./pages/a-user/profile";
import Rewards from "./pages/a-user/reward";
import Leaderboard from "./pages/a-user/leaderboard";
import ComplianceDashboard from "./pages/a-admin/dashboard";
import BinMonitoring from "./pages/a-admin/binMonitoring";
import HouseholdInfo from "./pages/a-admin/householdInfo";
import AuthPage from "./pages/authPage";
import Gamified from "./pages/a-admin/gamified";
import QRhandler from "./pages/a-user/QRhandler";
import WasteBin from "./pages/a-admin/wastebin";
import HomePage from "./pages/a-user/home";
import AdminDashboard from "./pages/admin";

// ── Token expiry check ────────────────────────────────────────────────────────
function isTokenExpired(token) {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return payload.exp * 1000 < Date.now();
    } catch {
        return true;
    }
}

// ── Protected Route ───────────────────────────────────────────────────────────
function ProtectedRoute({ children, allowedRoles }) {
    const token = sessionStorage.getItem("token");
    const role  = sessionStorage.getItem("role");

    if (!token || !role) {
        return <Navigate to="/" replace />;
    }

    if (isTokenExpired(token)) {
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("role");
        sessionStorage.removeItem("user");
        return <Navigate to="/" replace />;
    }

    if (allowedRoles && !allowedRoles.includes(role)) {
        return <Navigate to="/" replace />;
    }

    return children;
}

function App() {
  return (
    <Router>
      <ScrollToTop />
      <Routes>

        {/* ── Public ──────────────────────────────────────────────────────── */}
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/" element={<AuthPage />} />
        <Route path="/landing" element={<Landing />} />

        {/* ── User (household) routes ──────────────────────────────────────── */}
        <Route path="/home" element={
          <ProtectedRoute allowedRoles={["household"]}>
            <HomePage />
          </ProtectedRoute>
        } />

        <Route path="/qrcode" element={
          <ProtectedRoute allowedRoles={["household"]}>
            <QRhandler />
          </ProtectedRoute>
        } />

        <Route path="/home-page" element={
          <ProtectedRoute allowedRoles={["household"]}>
            <HouseholdProfile />
          </ProtectedRoute>
        } />

        <Route path="/rewards" element={
          <ProtectedRoute allowedRoles={["household"]}>
            <Rewards />
          </ProtectedRoute>
        } />

        <Route path="/leaderboard" element={
          <ProtectedRoute allowedRoles={["household"]}>
            <Leaderboard />
          </ProtectedRoute>
        } />

        {/* ── Admin routes ─────────────────────────────────────────────────── */}
        <Route path="/admin" element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <AdminDashboard />
          </ProtectedRoute>
        } />

        <Route path="/dashboard" element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <ComplianceDashboard />
          </ProtectedRoute>
        } />

        <Route path="/wastebin" element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <WasteBin />
          </ProtectedRoute>
        } />

        <Route path="/binMonitoring" element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <BinMonitoring />
          </ProtectedRoute>
        } />

        <Route path="/householdInfo" element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <HouseholdInfo />
          </ProtectedRoute>
        } />

        <Route path="/gamified" element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <Gamified />
          </ProtectedRoute>
        } />

        {/* ── Collector routes ─────────────────────────────────────────────── */}
        <Route path="/collector" element={
          <ProtectedRoute allowedRoles={["collector"]}>
            <AdminDashboard />
          </ProtectedRoute>
        } />

        {/* ── Catch all ────────────────────────────────────────────────────── */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </Router>
  );
}

export default App;
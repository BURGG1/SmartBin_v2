import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Menu, X, Trash2, ArrowLeft } from "lucide-react";

// Change this to your actual dashboard route.
const DASHBOARD_PATH = "/dashboard";

// Same keys the Navbar uses (set at login, cleared on logout).
const isLoggedIn = () => {
  const token = sessionStorage.getItem("token");
  if (!token) return false;

  // Treat an expired JWT as logged out.
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) return false;
  } catch {
    // Not a decodable JWT; fall back to "token exists".
  }

  return true;
};

export default function Header({ onAboutClick, onMaintenanceClick }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const loggedIn = isLoggedIn();

  const navLinks = [
    { label: "Home", onClick: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
    { label: "About", onClick: onAboutClick },
    { label: "Maintenance", onClick: onMaintenanceClick },
  ];

  const handleNavClick = (onClick) => {
    onClick?.();
    setMenuOpen(false);
  };

  const goToDashboard = () => {
    setMenuOpen(false);
    navigate(DASHBOARD_PATH);
  };

  const goToSignIn = () => {
    setMenuOpen(false);
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm shadow-sm">
      <div className="mx-auto flex max-w-full items-center justify-between px-6 py-4 lg:px-12">
        {/* Left section: Logo */}
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-500 text-white">
            <Trash2 className="h-5 w-5" />
          </div>
          <span className="text-xl font-bold text-gray-900">
            Smart<span className="text-green-500">Bin</span>
          </span>
        </div>

        {/* Right section: Navigation */}
        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <button
              key={link.label}
              onClick={() => handleNavClick(link.onClick)}
              className="text-sm font-medium text-gray-700 transition-colors hover:text-green-500"
            >
              {link.label}
            </button>
          ))}

          {loggedIn ? (
            <button
              onClick={goToDashboard}
              className="inline-flex items-center gap-2 rounded-full bg-green-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
          ) : (
            <button
              onClick={goToSignIn}
              className="rounded-full bg-green-500 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-600"
            >
              Sign In
            </button>
          )}
        </nav>

        {/* Mobile menu toggle */}
        <button
          className="flex items-center justify-center md:hidden"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            <X className="h-6 w-6 text-gray-700" />
          ) : (
            <Menu className="h-6 w-6 text-gray-700" />
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="flex flex-col gap-1 border-t border-gray-100 bg-white px-6 py-4 md:hidden">
          {navLinks.map((link) => (
            <button
              key={link.label}
              onClick={() => handleNavClick(link.onClick)}
              className="rounded-md px-2 py-2 text-left text-sm font-medium text-gray-700 hover:bg-green-50 hover:text-green-500"
            >
              {link.label}
            </button>
          ))}

          {loggedIn ? (
            <button
              onClick={goToDashboard}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-green-500 px-5 py-2 text-sm font-semibold text-white hover:bg-green-600"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Dashboard
            </button>
          ) : (
            <button
              onClick={goToSignIn}
              className="mt-2 rounded-full bg-green-500 px-5 py-2 text-sm font-semibold text-white hover:bg-green-600"
            >
              Sign In
            </button>
          )}
        </div>
      )}
    </header>
  );
}
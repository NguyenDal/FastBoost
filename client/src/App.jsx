import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OrderPage from "./pages/OrderPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import MatchPage from "./pages/MatchPage";
import AdminOrdersPage from "./pages/AdminOrdersPage";
import AdminOrderDetailsPage from "./pages/AdminOrderDetailsPage";
import ProviderOrdersPage from "./pages/ProviderOrdersPage";
import CustomerOrdersPage from "./pages/CustomerOrdersPage";
import ProviderOrderDetailsPage from "./pages/ProviderOrderDetailsPage";
import LoyaltyPage from "./pages/LoyaltyPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";
import AdminManagementPage from "./pages/AdminManagementPage";
import AdminAccountsPage from "./pages/AdminAccountsPage";
import DashboardPage from "./pages/DashboardPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import DashboardLayout from "./layouts/DashboardLayout";
import PaymentResultPage from "./pages/PaymentResultPage";
import ContactPage from "./pages/ContactPage";
import PriceManagementPage from "./pages/PriceManagementPage";
import AdminLayout from "./layouts/AdminLayout";
import DynamicTitle from "./components/DynamicTitle";

import {
  clearExpiredSession,
  getStoredUser,
  hasValidSession,
  isTokenExpired,
} from "./utils/authSession";

function ProtectedRoute({ children, allowedRoles }) {
  const location = useLocation();

  const isValid = hasValidSession();
  const user = getStoredUser();

  if (!isValid) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }

  if (allowedRoles?.length && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function App() {
  const navigate = useNavigate();
  const [sessionExpiredOpen, setSessionExpiredOpen] = useState(false);

  useEffect(() => {
    const checkSession = () => {
      const token = localStorage.getItem("token");

      if (!token) return;

      if (isTokenExpired(token)) {
        clearExpiredSession({
          showExpiredModal: true,
        });

        setSessionExpiredOpen(true);
      }
    };

    const handleSessionExpired = () => {
      setSessionExpiredOpen(true);
    };

    checkSession();

    window.addEventListener("focus", checkSession);
    window.addEventListener("session:expired", handleSessionExpired);
    document.addEventListener("visibilitychange", checkSession);

    return () => {
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("session:expired", handleSessionExpired);
      document.removeEventListener("visibilitychange", checkSession);
    };
  }, []);

  return (
    <>
      <DynamicTitle />
      
      <Routes>
        <Route path="/r/:referralCode" element={<HomePage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/order/:serviceId" element={<OrderPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/contact" element={<ContactPage />} />

        <Route
          path="/payment/success/:serviceId"
          element={
            <ProtectedRoute>
              <PaymentResultPage type="success" />
            </ProtectedRoute>
          }
        />

        <Route
          path="/payment/cancelled/:serviceId"
          element={
            <ProtectedRoute>
              <PaymentResultPage type="cancelled" />
            </ProtectedRoute>
          }
        />

        <Route
          path="/match/:orderId"
          element={
            <ProtectedRoute>
              <MatchPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin/management"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <AdminManagementPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={["ADMIN"]}>
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="orders" element={<AdminOrdersPage />} />
          <Route path="orders/:id" element={<AdminOrderDetailsPage />} />
          <Route path="accounts" element={<AdminAccountsPage />} />
          <Route path="prices" element={<PriceManagementPage />} />
        </Route>

        <Route
          path="/provider/orders"
          element={
            <ProtectedRoute allowedRoles={["PROVIDER", "ADMIN"]}>
              <ProviderOrdersPage />
            </ProtectedRoute>
          }
        />

        <Route
          element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/account/dashboard" element={<DashboardPage />} />
          <Route path="/account/orders" element={<CustomerOrdersPage />} />
          <Route path="/account/change-password" element={<ChangePasswordPage />} />
        </Route>

        <Route
          path="/provider/orders/:id"
          element={
            <ProtectedRoute allowedRoles={["PROVIDER", "ADMIN"]}>
              <ProviderOrderDetailsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/account/loyalty"
          element={
            <ProtectedRoute>
              <LoyaltyPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/account/settings"
          element={
            <ProtectedRoute>
              <AccountSettingsPage />
            </ProtectedRoute>
          }
        />
      </Routes>

      {sessionExpiredOpen && (
        <SessionExpiredModal
          onLoginAgain={() => {
            setSessionExpiredOpen(false);

            navigate("/", {
              replace: false,
              state: {
                openAuthModal: true,
                authMode: "login",
                reason: "session-expired",
              },
            });
          }}
          onClose={() => {
            setSessionExpiredOpen(false);
            navigate("/", {
              replace: true,
            });
          }}
        />
      )}
    </>
  );
}

function SessionExpiredModal({ onLoginAgain, onClose }) {
  return (
    <div className="session-expired-backdrop" role="dialog" aria-modal="true">
      <div className="session-expired-modal">
        <div className="session-expired-icon" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M7 11V8a5 5 0 0 1 10 0v3"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <path
              d="M6 11h12v9H6v-9Z"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinejoin="round"
            />
            <path
              d="M12 14.5v2"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </svg>
        </div>

        <p className="session-expired-eyebrow">Session Expired</p>

        <h2>Please login again</h2>

        <p className="session-expired-text">
          Your login session has expired.
        </p>

        <div className="session-expired-actions">
          <button
            type="button"
            className="session-expired-secondary"
            onClick={onClose}
          >
            Continue Browsing
          </button>

          <button
            type="button"
            className="session-expired-primary"
            onClick={onLoginAgain}
          >
            Login Again
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OrderPage from "./pages/OrderPage";
import ServiceDetailsPage from "./pages/ServiceDetailsPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import MatchPage from "./pages/MatchPage";
import AdminOrdersPage from "./pages/AdminOrdersPage";
import AdminOrderDetailsPage from "./pages/AdminOrderDetailsPage";
import ProviderOrdersPage from "./pages/ProviderOrdersPage";
import CustomerOrdersPage from "./pages/CustomerOrdersPage";
import ProviderOrderDetailsPage from "./pages/ProviderOrderDetailsPage";
import LoyaltyPage from "./pages/LoyaltyPage";
import AccountSettingsPage from "./pages/AccountSettingsPage";

import { clearExpiredSession, getStoredUser, hasValidSession } from "./utils/authSession";

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
  useEffect(() => {
    const checkSession = () => {
      const token = localStorage.getItem("token");

      if (token && !hasValidSession()) {
        clearExpiredSession();
      }
    };

    checkSession();

    window.addEventListener("focus", checkSession);
    document.addEventListener("visibilitychange", checkSession);

    return () => {
      window.removeEventListener("focus", checkSession);
      document.removeEventListener("visibilitychange", checkSession);
    };
  }, []);

  return (
    <Routes>
      <Route path="/r/:referralCode" element={<HomePage />} />
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/order/:serviceId"
        element={
          <ProtectedRoute>
            <OrderPage />
          </ProtectedRoute>
        }
      />

      <Route path="/services/:serviceId" element={<ServiceDetailsPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/match/:orderId"
        element={
          <ProtectedRoute>
            <MatchPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/orders"
        element={
          <ProtectedRoute allowedRoles={["ADMIN"]}>
            <AdminOrdersPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/admin/orders/:id"
        element={
          <ProtectedRoute allowedRoles={["ADMIN"]}>
            <AdminOrderDetailsPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/provider/orders"
        element={
          <ProtectedRoute allowedRoles={["PROVIDER", "ADMIN"]}>
            <ProviderOrdersPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/account/orders"
        element={
          <ProtectedRoute>
            <CustomerOrdersPage />
          </ProtectedRoute>
        }
      />

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
    
  );
}

export default App;
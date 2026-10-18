import { authStorage } from "./utils/authStorage";
import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import HomePage from "./pages/HomePage";
import DynamicTitle from "./components/DynamicTitle";
import SaleFooter from "./components/SaleFooter";
import SessionActivity from "./components/SessionActivity";
import PageLoadBoundary from './components/PageLoadBoundary';
// Public browsing does not need checkout, account or administration code.
// React only requests each module when its authorized route is rendered.
const LegalDocumentPage = lazy(() => import('./pages/LegalDocumentPage'));
const ProviderAgreementPage = lazy(() => import('./pages/ProviderAgreementPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const OrderPage = lazy(() => import('./pages/OrderPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const MatchPage = lazy(() => import('./pages/MatchPage'));
const AdminOrdersPage = lazy(() => import('./pages/AdminOrdersPage'));
const AdminOrderDetailsPage = lazy(() => import('./pages/AdminOrderDetailsPage'));
const ProviderOrdersPage = lazy(() => import('./pages/ProviderOrdersPage'));
const CustomerOrdersPage = lazy(() => import('./pages/CustomerOrdersPage'));
const ProviderOrderDetailsPage = lazy(() => import('./pages/ProviderOrderDetailsPage'));
const LoyaltyPage = lazy(() => import('./pages/LoyaltyPage'));
const AccountSettingsPage = lazy(() => import('./pages/AccountSettingsPage'));
const AdminManagementPage = lazy(() => import('./pages/AdminManagementPage'));
const AdminAccountsPage = lazy(() => import('./pages/AdminAccountsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const FaqPage = lazy(() => import('./pages/FaqPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const DashboardLayout = lazy(() => import('./layouts/DashboardLayout'));
const PaymentResultPage = lazy(() => import('./pages/PaymentResultPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const PriceManagementPage = lazy(() => import('./pages/PriceManagementPage'));
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const AdminSupportPage = lazy(() => import('./pages/AdminSupportPage'));
const BoosterManagementPage = lazy(() => import('./pages/OperationsPages').then(module => ({ default: module.BoosterManagementPage })));
const BoosterContractPage = lazy(() => import('./pages/OperationsPages').then(module => ({ default: module.BoosterContractPage })));
const ContractSigningReturnPage = lazy(() => import('./pages/OperationsPages').then(module => ({ default: module.ContractSigningReturnPage })));
const EarningsPage = lazy(() => import('./pages/EarningsPage'));
const BoosterPortalPage = lazy(() => import('./pages/BoosterPortalPage'));
const ActivityLogsPage = lazy(() => import('./pages/ActivityLogsPage'));
const SupportChat = lazy(() => import('./components/SupportChat'));

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
    return <Navigate to="/" replace state={{ from: location.pathname + location.search + location.hash, openAuthModal: true, authMode: 'login' }} />;
  }

  if (allowedRoles?.length && !allowedRoles.includes(user?.role) && !(allowedRoles.includes("PROVIDER") && user?.hasBoosterAccess)) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sessionExpiredOpen, setSessionExpiredOpen] = useState(false);

  useEffect(() => {
    const checkSession = () => {
      const token = authStorage.getItem("token");

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

      <PageLoadBoundary key={location.pathname}>
      <Suspense fallback={<div role="status" style={{ padding: '4rem 1.5rem', textAlign: 'center' }}>Loading page…</div>}>
      <Routes>
        <Route path="/checkout/:orderId" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
        <Route path="/r/:referralCode" element={<HomePage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<Navigate to="/" replace state={{ openAuthModal: true, authMode: "register" }} />} />
        <Route path="/support" element={<HomePage />} />
        <Route path="/provider/portal" element={<ProtectedRoute allowedRoles={['PROVIDER', 'ADMIN']}><BoosterPortalPage section="overview" /></ProtectedRoute>} />
        <Route path="/provider/earnings" element={<ProtectedRoute allowedRoles={['PROVIDER', 'ADMIN']}><BoosterPortalPage section="earnings" /></ProtectedRoute>} />
        <Route path="/provider/documents" element={<ProtectedRoute allowedRoles={['PROVIDER', 'ADMIN']}><BoosterPortalPage section="documents" /></ProtectedRoute>} />
        <Route path="/provider/profile" element={<ProtectedRoute allowedRoles={['PROVIDER', 'ADMIN']}><BoosterPortalPage section="profile" /></ProtectedRoute>} />
        <Route path="/provider/workspace" element={<ProtectedRoute allowedRoles={['PROVIDER', 'ADMIN']}><Navigate to="/provider/portal" replace /></ProtectedRoute>} />
        <Route path="/provider/contracts/:id" element={<ProtectedRoute allowedRoles={['PROVIDER', 'ADMIN']}><BoosterContractPage /></ProtectedRoute>} />
        <Route path="/provider/contracts/:id/signing-return" element={<ContractSigningReturnPage />} />
        <Route path="/terms-and-conditions" element={<LegalDocumentPage />} />
        <Route path="/privacy-policy" element={<LegalDocumentPage privacy />} />
        <Route path="/provider-agreement" element={<ProtectedRoute allowedRoles={['PROVIDER', 'ADMIN']}><ProviderAgreementPage /></ProtectedRoute>} />
        <Route path="/order/:serviceId" element={<OrderPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/account/faq" element={<Navigate to="/faq" replace />} />

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
          <Route path="earnings" element={<EarningsPage />} />
          <Route path="activity-logs" element={<ActivityLogsPage />} />
          <Route path="boosters" element={<BoosterManagementPage />} />
          <Route path="prices" element={<PriceManagementPage />} />
          <Route path="support" element={<AdminSupportPage />} />
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
      </Suspense>
      </PageLoadBoundary>
      <SaleFooter />
      <PageLoadBoundary compact><Suspense fallback={null}><SupportChat /></Suspense></PageLoadBoundary>
      <SessionActivity />

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

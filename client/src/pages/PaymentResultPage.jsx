import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import OrderPage from "./OrderPage";
import {
  verifyCheckoutSession,
  deleteUnpaidCheckoutOrder,
} from "../api/orders";
import "../styles/PaymentResultPage.css";

function PaymentResultPage({ type, overlayOnly = false, verification, onVerified, onComplete }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [closing, setClosing] = useState(false);

  const [state, setState] = useState({
    loading: type === "success",
    error: "",
    orderId: "",
    paid: false,
  });

  const params = useMemo(() => {
    if (verification) return new URLSearchParams(verification);
    return new URLSearchParams(location.search);
  }, [location.search, verification]);

  useEffect(() => {
    if (type !== "cancelled") return;

    const orderId = params.get("orderId");
    if (!orderId) return;

    let cancelled = false;

    async function cleanupCancelledCheckout() {
      try {
        await deleteUnpaidCheckoutOrder(orderId);

        if (cancelled) return;

        console.log("Cancelled unpaid checkout order cleaned:", orderId);
      } catch (error) {
        console.error("Failed to clean cancelled checkout order:", error);
      }
    }

    cleanupCancelledCheckout();

    return () => {
      cancelled = true;
    };
  }, [type, params]);

  useEffect(() => {
    let cancelled = false;

    async function verifyPayment() {
      if (type !== "success") {
        setState({
          loading: false,
          error: "",
          orderId: params.get("orderId") || "",
          paid: false,
        });
        return;
      }

      const sessionId = params.get("session_id");
      const orderId = params.get("orderId");

      if (!sessionId && !orderId) {
        setState({
          loading: false,
          error: "Missing payment verification details.",
          orderId: "",
          paid: false,
        });
        return;
      }

      try {
        let lastData = null;

        for (let attempt = 1; attempt <= 8; attempt += 1) {
          const data = await verifyCheckoutSession({ sessionId, orderId });
          lastData = data;

          if (cancelled) return;

          if (data.paid) {
            onVerified?.();
            setState({
              loading: false,
              error: "",
              orderId: data.orderId,
              paid: true,
            });
            return;
          }

          await new Promise((resolve) => window.setTimeout(resolve, 1200));
        }

        setState({
          loading: false,
          error:
            "The payment was not confirmed. Review your order and try again.",
          orderId: lastData?.orderId || "",
          paid: false,
        });
      } catch {
        if (cancelled) return;

        setState({
          loading: false,
          error: "We couldn’t confirm your payment yet. Check your order status before trying another payment, or contact support.",
          orderId: "",
          paid: false,
        });
      }
    }

    verifyPayment();

    return () => {
      cancelled = true;
    };
  }, [type, params, onVerified]);

  useEffect(() => {
    if (type !== "success") return;
    if (state.loading || state.error || !state.paid || !state.orderId) return;

    const fadeTimer = window.setTimeout(() => setClosing(true), 1550);
    const timer = window.setTimeout(() => {
      if (onComplete) onComplete();
      else navigate(`/checkout/${state.orderId}`, { replace: true });
    }, 1800);

    return () => { window.clearTimeout(fadeTimer); window.clearTimeout(timer); };
  }, [type, state.loading, state.error, state.paid, state.orderId, navigate, onComplete]);

  const isSuccess = type === "success";
  const isGoldPayment = params.get("gold") === "1";
  const confirmedSuccess = isSuccess && state.paid && !state.error;
  const showNeedsReview = isSuccess && !state.loading && !state.paid;

  function handleContinueOrder() {
    navigate(`/order/${getServiceIdFromPath(location.pathname)}`, {
      replace: true,
    });
  }

  return (
    <>
      {!overlayOnly && <OrderPage />}

      <div className={`payment-result-floating-layer${closing ? " payment-result-closing" : ""}`}>
        <div
          className={`payment-result-modal ${confirmedSuccess
            ? "payment-result-success"
            : isSuccess
              ? "payment-result-review"
              : "payment-result-cancelled"
            }`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-result-title"
          aria-describedby="payment-result-description"
        >
          <div className="payment-result-orb" aria-hidden>
            {state.loading ? (
              <span className="payment-result-spinner" />
            ) : confirmedSuccess ? (
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5l4.2 4.2L19 7"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 7l10 10M17 7L7 17"
                  stroke="currentColor"
                  strokeWidth="2.3"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </div>

          <p className="payment-result-eyebrow">
            {state.loading
              ? "Verifying Payment"
              : confirmedSuccess
                ? "Payment Successful"
                : showNeedsReview
                  ? "Payment Needs Review"
                  : "Payment Cancelled"}
          </p>

          <h2 id="payment-result-title">
            {state.loading
              ? "Confirming your order..."
              : confirmedSuccess
                ? "Order confirmed"
                : showNeedsReview
                  ? "We could not confirm the payment yet"
                  : "Checkout was cancelled"}
          </h2>

          <p id="payment-result-description" className="payment-result-text" aria-live="polite">
            {state.loading
              ? isGoldPayment
                ? "Please wait while FastBoost confirms your gold payment."
                : "Please wait while FastBoost confirms your payment with Stripe."
              : confirmedSuccess
                ? isGoldPayment
                  ? "Your gold payment is complete. Your order is ready."
                  : "Your payment is complete. Your order is ready."
                : showNeedsReview
                  ? state.error ||
                  "The payment was not confirmed. Review your order and try again."
                  : "No payment was taken. You can adjust your order and try again."}
          </p>

          {!confirmedSuccess && !state.loading && (
            <div className="payment-result-actions">
              <button
                type="button"
                className="payment-result-primary"
                onClick={handleContinueOrder}
              >
                {isSuccess ? "Review Order & Try Again" : "Continue Editing Order"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function getServiceIdFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[2] || "";
}

export default PaymentResultPage;

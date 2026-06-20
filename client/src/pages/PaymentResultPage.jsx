import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import OrderPage from "./OrderPage";
import {
  verifyCheckoutSession,
  deleteUnpaidCheckoutOrder,
} from "../api/orders";
import "../styles/PaymentResultPage.css";

function PaymentResultPage({ type }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [state, setState] = useState({
    loading: type === "success",
    error: "",
    orderId: "",
    paid: false,
  });

  const params = useMemo(() => {
    return new URLSearchParams(location.search);
  }, [location.search]);

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
            "The payment was not marked as paid yet. Please check your orders.",
          orderId: lastData?.orderId || "",
          paid: false,
        });
      } catch (error) {
        if (cancelled) return;

        setState({
          loading: false,
          error: error.message || "Unable to verify payment.",
          orderId: "",
          paid: false,
        });
      }
    }

    verifyPayment();

    return () => {
      cancelled = true;
    };
  }, [type, params]);

  useEffect(() => {
    if (type !== "success") return;
    if (state.loading || state.error || !state.paid || !state.orderId) return;

    const timer = window.setTimeout(() => {
      navigate(`/match/${state.orderId}`, { replace: true });
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [type, state.loading, state.error, state.paid, state.orderId, navigate]);

  const isSuccess = type === "success";
  const confirmedSuccess = isSuccess && state.paid && !state.error;
  const showNeedsReview = isSuccess && !state.loading && !state.paid;

  function handleCancelledClose() {
    navigate(`/order/${getServiceIdFromPath(location.pathname)}`, {
      replace: true,
    });
  }

  function handleViewOrders() {
    navigate("/account/orders", { replace: true });
  }

  return (
    <>
      <OrderPage />

      <div className="payment-result-floating-layer">
        <div
          className={`payment-result-modal ${confirmedSuccess
            ? "payment-result-success"
            : isSuccess
              ? "payment-result-review"
              : "payment-result-cancelled"
            }`}
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

          <h2>
            {state.loading
              ? "Confirming your order..."
              : confirmedSuccess
                ? "Order confirmed"
                : showNeedsReview
                  ? "We could not confirm the payment yet"
                  : "Checkout was cancelled"}
          </h2>

          <p className="payment-result-text">
            {state.loading
              ? "Please wait while FastBoost confirms your payment with Stripe."
              : confirmedSuccess
                ? "Your order is ready. Transferring you to the Match Page..."
                : showNeedsReview
                  ? state.error ||
                  "The payment was not marked as paid yet. Please check your orders."
                  : "No payment was taken. You can adjust your order and try again."}
          </p>

          {!confirmedSuccess && !state.loading && (
            <div className="payment-result-actions">
              {isSuccess ? (
                <button
                  type="button"
                  className="payment-result-primary"
                  onClick={handleViewOrders}
                >
                  View My Orders
                </button>
              ) : (
                <button
                  type="button"
                  className="payment-result-primary"
                  onClick={handleCancelledClose}
                >
                  Continue Editing Order
                </button>
              )}
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
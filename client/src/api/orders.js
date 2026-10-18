import { authStorage } from "../utils/authStorage";
import { API_BASE_URL } from './config.js';

function authHeaders() {
    const token = authStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function paymentJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const incoming = options.signal;
  if (incoming?.aborted) throw incoming.reason || new DOMException("Request cancelled.", "AbortError");
  const cancel = () => controller.abort(incoming.reason);
  incoming?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Payment request timed out.", "TimeoutError")), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // Keep the deadline until the response body has arrived as well.
    const data = await response.json();
    return { response, data };
  } finally {
    clearTimeout(timer);
    incoming?.removeEventListener("abort", cancel);
  }
}

export async function getOrderRating(orderId) {
    const response = await fetch(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}/rating`, { headers: authHeaders() });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not load your review.');
    return result;
}

export async function submitOrderRating(orderId, stars) {
    const response = await fetch(`${API_BASE_URL}/orders/${encodeURIComponent(orderId)}/rating`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ stars }),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message || 'Could not submit your review.'), { status: response.status });
    return result;
}

export async function updateOrderLoginInfo(orderId, payload) {
    const res = await fetch(`${API_BASE_URL}/orders/${orderId}/login-info`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to update login info");
    }

    return data.order;
}

export async function createCheckoutSession(orderId, goldToUse = 0, deferGoldOnly = true, contactEmail, couponCode, { signal } = {}) {
  const { response: res, data } = await paymentJson(`${API_BASE_URL}/payments/create-checkout-session`, {
    method: "POST",
    headers: authHeaders(),
    signal,
    body: JSON.stringify({
      orderId,
      goldToUse,
      deferGoldOnly,
      contactEmail,
      couponCode,
    }),
  }, 20000);

  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.message || "Failed to create checkout session"), { code: data.code, status: res.status });
  }

  return data;
}

export async function verifyCheckoutSession({ sessionId, orderId, signal }) {
  const params = new URLSearchParams();

  if (sessionId) params.set("sessionId", sessionId);
  if (orderId) params.set("orderId", orderId);

  const { response: res, data } = await paymentJson(
    `${API_BASE_URL}/payments/verify-checkout-session?${params.toString()}`,
    {
      method: "GET",
      headers: authHeaders(),
      signal,
    }, 15000,
  );

  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.message || "Failed to verify payment"), { status: res.status });
  }

  return data;
}

export async function deleteUnpaidCheckoutOrder(orderId) {
  if (typeof orderId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(orderId)) {
    throw new Error("This checkout link is invalid. Open your order from your account.");
  }
  const res = await fetch(`${API_BASE_URL}/orders/unpaid-checkout/${orderId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  const data = await res.json();

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Failed to remove unpaid checkout order");
  }

  return data;
}

export async function checkServiceAvailability(serviceId) {
  const { response, data } = await paymentJson(`${API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, { cache: "no-store" }, 15000);
  if (!response.ok) throw new Error("Service availability could not be verified.");
  if (data.service?.active !== true) throw Object.assign(new Error(), { code: "SERVICE_UNAVAILABLE" });
}

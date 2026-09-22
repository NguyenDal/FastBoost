import { API_BASE_URL } from './config.js';

function authHeaders() {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
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

export async function createCheckoutSession(orderId, goldToUse = 0, deferGoldOnly = true, contactEmail, couponCode) {
  const res = await fetch(`${API_BASE_URL}/payments/create-checkout-session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      orderId,
      goldToUse,
      deferGoldOnly,
      contactEmail,
      couponCode,
    }),
  });

  const data = await res.json();

  if (!res.ok || data.ok === false) {
    throw Object.assign(new Error(data.message || "Failed to create checkout session"), { code: data.code });
  }

  return data;
}

export async function verifyCheckoutSession({ sessionId, orderId }) {
  const params = new URLSearchParams();

  if (sessionId) params.set("sessionId", sessionId);
  if (orderId) params.set("orderId", orderId);

  const res = await fetch(
    `${API_BASE_URL}/payments/verify-checkout-session?${params.toString()}`,
    {
      method: "GET",
      headers: authHeaders(),
    }
  );

  const data = await res.json();

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Failed to verify payment");
  }

  return data;
}

export async function deleteUnpaidCheckoutOrder(orderId) {
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
  const response = await fetch(`${API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Service availability could not be verified.");
  const data = await response.json();
  if (data.service?.active !== true) throw Object.assign(new Error(), { code: "SERVICE_UNAVAILABLE" });
}

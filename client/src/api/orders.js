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

export async function createCheckoutSession(orderId, goldToUse = 0) {
  const res = await fetch(`${API_BASE_URL}/payments/create-checkout-session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      orderId,
      goldToUse,
    }),
  });

  const data = await res.json();

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Failed to create checkout session");
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
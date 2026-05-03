const API_BASE_URL = "http://localhost:5000/api";

function authHeaders() {
  const token = localStorage.getItem("token");

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function customerListMyOrders() {
  const res = await fetch(`${API_BASE_URL}/orders/my`, {
    headers: authHeaders(),
  });

  const data = await res.json();

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Failed to load your orders");
  }

  return data.orders || data.items || [];
}
const API_BASE_URL = "http://localhost:5000/api";

function authHeaders() {
  const token = localStorage.getItem("token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function adminListOrders({ page = 1, pageSize = 20, status, serviceId, q } = {}) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (status) params.set("status", status);
  if (serviceId) params.set("serviceId", serviceId);
  if (q) params.set("q", q);

  const res = await fetch(`${API_BASE_URL}/orders/admin?${params.toString()}` , {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to load orders");
  return data;
}

export async function adminGetOrder(id) {
  const res = await fetch(`${API_BASE_URL}/orders/admin/${id}`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to load order");
  return data.order;
}

export async function adminUpdateOrderStatus(id, status) {
  const res = await fetch(`${API_BASE_URL}/orders/admin/${id}/status`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ status }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to update status");
  return data.order;
}

export async function adminListProviders(q) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const res = await fetch(`${API_BASE_URL}/user/providers?${params.toString()}`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to load providers");
  return data.users;
}

export async function adminListAssignments(orderId) {
  const res = await fetch(`${API_BASE_URL}/orders/${orderId}/assignments`, {
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to load assignments");
  return data.assignments;
}

export async function adminAssignBooster(orderId, boosterId) {
  const res = await fetch(`${API_BASE_URL}/orders/${orderId}/assign/${boosterId}`, {
    method: "POST",
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to assign booster");
  return data;
}

export async function adminUnassignBooster(orderId, boosterId) {
  const res = await fetch(`${API_BASE_URL}/orders/${orderId}/assign/${boosterId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "Failed to unassign booster");
  return data;
}

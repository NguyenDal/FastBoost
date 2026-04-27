const API_BASE_URL = "http://localhost:5000/api";

function authHeaders() {
  const token = localStorage.getItem("token");

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export async function createAssignmentRequest(orderId, boosterId) {
  const data = await request(
    `/assignment-requests/orders/${orderId}/boosters/${boosterId}`,
    {
      method: "POST",
    }
  );

  return data.request;
}

export async function cancelAssignmentRequest(requestId) {
  const data = await request(`/assignment-requests/${requestId}/cancel`, {
    method: "PATCH",
  });

  return data.request;
}

export async function listOrderAssignmentRequests(orderId) {
  const data = await request(`/assignment-requests/orders/${orderId}`);

  return data.requests || [];
}

export async function acceptAssignmentRequest(requestId) {
  const data = await request(`/assignment-requests/${requestId}/accept`, {
    method: "PATCH",
  });

  return data;
}

export async function declineAssignmentRequest(requestId) {
  const data = await request(`/assignment-requests/${requestId}/decline`, {
    method: "PATCH",
  });

  return data;
}
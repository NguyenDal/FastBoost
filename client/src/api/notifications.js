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

export async function listMyNotifications() {
  const data = await request("/notifications");
  return data.notifications || [];
}

export async function markNotificationRead(notificationId) {
  const data = await request(`/notifications/${notificationId}/read`, {
    method: "PATCH",
  });

  return data.notification;
}

export async function markAllNotificationsRead() {
  const data = await request("/notifications/read-all", {
    method: "PATCH",
  });

  return data.notifications || [];
}
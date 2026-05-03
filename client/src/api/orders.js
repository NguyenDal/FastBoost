const API_BASE_URL = "http://localhost:5000/api";

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
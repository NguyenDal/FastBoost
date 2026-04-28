const API_BASE_URL = "http://localhost:5000/api";

function authHeaders() {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export async function providerListAssignedOrders({
    page = 1,
    pageSize = 20,
    status,
    q,
} = {}) {
    const params = new URLSearchParams();

    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    if (status) params.set("status", status);
    if (q) params.set("q", q);

    const res = await fetch(
        `${API_BASE_URL}/orders/provider/assigned?${params.toString()}`,
        {
            headers: authHeaders(),
        }
    );

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to load assigned orders");
    }

    return data;
}

export async function providerCompleteOrder(orderId) {
    const res = await fetch(`${API_BASE_URL}/orders/${orderId}/provider-complete`, {
        method: "PATCH",
        headers: authHeaders(),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to complete order");
    }

    return data.order;
}

export async function providerLeaveOrder(orderId) {
    const res = await fetch(`${API_BASE_URL}/orders/${orderId}/provider-leave`, {
        method: "DELETE",
        headers: authHeaders(),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to leave order");
    }

    return data;
}
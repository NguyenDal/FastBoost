import { API_BASE_URL } from './config.js';

function getAuthHeaders() {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
    };
}

export async function adminListUsers({ page = 1, pageSize = 20, q = "", role = "" } = {}) {
    const params = new URLSearchParams();

    params.set("page", String(page));
    params.set("pageSize", String(pageSize));

    if (q) params.set("q", q);
    if (role) params.set("role", role);

    const res = await fetch(`${API_BASE_URL}/admin/users?${params.toString()}`, {
        headers: getAuthHeaders(),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(data.message || "Failed to load users");
    }

    return data;
}

export async function adminUpdateUserRole(userId, role) {
    const res = await fetch(`${API_BASE_URL}/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ role }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(data.message || "Failed to update user role");
    }

    return data;
}
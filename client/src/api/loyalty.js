import { API_BASE_URL } from './config.js';

function authHeaders() {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export async function getMyLoyalty() {
    const res = await fetch(`${API_BASE_URL}/loyalty/me`, {
        headers: authHeaders(),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to load loyalty data");
    }

    return data.loyalty;
}
import { API_BASE_URL } from './config.js';

function authHeaders() {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export async function getMyLoyalty({ rewardPage = 1, rewardLimit = 5 } = {}) {
    const params = new URLSearchParams({
        rewardPage: String(rewardPage),
        rewardLimit: String(rewardLimit),
    });

    const res = await fetch(`${API_BASE_URL}/loyalty/me?${params.toString()}`, {
        headers: authHeaders(),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to load loyalty data");
    }

    return data.loyalty;
}
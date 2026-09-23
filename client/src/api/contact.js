import { API_BASE_URL } from "./config";

export async function sendContactEmail(payload) {
    const res = await fetch(`${API_BASE_URL}/contact`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "We couldn't send your message. Please try again or email support@fastboost.gg directly.");
    }

    // Older deployments returned 202 before SMTP finished, even when it failed.
    if (res.status !== 200 || data.ok !== true || data.status !== "sent") {
        throw new Error("We couldn't confirm your message was sent. Please email support@fastboost.gg directly.");
    }

    return data;
}

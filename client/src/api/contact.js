import { API_BASE_URL } from "./config";

export async function sendContactEmail(payload) {
    const res = await fetch(`${API_BASE_URL}/contact`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to send contact email");
    }

    return data;
}
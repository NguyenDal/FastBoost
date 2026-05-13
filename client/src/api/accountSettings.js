import { API_BASE_URL } from "./config.js";

function authHeaders() {
    const token = localStorage.getItem("token");

    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export async function getMyAccount() {
    const res = await fetch(`${API_BASE_URL}/user/me`, {
        headers: authHeaders(),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to load account");
    }

    return data.user;
}

export async function updateMyAccount(payload) {
    const res = await fetch(`${API_BASE_URL}/user/me`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        const error = new Error(data.message || "Failed to update account");
        error.field = data.field;
        throw error;
    }

    return data.user;
}

export async function changeMyPassword(payload) {
    const res = await fetch(`${API_BASE_URL}/user/me/password`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        const error = new Error(data.message || "Failed to update password");
        error.field = data.field;
        throw error;
    }

    return data;
}

export async function uploadProfilePicture(file) {
    const token = localStorage.getItem("token");

    const formData = new FormData();
    formData.append("profileImage", file);

    const res = await fetch(`${API_BASE_URL}/user/me/profile-picture`, {
        method: "POST",
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to upload profile picture");
    }

    return data;
}

export async function sendEmailVerificationCode() {
    const res = await fetch(`${API_BASE_URL}/user/me/email-verification/send`, {
        method: "POST",
        headers: authHeaders(),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to send email verification code");
    }

    return data;
}

export async function confirmEmailVerificationCode(code) {
    const res = await fetch(`${API_BASE_URL}/user/me/email-verification/confirm`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ code }),
    });

    const data = await res.json();

    if (!res.ok || data.ok === false) {
        throw new Error(data.message || "Failed to verify email");
    }

    return data;
}
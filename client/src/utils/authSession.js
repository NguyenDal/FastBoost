export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

export function isTokenExpired(token) {
  if (!token) return true;

  try {
    const payloadBase64 = token.split(".")[1];

    if (!payloadBase64) return true;

    const payload = JSON.parse(atob(payloadBase64));
    const exp = payload?.exp;

    if (!exp) return true;

    const nowInSeconds = Math.floor(Date.now() / 1000);

    return exp <= nowInSeconds;
  } catch {
    return true;
  }
}

export function clearExpiredSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("unreadMessages");
  localStorage.removeItem("unreadNotifications");

  try {
    window.dispatchEvent(new Event("auth:changed"));
    window.dispatchEvent(new Event("unread:update"));
  } catch {}
}

export function hasValidSession() {
  const token = localStorage.getItem("token");

  if (!token || isTokenExpired(token)) {
    clearExpiredSession();
    return false;
  }

  return true;
}
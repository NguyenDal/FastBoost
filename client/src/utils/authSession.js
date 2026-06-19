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

export function notifyAuthChanged(detail = {}) {
  try {
    window.dispatchEvent(
      new CustomEvent("auth:changed", {
        detail,
      })
    );
  } catch {}
}

export function notifyUnreadChanged() {
  try {
    window.dispatchEvent(new Event("unread:update"));
  } catch {}
}

export function notifySessionExpired() {
  try {
    window.dispatchEvent(
      new CustomEvent("session:expired", {
        detail: {
          reason: "expired",
        },
      })
    );
  } catch {}
}

export function clearExpiredSession({ showExpiredModal = true } = {}) {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("unreadMessages");
  localStorage.removeItem("unreadNotifications");

  notifyAuthChanged({
    loggedOut: true,
    sessionExpired: showExpiredModal,
  });

  notifyUnreadChanged();

  if (showExpiredModal) {
    notifySessionExpired();
  }
}

export function clearLoggedOutSession() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("unreadMessages");
  localStorage.removeItem("unreadNotifications");

  notifyAuthChanged({
    loggedOut: true,
  });

  notifyUnreadChanged();
}

export function hasValidSession() {
  const token = localStorage.getItem("token");

  if (!token) {
    return false;
  }

  if (isTokenExpired(token)) {
    clearExpiredSession({
      showExpiredModal: true,
    });

    return false;
  }

  return true;
}
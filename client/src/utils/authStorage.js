// Persistent only when the customer explicitly chooses Remember me.
export const authStorage = {
  getItem(key) {
    if (key === "token") return sessionStorage.getItem(key) || localStorage.getItem(key);
    return (sessionStorage.getItem("token") ? sessionStorage : localStorage).getItem(key);
  },
  setItem(key, value) {
    (sessionStorage.getItem("token") ? sessionStorage : localStorage).setItem(key, value);
  },
  removeItem(key) {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  },
};

export function storeAuthSession(token, user, rememberMe = false) {
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem("token");
    storage.removeItem("user");
  }
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem("token", token);
  storage.setItem("user", JSON.stringify(user));
  sessionStorage.removeItem("fastboost:session-expired-shown");
}

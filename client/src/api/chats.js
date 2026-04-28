const API_BASE_URL = "http://localhost:5000/api";

function authHeaders() {
  const token = localStorage.getItem("token");

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

export async function getOrderConversation(orderId) {
  const data = await request(`/chats/orders/${orderId}`);
  return data.conversation;
}

export async function getConversationMessages(conversationId) {
  const data = await request(`/chats/conversations/${conversationId}/messages`);
  return data.messages || [];
}

export async function sendConversationMessage(conversationId, text) {
  const data = await request(`/chats/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });

  return data.message;
}
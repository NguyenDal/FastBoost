import { API_BASE_URL } from './config.js';

function authHeaders() {
  const token = localStorage.getItem("token");

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function authOnlyHeaders() {
  const token = localStorage.getItem("token");

  return {
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

export async function uploadConversationAttachment(conversationId, file) {
  const formData = new FormData();
  formData.append("attachment", file);

  const res = await fetch(`${API_BASE_URL}/chats/conversations/${conversationId}/attachments`, {
    method: "POST",
    headers: authOnlyHeaders(),
    body: formData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || data.ok === false) {
    throw new Error(data.message || "Failed to upload attachment");
  }

  return data.message;
}

export async function getMessageAttachmentViewUrl(messageId) {
  const data = await request(`/chats/messages/${messageId}/attachment`);
  return data.viewUrl;
}
import { API_BASE_URL } from './config';
import { authStorage } from '../utils/authStorage';

export async function supportRequest(path, { method = 'GET', body, token = authStorage.getItem('token') } = {}) {
    const multipart = body instanceof FormData;
    const res = await fetch(`${API_BASE_URL}/support${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(!multipart && body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? multipart ? body : JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.message || 'Support chat is unavailable. Please try again.');
    return data;
}

export async function supportAttachmentData(messageId, signal) {
    const res = await fetch(`${API_BASE_URL}/support/attachments/${messageId}/content`, { signal, headers: { Authorization: `Bearer ${authStorage.getItem('token')}` } });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'This PDF could not be opened.');
    }
    return res.arrayBuffer();
}

import { API_BASE_URL } from './config.js';
import { authStorage } from '../utils/authStorage';

const pathFor = orderId => `/orders/${encodeURIComponent(orderId)}/highlights`;
const headers = () => {
  const token = authStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

async function readResponse(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.message || fallback);
  return data;
}

export async function listOrderHighlights(orderId, signal) {
  const response = await fetch(`${API_BASE_URL}${pathFor(orderId)}`, { headers: headers(), signal });
  return readResponse(response, 'Could not load highlights.');
}

export async function getOrderHighlightViewUrl(orderId, highlightId, signal) {
  const response = await fetch(`${API_BASE_URL}${pathFor(orderId)}/${encodeURIComponent(highlightId)}/view-url`, {
    headers: headers(), signal,
  });
  const data = await readResponse(response, 'Could not open this highlight.');
  return data.url;
}

export function uploadOrderHighlight(orderId, { file, title, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('title', title);
    form.append('highlight', file);
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => xhr.abort();
    if (signal?.aborted) {
      reject(new DOMException('Upload cancelled.', 'AbortError'));
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* Show a useful fallback below. */ }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok !== false) {
        onProgress?.(100);
        finish(resolve, data.highlight);
      } else finish(reject, new Error(data.message || 'Could not upload this highlight.'));
    };
    xhr.onerror = () => finish(reject, new Error('The upload was interrupted. Try again.'));
    xhr.onabort = () => finish(reject, new DOMException('Upload cancelled.', 'AbortError'));
    xhr.open('POST', `${API_BASE_URL}${pathFor(orderId)}`);
    for (const [key, value] of Object.entries(headers())) xhr.setRequestHeader(key, value);
    xhr.send(form);
  });
}

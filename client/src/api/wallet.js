import { authStorage } from '../utils/authStorage';
import { API_BASE_URL } from './config.js';

async function walletRequest(path, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    if (signal?.aborted) throw signal.reason || new DOMException('Request cancelled.', 'AbortError');
    const cancel = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out.', 'TimeoutError')), 20000);
    try {
        const token = authStorage.getItem('token');
        const response = await fetch(`${API_BASE_URL}${path}`, {
            method, signal: controller.signal, cache: 'no-store',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const data = await response.json();
        if (!response.ok || data.ok === false) throw Object.assign(new Error(data.message || 'Your wallet is temporarily unavailable. Please try again.'), { status: response.status, code: data.code });
        return data;
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
    }
}

export const getWallet = options => walletRequest('/wallet', options);
export const createWalletTopUp = (packageId, options = {}) => walletRequest('/wallet/top-ups', { method: 'POST', body: { packageId, ...(options.uiMode ? { uiMode: options.uiMode } : {}) } });
export const cancelWalletTopUp = sessionId => walletRequest('/wallet/top-ups/cancel', { method: 'POST', body: { sessionId } });
export const verifyWalletTopUp = ({ sessionId, signal }) => walletRequest(`/wallet/top-ups/verify?${new URLSearchParams({ sessionId })}`, { signal });
export const payOrderWithWallet = (orderId, contactEmail, expectedTotalCents, { checkoutViewId } = {}) => walletRequest('/payments/wallet', { method: 'POST', body: { orderId, contactEmail, expectedTotalCents, checkoutViewId } });

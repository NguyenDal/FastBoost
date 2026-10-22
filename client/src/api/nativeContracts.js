import { API_BASE_URL } from './config';
import { authStorage } from '../utils/authStorage';

export async function nativeContractRequest(id, action = 'signing', body, signal) {
    const token = authStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/operations/contracts/${encodeURIComponent(id)}/${action}`, {
        signal, cache: 'no-store', method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    // A late response belongs to the session that made the request. It must never
    // populate a signing form after another person logs in or the user logs out.
    if (token !== authStorage.getItem('token')) throw Object.assign(new Error('Your session changed. Reload this agreement.'), { name: 'AbortError' });
    if (!response.ok) throw Object.assign(new Error(result.message || 'Could not load the agreement. Please try again.'), { status: response.status });
    return result;
}

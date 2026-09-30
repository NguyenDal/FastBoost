import { API_BASE_URL } from './config';
import { authStorage } from '../utils/authStorage';

async function request(suffix, signal) {
    const response = await fetch(`${API_BASE_URL}/operations/provider-agreement${suffix}`, {
        signal, cache: 'no-store', headers: { Authorization: `Bearer ${authStorage.getItem('token')}` },
    });
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw Object.assign(new Error(result.message || 'Could not load the agreement. Please try again.'), { status: response.status });
    }
    return response;
}
export async function loadProviderAgreement(signal) {
    const response = await request('', signal);
    return (await response.json()).html;
}
export async function downloadProviderAgreement() {
    const response = await request('/document');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url; link.download = 'FastBoost-provider-agreement-review.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

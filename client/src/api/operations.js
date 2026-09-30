import { API_BASE_URL } from './config';
import { authStorage } from '../utils/authStorage';

export async function operations(path, body, method = 'POST') {
    const form = body instanceof FormData;
    const response = await fetch(`${API_BASE_URL}/operations${path}`, {
        method: body === undefined ? 'GET' : method,
        headers: { Authorization: `Bearer ${authStorage.getItem('token')}`, ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Could not complete this request.');
    return result;
}
export async function downloadContract(id) {
    const response = await fetch(`${API_BASE_URL}/operations/contracts/${id}/document`, { headers: { Authorization: `Bearer ${authStorage.getItem('token')}` } });
    if (!response.ok) throw new Error((await response.json()).message || 'Could not download the contract.');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = 'FastBoost-contract.pdf'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export const money = (cents, currency = 'USD') => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100);
export const date = value => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'Not set';
export function tenure(value) {
    if (!value) return 'Start date not set';
    const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
    if (days < 0) return `Starts ${date(value)}`;
    return `${Math.floor(days / 365) ? `${Math.floor(days / 365)}y ` : ''}${Math.floor(days % 365 / 30)}mo · Since ${date(value)}`;
}

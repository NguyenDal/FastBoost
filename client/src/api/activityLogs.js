import { authStorage } from '../utils/authStorage';
import { API_BASE_URL } from './config';

export async function activityLogs(path = '', signal) {
    const token = authStorage.getItem('token');
    const response = await fetch(`${API_BASE_URL}/admin/activity-logs${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}, signal, cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.message || 'Could not load activity logs.'), { status: response.status });
    return data;
}

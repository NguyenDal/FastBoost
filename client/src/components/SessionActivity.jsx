import { useEffect } from 'react';
import { authStorage } from '../utils/authStorage';
import { clearExpiredSession } from '../utils/authSession';
import { API_BASE_URL } from '../api/config';

export default function SessionActivity() {
    useEffect(() => {
        let busy = false, lastRefresh = 0, stopped = false;
        const refresh = async () => {
            if (document.hidden || busy || Date.now() - lastRefresh < 60000) return;
            const token = authStorage.getItem('token');
            if (!token) return;
            try {
                const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
                if (payload.rememberMe !== true) return;
            } catch { return; }
            busy = true;
            try {
                const res = await fetch(`${API_BASE_URL}/auth/session/activity`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
                const data = await res.json();
                if (stopped || token !== authStorage.getItem('token')) return;
                if (res.status === 401) clearExpiredSession();
                else if (res.ok && data.token) {
                    authStorage.setItem('token', data.token);
                    lastRefresh = Date.now();
                    window.dispatchEvent(new Event('auth:refreshed'));
                }
            } catch { /* Network failures don't discard a valid session. */ }
            finally { busy = false; }
        };
        const signedIn = () => { lastRefresh = 0; void refresh(); };
        const events = ['pointerdown', 'keydown', 'scroll', 'focus'];
        events.forEach(event => window.addEventListener(event, refresh, { passive: true }));
        document.addEventListener('visibilitychange', refresh);
        window.addEventListener('auth:changed', signedIn);
        void refresh();
        return () => {
            stopped = true;
            events.forEach(event => window.removeEventListener(event, refresh));
            document.removeEventListener('visibilitychange', refresh);
            window.removeEventListener('auth:changed', signedIn);
        };
    }, []);
    return null;
}

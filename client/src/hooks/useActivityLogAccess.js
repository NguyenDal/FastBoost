import { useEffect, useState } from 'react';
import { activityLogs } from '../api/activityLogs';

// This capability grants read-only activity-log access, not owner permissions.
// Show the card/navigation only after the server confirms the current admin.
export default function useActivityLogAccess() {
    const [allowed, setAllowed] = useState(false);
    useEffect(() => {
        let active = true;
        let controller;
        const check = () => {
            controller?.abort();
            const request = new AbortController(); controller = request;
            activityLogs('/access', request.signal).then(data => { if (active && !request.signal.aborted) setAllowed(data.canView === true); })
                .catch(error => { if (active && !request.signal.aborted && error.name !== 'AbortError') setAllowed(false); });
        };
        check(); window.addEventListener('focus', check);
        return () => { active = false; controller?.abort(); window.removeEventListener('focus', check); };
    }, []);
    return allowed;
}

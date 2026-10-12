import { useEffect, useState } from 'react';
import { activityLogs } from '../api/activityLogs';

// The card and navigation are opt-in only after the server confirms the current
// owner. Cached profile flags never grant access to the log data.
export default function useOwnerAccess() {
    const [allowed, setAllowed] = useState(false);
    useEffect(() => {
        let active = true;
        let controller;
        const check = () => {
            controller?.abort(); controller = new AbortController();
            activityLogs('/access', controller.signal).then(data => { if (active) setAllowed(data.canView === true); })
                .catch(error => { if (active && error.name !== 'AbortError') setAllowed(false); });
        };
        check(); window.addEventListener('focus', check);
        return () => { active = false; controller?.abort(); window.removeEventListener('focus', check); };
    }, []);
    return allowed;
}

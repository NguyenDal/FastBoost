import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ProfileMenuLayer({ anchorRef, onClose, children }) {
    const menu = useRef(null);
    const [position, setPosition] = useState({ visibility: 'hidden' });
    useLayoutEffect(() => { if (position.visibility === 'visible') menu.current?.querySelector('[role="menuitem"]')?.focus(); }, [position.visibility]);
    useLayoutEffect(() => {
        const place = () => {
            const anchor = anchorRef.current;
            const element = menu.current;
            if (!anchor || !element) return;
            const bounds = anchor.getBoundingClientRect();
            const margin = 12;
            const width = Math.min(280, window.innerWidth - margin * 2);
            const left = Math.max(margin, Math.min(bounds.right - width, window.innerWidth - width - margin));
            const top = Math.min(Math.max(margin, bounds.bottom + 10), window.innerHeight - 80);
            setPosition({ left, top, width, maxHeight: Math.max(60, window.innerHeight - top - margin), visibility: 'visible' });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        const outside = event => {
            if (!menu.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) onClose();
        };
        document.addEventListener('pointerdown', outside);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
            document.removeEventListener('pointerdown', outside);
        };
    }, [anchorRef, onClose]);
    return createPortal(<div ref={menu} className="profile-menu profile-menu-expanded profile-menu-portal" role="menu" aria-label="Account menu" style={position}
        onClick={event => event.stopPropagation()} onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchorRef.current?.focus(); }
            else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [...menu.current.querySelectorAll('[role="menuitem"]')];
                const index = items.indexOf(document.activeElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
            }
        }}>{children}</div>, document.body);
}

export default function DashboardIcon({ kind }) {
    return <span className={"dashboard-purple-icon dashboard-purple-icon-" + kind} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
            {kind === "profile" ? <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2H4Z" /></> :
                kind === "lightning" ? <path d="M13 2 5 13h6l-2 9L21 9h-7l3-7h-4Z" /> :
                    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M21 12h-6v5h6" /><path d="M17.5 14.5h.01" strokeLinecap="round" /></g>}
        </svg>
    </span>;
}

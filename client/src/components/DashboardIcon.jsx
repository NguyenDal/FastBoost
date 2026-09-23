export default function DashboardIcon({ kind }) {
    return <span className={"dashboard-purple-icon dashboard-purple-icon-" + kind} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
            {kind === "loyalty" ? <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4M12 13v5m-4 3h8m-7-3h6v3" /></g> : kind === "referral" ? <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 4a3 3 0 0 1 0 6m2 4v6m-3-3h6"/></g> : kind === "coupon" ? <g fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Z"/><path d="M9 6v12" strokeDasharray="2 2"/><path d="m13 14 4-4"/><circle cx="13" cy="10" r=".5"/><circle cx="17" cy="14" r=".5"/></g> : kind === "profile" ? <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2H4Z" /></> :
                kind === "lightning" ? <path d="M13 2 5 13h6l-2 9L21 9h-7l3-7h-4Z" /> :
                    <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M21 12h-6v5h6" /><path d="M17.5 14.5h.01" strokeLinecap="round" /></g>}
        </svg>
    </span>;
}

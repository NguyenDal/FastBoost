export function BinIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
    </svg>;
}

export default function ActivityClearRow({ children, editing, removing, busy, label, onClear }) {
    return <div className={`activity-clear-row${editing ? ' editing' : ''}${removing ? ' removing' : ''}`}>
        <div className="activity-clear-collapse">
            <div className="activity-clear-inner">
                <button type="button" className="activity-item-bin" aria-label={label}
                    disabled={!editing || busy} tabIndex={editing ? 0 : -1}
                    aria-hidden={!editing} onClick={onClear}><BinIcon /></button>
                <div className="activity-clear-content" inert={editing || removing || undefined}>{children}</div>
            </div>
        </div>
    </div>;
}

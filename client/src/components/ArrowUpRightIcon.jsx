const iconStyle = { width: '1em', height: '1em', flexShrink: 0, verticalAlign: '-0.125em' };

// Use vector artwork so mobile fonts cannot replace the arrow with an emoji.
export default function ArrowUpRightIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" style={iconStyle} aria-hidden="true" focusable="false">
        <path d="M7 17 17 7M7 7h10v10" />
    </svg>;
}

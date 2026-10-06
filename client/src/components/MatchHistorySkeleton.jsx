import { Skeleton } from './Skeleton';
import '../styles/Skeleton.css';
import '../styles/MatchHistory.css';

export default function MatchHistorySkeleton({ contentOnly = false }) {
    const content = <div className="mh-loading" role="status" aria-label="Loading match history" aria-busy="true">
        <span className="mh-sr-only">Loading match history…</span>
        <div className="mh-counts" aria-hidden="true">{[0, 1, 2].map(i => <Skeleton key={i} width={100} height={18} />)}</div>
        <div className="mh-list" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <div className="mh-skeleton-card" key={i}>
            <div className="mh-skeleton-lines"><Skeleton width="80%" height={12} /><Skeleton width="60%" height={10} /><Skeleton width="65%" height={12} /></div>
            <div className="mh-skeleton-lines"><Skeleton width={44} height={44} radius="50%" /><Skeleton width="100%" height={24} radius={4} /></div>
            <div className="mh-skeleton-lines"><Skeleton width="70%" height={16} /><Skeleton width="55%" height={11} /></div>
            <div className="mh-skeleton-lines mh-skeleton-roster">{[0, 1, 2, 3, 4].map(j => <Skeleton key={j} width={j % 2 ? '80%' : '95%'} height={12} />)}</div>
        </div>)}</div>
    </div>;
    return contentOnly ? content : <section className="mh-panel" aria-label="Match history"><header className="mh-heading"><h2>Match history</h2></header>{content}</section>;
}

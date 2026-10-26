import { Skeleton } from './Skeleton';
import OrderHighlightsIntro from './OrderHighlightsIntro';
import '../styles/Skeleton.css';
import '../styles/OrderHighlights.css';

export default function OrderHighlightsSkeleton({ contentOnly = false }) {
  const content = <div className="highlight-loading" role="status" aria-label="Loading highlights" aria-busy="true">
    <span className="highlight-sr-only">Loading highlights…</span>
    <div className="highlight-loading-list" aria-hidden="true">
      {[0, 1].map(index => <div className="highlight-loading-row" key={index}>
        <div className="highlight-loading-preview"><Skeleton width="100%" height="100%" radius={0} /></div>
        <div className="highlight-loading-details">
          <Skeleton width={90} height={10} />
          <Skeleton width={index ? '62%' : '72%'} height={20} radius={6} />
          <Skeleton width={index ? '45%' : '54%'} height={11} />
          <Skeleton width={50} height={20} radius={5} />
        </div>
        <Skeleton className="highlight-loading-watch" width={90} height={12} />
      </div>)}
    </div>
  </div>;
  return contentOnly ? content : <section className="order-highlights" aria-labelledby="order-highlights-title"><OrderHighlightsIntro />{content}</section>;
}

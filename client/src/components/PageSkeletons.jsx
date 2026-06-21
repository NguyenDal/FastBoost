import {
  Skeleton,
  SkeletonButton,
  SkeletonCard,
  SkeletonField,
} from "./Skeleton";

export function GenericPageSkeleton() {
  return (
    <main className="page-container">
      <div className="fb-skeleton-page">
        <div>
          <Skeleton width={140} height={14} />
          <div style={{ height: 14 }} />
          <Skeleton width="min(560px, 70vw)" height={48} radius={18} />
          <div style={{ height: 14 }} />
          <Skeleton width="min(460px, 62vw)" height={18} />
        </div>

        <div className="fb-skeleton-panel">
          <SkeletonCard />

          <div style={{ height: 22 }} />

          <div className="fb-skeleton-grid fb-skeleton-grid-2">
            <SkeletonField />
            <SkeletonField />
            <SkeletonField />
            <SkeletonField />
          </div>

          <div style={{ height: 22 }} />

          <SkeletonButton width={180} />
        </div>
      </div>
    </main>
  );
}

export function TwoColumnPageSkeleton() {
  return (
    <main className="page-container">
      <div className="fb-skeleton-page">
        <div>
          <Skeleton width={140} height={14} />
          <div style={{ height: 14 }} />
          <Skeleton width="min(520px, 70vw)" height={48} radius={18} />
          <div style={{ height: 14 }} />
          <Skeleton width="min(420px, 62vw)" height={18} />
        </div>

        <div className="fb-skeleton-grid" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(320px, 0.8fr)" }}>
          <section className="fb-skeleton-panel">
            <SkeletonCard />

            <div style={{ height: 22 }} />

            <div className="fb-skeleton-grid fb-skeleton-grid-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <SkeletonField key={index} />
              ))}
            </div>
          </section>

          <aside className="fb-skeleton-panel">
            <Skeleton width="62%" height={26} />
            <div style={{ height: 22 }} />
            <Skeleton height={48} radius={16} />
            <div style={{ height: 14 }} />
            <Skeleton height={48} radius={16} />
            <div style={{ height: 14 }} />
            <Skeleton height={48} radius={16} />
            <div style={{ height: 22 }} />
            <Skeleton height={70} radius={20} />
            <div style={{ height: 18 }} />
            <SkeletonButton width="100%" />
          </aside>
        </div>
      </div>
    </main>
  );
}

export function CardGridSkeleton({ count = 6 }) {
  return (
    <div className="fb-skeleton-grid fb-skeleton-grid-3">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
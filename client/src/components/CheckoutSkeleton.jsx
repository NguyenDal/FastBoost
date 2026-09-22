import { Skeleton } from "./Skeleton";

export function PaymentFormSkeleton() {
    return <div className="checkout-skeleton" role="status" aria-label="Loading secure payment form" aria-busy="true">
        <Skeleton width="36%" height={16} />
        <Skeleton height={44} radius={10} />
        <Skeleton width="44%" height={16} />
        <Skeleton height={48} radius={10} />
        <Skeleton width="38%" height={16} />
        <Skeleton height={48} radius={10} />
        <div className="checkout-skeleton-row"><Skeleton height={48} radius={10} /><Skeleton height={48} radius={10} /></div>
        <Skeleton height={48} radius={10} />
        <Skeleton height={48} radius={10} />
        <Skeleton height={56} radius={10} />
    </div>;
}

export default function CheckoutSkeleton() {
    return <div className="checkout-grid" aria-busy="true">
        <section className="checkout-card checkout-payment">
            <Skeleton width="45%" height={24} style={{ marginBottom: 24 }} />
            <PaymentFormSkeleton />
        </section>
        <aside className="checkout-card checkout-summary checkout-skeleton" aria-hidden="true">
            <Skeleton width="60%" height={24} />
            <div className="checkout-skeleton-row"><Skeleton width={60} height={60} radius={10} /><Skeleton width="65%" height={40} radius={8} /></div>
            <Skeleton height={60} radius={12} />
            <Skeleton height={170} radius={16} />
            <Skeleton height={48} radius={10} />
            <Skeleton width="75%" height={16} />
            <Skeleton height={32} />
            <Skeleton height={100} radius={10} />
        </aside>
    </div>;
}

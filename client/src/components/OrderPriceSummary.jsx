import { Skeleton } from './Skeleton';

export default function OrderPriceSummary({ summary }) {
    if (!summary) return <div role="status" aria-label="Loading price summary"><Skeleton height={120} radius={8} /></div>;
    const price = cents => new Intl.NumberFormat(undefined, { style: 'currency', currency: summary.currency || 'CAD' }).format(cents / 100);
    const discounts = [
        { label: 'Promotion', cents: summary.promotionCents },
        { label: `Coupon${summary.coupon?.code ? ` (${summary.coupon.code})` : ''}`, title: summary.coupon?.title, cents: summary.coupon?.amountCents },
        { label: 'Referral discount', cents: summary.referralCents },
        { label: `Gold used${summary.goldRedeemed ? ` (${summary.goldRedeemed.toLocaleString()} Gold)` : ''}`, cents: summary.goldDiscountCents },
    ].filter(row => row.cents > 0);
    return <div className="price-summary">
        <div className="price-row"><span>Subtotal</span><strong>{price(summary.subtotalCents)}</strong></div>
        {discounts.map(row => <div className="price-row price-discount" key={row.label}><span title={row.title}>{row.label}</span><strong>−{price(row.cents)}</strong></div>)}
        <div className="price-row total"><span>Total</span><strong>{price(summary.totalCents)}</strong></div>
    </div>;
}

import { Skeleton } from './Skeleton';
import '../styles/OrderPriceSummary.css';
import '../styles/Skeleton.css';

export default function OrderPriceSummary({ summary, variant = 'default', onRemoveCoupon, busy = false }) {
    if (!summary) return <div role="status" aria-label="Loading price summary"><Skeleton height={120} radius={8} /></div>;
    const price = cents => new Intl.NumberFormat(undefined, { style: 'currency', currency: summary.currency || 'CAD' }).format(cents / 100);
    const discounts = [
        { label: 'Promotion', cents: summary.promotionCents },
        { label: `Coupon${summary.coupon?.code ? ` (${summary.coupon.code})` : ''}`, title: summary.coupon?.title, cents: summary.coupon?.amountCents, coupon: true },
        { label: 'Referral discount', cents: summary.referralCents },
        { label: `Gold used${summary.goldRedeemed ? ` (${summary.goldRedeemed.toLocaleString()} Gold)` : ''}`, cents: summary.goldDiscountCents },
    ].filter(row => row.cents > 0);
    if (variant === 'checkout') return <dl className="checkout-totals">
        <div><dt>Subtotal</dt><dd>{price(summary.subtotalCents)}</dd></div>
        {discounts.map(row => <div className="checkout-discount" key={row.label}><dt className={row.coupon ? 'checkout-coupon-label' : undefined}><span title={row.title}>{row.label}</span>{row.coupon && onRemoveCoupon && <button type="button" className="checkout-coupon-remove" disabled={busy} onClick={onRemoveCoupon} aria-label={`Remove ${row.label}`} title="Remove coupon">Remove</button>}</dt><dd>−{price(row.cents)}</dd></div>)}
        <div className="checkout-total"><dt>Total</dt><dd>{price(summary.totalCents)}</dd></div>
    </dl>;
    return <div className="price-summary">
        <div className="price-row"><span>Subtotal</span><strong>{price(summary.subtotalCents)}</strong></div>
        {discounts.map(row => <div className="price-row price-discount" key={row.label}><span title={row.title}>{row.label}</span><strong>−{price(row.cents)}</strong></div>)}
        <div className="price-row total"><span>Total</span><strong>{price(summary.totalCents)}</strong></div>
    </div>;
}

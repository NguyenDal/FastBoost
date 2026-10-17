import { Skeleton } from './Skeleton';
import '../styles/OrderPriceSummary.css';
import '../styles/Skeleton.css';

export default function OrderPriceSummary({ summary, variant = 'default', onRemoveCoupon, busy = false, formatPrice }) {
    if (!summary) return <div role="status" aria-label="Loading price summary"><Skeleton height={120} radius={8} /></div>;
    const price = formatPrice || (cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: summary.currency || 'USD' }).format(cents / 100));
    if (variant === 'admin') {
        const breakdown = summary.adminBreakdown;
        const amount = cents => Number.isSafeInteger(cents) ? price(cents) : 'Not recorded';
        const promotion = breakdown?.promotion;
        const promotionPercent = Number(promotion?.discountPercent);
        const promotionLabel = `${promotion?.title || 'Promotion'}${Number.isFinite(promotionPercent) && promotionPercent > 0 && promotionPercent <= 100 ? ` (${promotionPercent}%)` : ''}`;
        const discounts = [
            { label: promotionLabel, cents: breakdown?.promotionCents },
            { label: `Coupon${breakdown?.coupon?.code ? ` (${breakdown.coupon.code})` : ''}`, title: breakdown?.coupon?.title, cents: breakdown?.coupon?.amountCents },
            { label: 'Referral discount', cents: breakdown?.referralCents },
            { label: `Gold used${breakdown?.goldRedeemed ? ` (${breakdown.goldRedeemed.toLocaleString()} Gold)` : ''}`, cents: breakdown?.goldDiscountCents },
        ].filter(row => row.cents > 0);
        return <div className="admin-price-summary">
            <dl className="price-summary price-summary--admin">
                <div className="price-row"><dt>Base price</dt><dd>{amount(breakdown?.basePriceCents)}</dd></div>
                {breakdown?.addonPriceCents > 0 && <div className="price-row"><dt>Add-ons</dt><dd>{price(breakdown.addonPriceCents)}</dd></div>}
                {discounts.map(row => <div className="price-row price-discount" key={row.label}><dt title={row.title}>{row.label}</dt><dd>−{price(row.cents)}</dd></div>)}
                <div className="price-row price-subtotal"><dt>Subtotal</dt><dd>{amount(breakdown?.subtotalCents)}</dd></div>
                {breakdown?.taxCents > 0 && <div className="price-row"><dt>Tax</dt><dd>{price(breakdown.taxCents)}</dd></div>}
                <div className="price-row total"><dt>Total</dt><dd>{amount(breakdown ? breakdown.totalCents : summary.totalCents)}</dd></div>
            </dl>
            {breakdown?.hasUnitemizedAdjustment && <p className="admin-price-summary-note">Some price adjustments were not itemized in the saved order.</p>}
        </div>;
    }
    const discounts = [
        { label: 'Promotion', cents: summary.promotionCents },
        { label: `Coupon${summary.coupon?.code ? ` (${summary.coupon.code})` : ''}`, title: summary.coupon?.title, cents: summary.coupon?.amountCents, coupon: true },
        { label: 'Referral discount', cents: summary.referralCents },
        { label: `Gold used${summary.goldRedeemed ? ` (${summary.goldRedeemed.toLocaleString()} Gold)` : ''}`, cents: summary.goldDiscountCents },
    ].filter(row => row.cents > 0);
    if (variant === 'checkout') return <dl className="checkout-totals">
        <div><dt>Subtotal</dt><dd>{price(summary.subtotalCents, 'subtotal')}</dd></div>
        {discounts.map(row => <div className="checkout-discount" key={row.label}><dt className={row.coupon ? 'checkout-coupon-label' : undefined}><span title={row.title}>{row.label}</span>{row.coupon && onRemoveCoupon && <button type="button" className="checkout-coupon-remove" disabled={busy} onClick={onRemoveCoupon} aria-label={`Remove ${row.label}`} title="Remove coupon">Remove</button>}</dt><dd>−{price(row.cents)}</dd></div>)}
        <div className="checkout-total"><dt>Total</dt><dd>{price(summary.totalCents, 'total')}</dd></div>
    </dl>;
    return <div className="price-summary">
        <div className="price-row"><span>Subtotal</span><strong>{price(summary.subtotalCents)}</strong></div>
        {discounts.map(row => <div className="price-row price-discount" key={row.label}><span title={row.title}>{row.label}</span><strong>−{price(row.cents)}</strong></div>)}
        <div className="price-row total"><span>Total</span><strong>{price(summary.totalCents)}</strong></div>
    </div>;
}

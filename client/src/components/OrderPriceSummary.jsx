import { Skeleton } from './Skeleton';
import '../styles/OrderPriceSummary.css';
import '../styles/Skeleton.css';

const promotionLabel = promotion => {
    const percent = Number(promotion?.discountPercent);
    const percentage = Number.isFinite(percent) && percent > 0 && percent <= 100
        ? ` (${percent}% off${promotion?.appliesTo === 'BASE_PRICE' ? ' base price' : ''})` : '';
    return `${promotion?.title || 'Promotional discount'}${percentage}`;
};

export default function OrderPriceSummary({ summary, variant = 'default', onRemoveCoupon, onRemoveWallet, settled = false, busy = false, formatPrice }) {
    if (!summary) return <div role="status" aria-label="Loading price summary"><Skeleton height={120} radius={8} /></div>;
    const price = formatPrice || (cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: summary.currency || 'USD' }).format(cents / 100));
    if (variant === 'admin') {
        const breakdown = summary.adminBreakdown;
        const amount = cents => Number.isSafeInteger(cents) ? price(cents) : 'Not recorded';
        const promotion = breakdown?.promotion;
        const discounts = [
            { label: promotionLabel(promotion), cents: breakdown?.promotionCents },
            { label: `Coupon${breakdown?.coupon?.code ? ` (${breakdown.coupon.code})` : ''}`, title: breakdown?.coupon?.title, cents: breakdown?.coupon?.amountCents },
            { label: 'Referral discount', cents: breakdown?.referralCents },
            { label: `Gold used${breakdown?.goldRedeemed ? ` (${breakdown.goldRedeemed.toLocaleString()} Gold)` : ''}`, cents: breakdown?.goldDiscountCents },
        ].filter(row => row.cents > 0);
        const showSubtotal = discounts.length > 0 || breakdown?.addonPriceCents > 0;
        const baseCents = breakdown?.basePriceCents;
        const addonCents = breakdown?.addonPriceCents;
        const grossCents = Number.isSafeInteger(baseCents) && baseCents >= 0
            && Number.isSafeInteger(addonCents) && addonCents >= 0
            && Number.isSafeInteger(baseCents + addonCents) ? baseCents + addonCents : null;
        return <div className="admin-price-summary">
            <dl className="price-summary price-summary--admin">
                <div className="price-row"><dt>{showSubtotal ? 'Subtotal' : 'Base price'}</dt><dd>{amount(showSubtotal ? grossCents : baseCents)}</dd></div>
                {addonCents > 0 && <div className="price-row"><dt>Add-ons (included)</dt><dd>{price(addonCents)}</dd></div>}
                {discounts.map(row => <div className="price-row price-discount" key={row.label}><dt title={row.title}>{row.label}</dt><dd>−{price(row.cents)}</dd></div>)}
                <div className="price-row total"><dt>Total</dt><dd>{amount(breakdown ? breakdown.totalCents : summary.totalCents)}</dd></div>
            </dl>
            {breakdown?.hasUnitemizedAdjustment && <p className="admin-price-summary-note">Some price adjustments were not itemized in the saved order.</p>}
        </div>;
    }
    const discounts = [
        { label: promotionLabel(summary.promotion), cents: summary.promotionCents },
        { label: `Coupon${summary.coupon?.code ? ` (${summary.coupon.code})` : ''}`, title: summary.coupon?.title, cents: summary.coupon?.amountCents, coupon: true },
        { label: 'Referral discount', cents: summary.referralCents },
        { label: `Gold used${summary.goldRedeemed ? ` (${summary.goldRedeemed.toLocaleString()} Gold)` : ''}`, cents: summary.goldDiscountCents },
    ].filter(row => row.cents > 0);
    const walletApplied = Number.isSafeInteger(summary.walletAppliedCents) && summary.walletAppliedCents > 0 ? summary.walletAppliedCents : 0;
    const cardAmount = Number.isSafeInteger(summary.cardAmountCents) && summary.cardAmountCents >= 0
        ? summary.cardAmountCents : Math.max(0, summary.totalCents - walletApplied);
    if (variant === 'checkout') return <dl className="checkout-totals">
        {(discounts.length > 0 || walletApplied > 0) && <div><dt>Subtotal</dt><dd>{price(summary.subtotalCents, 'subtotal')}</dd></div>}
        {discounts.map(row => <div className="checkout-discount" key={row.label}><dt className={row.coupon ? 'checkout-coupon-label' : undefined}><span title={row.title}>{row.label}</span>{row.coupon && onRemoveCoupon && <button type="button" className="checkout-coupon-remove" disabled={busy} onClick={onRemoveCoupon} aria-label={`Remove ${row.label}`} title="Remove coupon">Remove</button>}</dt><dd>−{price(row.cents)}</dd></div>)}
        {!settled && walletApplied > 0 && <div className="checkout-wallet-deduction"><dt className="checkout-coupon-label"><span>Wallet balance</span>{onRemoveWallet && <button type="button" className="checkout-coupon-remove" disabled={busy} onClick={onRemoveWallet} aria-label="Remove wallet balance">Remove</button>}</dt><dd>−{price(walletApplied)}</dd></div>}
        <div className="checkout-total"><dt>{!settled && walletApplied > 0 ? 'Left to pay' : 'Total'}</dt><dd>{price(settled ? summary.totalCents : cardAmount, 'total')}</dd></div>
        {settled && walletApplied > 0 && <><div className="checkout-wallet-tender"><dt>Paid by wallet</dt><dd>{price(walletApplied)}</dd></div>{cardAmount > 0 && <div className="checkout-wallet-tender"><dt>Paid by card</dt><dd>{price(cardAmount)}</dd></div>}</>}
    </dl>;
    return <div className="price-summary">
        {discounts.length > 0 && <div className="price-row"><span>Subtotal</span><strong>{price(summary.subtotalCents)}</strong></div>}
        {discounts.map(row => <div className="price-row price-discount" key={row.label}><span title={row.title}>{row.label}</span><strong>−{price(row.cents)}</strong></div>)}
        <div className="price-row total"><span>Total</span><strong>{price(summary.totalCents)}</strong></div>
    </div>;
}

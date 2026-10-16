import { useEffect, useState } from 'react';
import { getOrderRating, submitOrderRating } from '../api/orders';
import '../styles/OrderRating.css';

export default function OrderRating({ orderId }) {
    const [data, setData] = useState(null);
    const [stars, setStars] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        getOrderRating(orderId).then(result => { if (active) { setData(result); setError(''); } })
            .catch(error => { if (active) setError(error.message); });
        return () => { active = false; };
    }, [orderId, attempt]);
    async function submit(event) {
        event.preventDefault();
        if (!stars || busy) return;
        setBusy(true); setError('');
        try {
            const result = await submitOrderRating(orderId, stars);
            setData({ rating: result.rating, eligible: false });
        } catch (error) {
            setError(error.message);
            // A concurrent tab may already have submitted this order's review.
            if (error.status === 409) setAttempt(value => value + 1);
        } finally { setBusy(false); }
    }
    if (data && !data.rating && !data.eligible) return null;
    return <section className="order-rating" aria-labelledby="order-rating-heading">
        <div><p className="order-rating-eyebrow">ORDER COMPLETE</p><h2 id="order-rating-heading">{data?.rating ? 'Thanks for your review' : 'How was your boost?'}</h2><p>{data?.rating ? 'Your feedback contributes to your booster team’s customer rating.' : 'Rate the booster team that completed your order.'}</p></div>
        {error && <div className="order-rating-error" role="alert">{error}{!data && <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</div>}
        {!data && !error && <p role="status">Loading your review…</p>}
        {data?.rating ? <p className="order-rating-saved" aria-label={`Your rating: ${data.rating.stars} out of 5 stars`}><span aria-hidden="true">{'★'.repeat(data.rating.stars)}{'☆'.repeat(5 - data.rating.stars)}</span><strong>{data.rating.stars} / 5</strong></p> : data?.eligible && <form onSubmit={submit}>
            <fieldset disabled={busy}><legend>Your rating</legend><div className="order-rating-stars">{[1, 2, 3, 4, 5].map(value => <label key={value} className={stars >= value ? 'selected' : ''}>
                <input type="radio" name="order-rating" value={value} checked={stars === value} onChange={() => setStars(value)} required aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`} /><span aria-hidden="true">★</span>
            </label>)}</div></fieldset>
            <div className="order-rating-submit"><span>{stars ? `${stars} of 5 stars · One review per order` : 'Choose 1–5 stars'}</span><button disabled={!stars || busy}>{busy ? 'Submitting…' : 'Submit review'}</button></div>
        </form>}
    </section>;
}

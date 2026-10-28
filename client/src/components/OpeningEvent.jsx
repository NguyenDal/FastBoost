import ArrowUpRightIcon from './ArrowUpRightIcon';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  OPENING_CAMPAIGN,
  openingCampaignEndLabel,
  openingCampaignPhase,
  openingCampaignStartLabel,
  openingCampaignTimeLeft,
  openingCampaignWindowLabel,
  openingSavings,
} from '../data/openingCampaign';
import '../styles/OpeningEvent.css';

const usd = amount => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

function useCampaignClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function Status({ phase }) {
  const text = { upcoming: `Starts ${openingCampaignStartLabel()}`, active: 'Live now', ended: 'Event ended' }[phase];
  return <span className={`opening-event-status is-${phase}`}><span aria-hidden="true" />{text}</span>;
}

function Countdown({ now }) {
  const phase = openingCampaignPhase(now);
  const left = openingCampaignTimeLeft(now);
  if (!left) return <p className="opening-event-clock-ended">The opening month event has ended.</p>;
  return <div className="opening-event-clock" aria-label={`${phase === 'upcoming' ? 'Starts' : 'Ends'} in ${left.days} days, ${left.hours} hours, ${left.minutes} minutes`}>
    <span className="opening-event-clock-title">{phase === 'upcoming' ? 'Opening in' : 'Ends in'}</span>
    <div><span><strong>{String(left.days).padStart(2, '0')}</strong><small>days</small></span><i>:</i><span><strong>{String(left.hours).padStart(2, '0')}</strong><small>hours</small></span><i>:</i><span><strong>{String(left.minutes).padStart(2, '0')}</strong><small>minutes</small></span></div>
  </div>;
}

export function OpeningEventCard({ compact = false }) {
  const now = useCampaignClock();
  const phase = openingCampaignPhase(now);
  return <article className={`opening-event-card${compact ? ' is-compact' : ''}`}>
    <Link to={`/hub/events/${OPENING_CAMPAIGN.slug}`} className="opening-event-card-link" aria-label="View opening month event details">
      <span className="opening-event-poster-label">{phase === 'ended' ? 'Past event' : OPENING_CAMPAIGN.title}</span>
      <h2 className="opening-event-poster-discount">{OPENING_CAMPAIGN.discountPercent}% OFF</h2>
      <p className="opening-event-poster-dates">{openingCampaignWindowLabel({ short: true })}</p>
      <p className="opening-event-poster-services">LoL &amp; TFT base services</p>
      <span className="opening-event-card-action">View event <span aria-hidden="true"><ArrowUpRightIcon /></span></span>
    </Link>
  </article>;
}

export function OpeningEventDetail() {
  const now = useCampaignClock();
  const phase = openingCampaignPhase(now);
  const [basePrice, setBasePrice] = useState(100);
  const estimate = openingSavings(basePrice);
  const offerDescription = phase === 'ended'
    ? `FastBoost’s first month offer gave ${OPENING_CAMPAIGN.discountPercent}% off the base price of eligible ${OPENING_CAMPAIGN.eligibleGames.join(' and ')} services during the event.`
    : phase === 'active'
      ? `To mark FastBoost’s opening month, the base price of eligible ${OPENING_CAMPAIGN.eligibleGames.join(' and ')} services is ${OPENING_CAMPAIGN.discountPercent}% off during the event.`
      : `To mark FastBoost’s opening month, the base price of eligible ${OPENING_CAMPAIGN.eligibleGames.join(' and ')} services is planned to be ${OPENING_CAMPAIGN.discountPercent}% off during the event.`;
  return <div className="opening-event-detail">
    <header className="opening-event-hero">
      <div className="hub-page-inner">
        <Link to="/hub?category=events" className="hub-back">← Back to events</Link>
        <div className="opening-event-hero-content"><span className="opening-event-eyebrow">The FastBoost opening event</span><Status phase={phase} /><h1><span>{OPENING_CAMPAIGN.discountPercent}%</span> off<br />opening month</h1><p>{openingCampaignWindowLabel()}</p></div>
      </div>
    </header>
    <div className="opening-event-detail-grid hub-page-inner">
      <section className="opening-event-information">
        <span className="opening-event-section-label">The event</span>
        <h2>A new chapter starts here.</h2>
        <p>{offerDescription}</p>
        <div className="opening-event-keypoints">
          <div><span>01</span><div><h3>When</h3><p>{openingCampaignWindowLabel()}. It starts at 00:00 UTC on {openingCampaignStartLabel()} and ends at 00:00 UTC on {openingCampaignEndLabel()}.</p></div></div>
          <div><span>02</span><div><h3>Where it applies</h3><p>{OPENING_CAMPAIGN.eligibleGames.join(' and ')} base service prices. Add-ons are excluded.</p></div></div>
          <div><span>03</span><div><h3>Your final total</h3><p>Review the amount shown at checkout before paying. The checkout quote controls your order.</p></div></div>
        </div>
      </section>
      <aside className="opening-event-side">
        <Countdown now={now} />
        <div className="opening-event-estimator">
          <span className="opening-event-section-label">Savings preview</span>
          <h2>{phase === 'ended' ? 'What did' : 'What could'} {OPENING_CAMPAIGN.discountPercent}% look like?</h2>
          <p>Move the slider to preview the discount on an example base service price.</p>
          <label htmlFor="opening-event-base-price">Example base price <strong>{usd(basePrice)}</strong></label>
          <input id="opening-event-base-price" type="range" min="20" max="500" step="5" value={basePrice} onChange={event => setBasePrice(Number(event.target.value))} />
          <div className="opening-event-range"><span>$20</span><span>$500</span></div>
          <div className="opening-event-estimate-row"><span>Estimated savings</span><strong>−{usd(estimate.savings)}</strong></div>
          <div className="opening-event-estimate-row is-total"><span>Estimated base price</span><strong>{usd(estimate.discountedBase)}</strong></div>
          <p className="opening-event-estimate-note">{phase === 'ended' ? 'Historical illustration only; this offer has ended. ' : 'Illustration only, in USD. '}Excludes add-ons and any other checkout adjustments. The final checkout quote is authoritative.</p>
        </div>
      </aside>
    </div>
  </div>;
}

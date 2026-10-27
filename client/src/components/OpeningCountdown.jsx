import { Fragment, useEffect, useState } from 'react';
import { OPENING_CAMPAIGN } from '../data/openingCampaign';

const openingTime = Date.parse(OPENING_CAMPAIGN.startsAt);
const openingDate = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric',
}).format(openingTime);

function countdownParts(now) {
  const total = Math.max(0, Math.ceil((openingTime - now) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    total,
  };
}

function SlidingDigit({ digit }) {
  const [display, setDisplay] = useState(() => ({ current: digit, previous: null }));
  if (display.current !== digit) {
    setDisplay({ current: digit, previous: display.current });
  }

  useEffect(() => {
    if (display.previous === null) return undefined;
    const timeout = window.setTimeout(() => {
      setDisplay(current => current.current === display.current
        ? { ...current, previous: null }
        : current);
    }, 380);
    return () => window.clearTimeout(timeout);
  }, [display]);

  return <span className="opening-countdown-digit-window">
    {display.previous !== null && <span className="opening-countdown-digit-out">{display.previous}</span>}
    <span className={display.previous !== null ? 'opening-countdown-digit-in' : ''}>{display.current}</span>
  </span>;
}

function SlidingNumber({ value }) {
  return <strong className="opening-countdown-number">{String(value).padStart(2, '0').split('').map((digit, index) => <SlidingDigit key={index} digit={digit} />)}</strong>;
}

export default function OpeningCountdown() {
  const [now, setNow] = useState(() => Date.now());
  const remaining = countdownParts(now);
  const isOpen = remaining.total === 0;

  useEffect(() => {
    if (isOpen) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  if (isOpen) {
    return <div className="opening-countdown is-open" role="status">
      <span className="opening-countdown-label"><span className="opening-countdown-dot" aria-hidden="true" />Now live</span>
      <strong className="opening-countdown-open">We’re open</strong>
    </div>;
  }

  const units = [
    ['DAYS', remaining.days],
    ['HRS', remaining.hours],
    ['MIN', remaining.minutes],
    ['SEC', remaining.seconds],
  ];
  return <div
    className="opening-countdown"
    role="timer"
    aria-live="off"
    aria-label={`FastBoost opens ${openingDate} at 00:00 UTC. Opens in ${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, and ${remaining.seconds} seconds`}
  >
    <span className="opening-countdown-label" aria-hidden="true"><span className="opening-countdown-dot" />Opens in</span>
    <span className="opening-countdown-units" aria-hidden="true">{units.map(([label, value], index) => <Fragment key={label}>{index > 0 && <span className="opening-countdown-separator">:</span>}<span className="opening-countdown-unit"><SlidingNumber value={value} /><small>{label}</small></span></Fragment>)}</span>
    <time className="opening-countdown-time" dateTime={OPENING_CAMPAIGN.startsAt} aria-hidden="true">{openingDate} · 00:00 UTC</time>
  </div>;
}

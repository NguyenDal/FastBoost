import { Fragment, useEffect, useState } from 'react';
import { SITE_OPENING_AT, openingCountdownParts, openingLocalTimeLabel } from '../utils/openingCountdown';
import { resolveUserTimeZone } from '../utils/userTimeZone';

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
  const remaining = openingCountdownParts(now);
  const timeZone = resolveUserTimeZone();
  const openingLabel = openingLocalTimeLabel({ timeZone });
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
    aria-label={`FastBoost opens ${openingLabel}. Opens in ${remaining.days} days, ${remaining.hours} hours, ${remaining.minutes} minutes, and ${remaining.seconds} seconds`}
  >
    <span className="opening-countdown-label" aria-hidden="true"><span className="opening-countdown-dot" />Opens in</span>
    <span className="opening-countdown-units" aria-hidden="true">{units.map(([label, value], index) => <Fragment key={label}>{index > 0 && <span className="opening-countdown-separator">:</span>}<span className="opening-countdown-unit"><SlidingNumber value={value} /><small>{label}</small></span></Fragment>)}</span>
    <time className="opening-countdown-time" dateTime={SITE_OPENING_AT} data-time-zone={timeZone} aria-hidden="true">{openingLabel}</time>
  </div>;
}

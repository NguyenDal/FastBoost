import { resolveUserTimeZone } from './userTimeZone.js';

// Site launch: November 1, 2026 at midnight in America/Winnipeg (UTC−5).
// Keep the launch instant separate from the opening promotion's pricing window.
export const SITE_OPENING_AT = '2026-11-01T05:00:00.000Z';

const openingTime = Date.parse(SITE_OPENING_AT);

export function openingCountdownParts(now = Date.now()) {
  const total = Math.max(0, Math.ceil((openingTime - now) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
    total,
  };
}

export function openingLocalTimeLabel({ locale, timeZone } = {}) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: resolveUserTimeZone(timeZone),
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(openingTime);
}

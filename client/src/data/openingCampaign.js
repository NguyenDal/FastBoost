// The opening offer uses UTC boundaries. End is exclusive: Dec 1, 00:00 UTC.
export const OPENING_CAMPAIGN = Object.freeze({
  slug: 'opening-month',
  title: 'Opening month',
  discountPercent: 15,
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
  eligibleGames: Object.freeze(['League of Legends', 'Teamfight Tactics']),
});

export function openingCampaignStartLabel() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(OPENING_CAMPAIGN.startsAt));
}

export function openingCampaignEndLabel() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(OPENING_CAMPAIGN.endsAt));
}

export function openingCampaignWindowLabel({ short = false } = {}) {
  const start = new Date(OPENING_CAMPAIGN.startsAt);
  const lastDay = new Date(Date.parse(OPENING_CAMPAIGN.endsAt) - 1);
  const month = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: short ? 'short' : 'long' }).format(start);
  return `${month} ${start.getUTCDate()}–${lastDay.getUTCDate()}, ${start.getUTCFullYear()} UTC`;
}

export function openingCampaignPhase(now = Date.now()) {
  const current = typeof now === 'number' ? now : new Date(now).getTime();
  if (current < Date.parse(OPENING_CAMPAIGN.startsAt)) return 'upcoming';
  if (current < Date.parse(OPENING_CAMPAIGN.endsAt)) return 'active';
  return 'ended';
}

export function openingCampaignTimeLeft(now = Date.now()) {
  const phase = openingCampaignPhase(now);
  if (phase === 'ended') return null;
  const target = phase === 'upcoming' ? OPENING_CAMPAIGN.startsAt : OPENING_CAMPAIGN.endsAt;
  const current = typeof now === 'number' ? now : new Date(now).getTime();
  const minutes = Math.max(0, Math.ceil((Date.parse(target) - current) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return { days, hours, minutes: minutes % 60 };
}

export function openingSavings(baseSubtotal) {
  const amount = Number(baseSubtotal);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const savings = Math.round(amount * OPENING_CAMPAIGN.discountPercent) / 100;
  const discountedBase = Math.round((amount - savings) * 100) / 100;
  return { savings, discountedBase };
}

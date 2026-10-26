const OWNED_BUCKET = /^fastboost-assets\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i;
const S3_ENDPOINT = /^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i;
let lastRefreshRequest = 0;
export const AVATAR_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export function shouldRefreshAvatarData(lastUpdatedAt, now = Date.now()) {
  return !Number.isFinite(lastUpdatedAt) || now - lastUpdatedAt >= AVATAR_REFRESH_INTERVAL_MS;
}

function parsedAvatarUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('/assets/')) return { local: trimmed };
  if (!/^https:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return { url };
  } catch { return null; }
}

function isOwnedS3Url(url) {
  return OWNED_BUCKET.test(url.hostname) || (S3_ENDPOINT.test(url.hostname) && url.pathname.startsWith('/fastboost-assets/'));
}

function isOwnedProfilePath(url) {
  const key = OWNED_BUCKET.test(url.hostname) ? url.pathname.slice(1) : url.pathname.slice('/fastboost-assets/'.length);
  return /^profiles\/[A-Za-z0-9_-]{1,128}\/[A-Za-z0-9._-]{1,200}\.(?:jpg|jpeg|png|gif|webp)$/i.test(key);
}

export function isSignedAvatarUrl(value) {
  const parsed = parsedAvatarUrl(value);
  return Boolean(parsed?.url && isOwnedS3Url(parsed.url) && isOwnedProfilePath(parsed.url) &&
    parsed.url.searchParams.get('X-Amz-Signature') && parsed.url.searchParams.get('X-Amz-Expires'));
}

export function safeAvatarSrc(value) {
  const parsed = parsedAvatarUrl(value);
  if (!parsed) return '';
  if (parsed.local) return parsed.local;
  if (isOwnedS3Url(parsed.url) && !isSignedAvatarUrl(value)) return '';
  return parsed.url.href;
}

export function requestAvatarRefresh(value) {
  if (!isSignedAvatarUrl(value) || typeof window === 'undefined') return false;
  const now = Date.now();
  if (now - lastRefreshRequest < 3000) return false;
  lastRefreshRequest = now;
  window.dispatchEvent(new Event('avatar:refresh'));
  return true;
}

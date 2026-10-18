// Only routes that intentionally request a return from the home-page login
// modal belong here. Keep the query and fragment for links to order ratings.
export function authReturnPath(value) {
  if (typeof value !== "string" || value.length > 2048 || /[\\\s]/.test(value)) return null;
  if ([...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  return /^\/(?:provider-agreement|provider\/(?:portal|workspace|contracts\/[a-zA-Z0-9-]+)|(?:match|checkout)\/[a-zA-Z0-9_-]+|payment\/(?:success|cancelled)\/[a-zA-Z0-9_-]+)(?:\?[^#]*)?(?:#.*)?$/.test(value) ? value : null;
}

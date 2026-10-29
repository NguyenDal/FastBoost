export function resolveUserTimeZone(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  // Some embedded browsers report no region and format using a fixed OS offset.
  // Use the business's region only in that case; preserve a viewer's valid zone.
  return typeof timeZone === 'string' && timeZone.trim() ? timeZone : 'America/Winnipeg';
}

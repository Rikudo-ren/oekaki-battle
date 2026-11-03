export function remainingMs(startedAt, durationSeconds, now) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.max(0, startedAt + durationSeconds * 1000 - now);
}

// Every correct answer is scored from its own server timestamp. Rank never
// changes the award. Timed games use equal-sized remaining-time bands.
export function scoreForClaim(claim, settings = {}) {
  if (!claim || claim.kind === 'timeout' || claim.kind === 'skip') return 0;
  const flat = Number.isInteger(settings.flatPoints) ? settings.flatPoints : 1;
  const { startedAt, duration, at } = claim;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(at) || !Number.isFinite(startedAt)) return flat;
  const min = Number.isInteger(settings.minPoints) ? settings.minPoints : 1;
  const max = Number.isInteger(settings.maxPoints) ? settings.maxPoints : 5;
  const left = remainingMs(startedAt, duration, at);
  const bands = max - min + 1;
  return Math.max(min, Math.min(max, min + Math.ceil(left / (duration * 1000) * bands) - 1));
}

// Completed claims keep their own start and duration so scores stay stable
// even after the room has moved on to another turn.
export function remainingMs(startedAt, durationSeconds, now) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  return Math.max(0, startedAt + durationSeconds * 1000 - now);
}

export function scoreForClaim(claim) {
  if (!claim || claim.kind === 'timeout') return 0;
  const { startedAt, duration, at } = claim;
  // Unlimited turns and legacy claims preserve the original 1-point rule.
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(at) || !Number.isFinite(startedAt)) return 1;
  const left = remainingMs(startedAt, duration, at);
  return Math.max(1, Math.min(5, Math.ceil(left / (duration * 1000) * 5)));
}

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

// Thirds are measured from the start of the turn, not from a passed topic.
// A correct answer exactly on a boundary belongs to the next band.
export function awardForClaim(claim, settings = {}, role = 'answer') {
  if (!claim || claim.kind === 'timeout' || claim.kind === 'skip') return 0;
  if (settings.scoreMode !== 'thirds') return role === 'answer' ? scoreForClaim(claim, settings) : 0;
  const timed = Number.isFinite(claim.duration) && claim.duration > 0 && Number.isFinite(claim.startedAt) && Number.isFinite(claim.at);
  if (!timed) return role === 'answer' ? (settings.flatPoints ?? 1) : (settings.flatDrawerPoints ?? 0);
  const band = timeBand(claim.startedAt, claim.duration, claim.at);
  const defaults = role === 'drawer' ? [15, 7, 3] : [20, 10, 5];
  const keys = role === 'drawer' ? ['drawerEarly', 'drawerMiddle', 'drawerLate'] : ['answerEarly', 'answerMiddle', 'answerLate'];
  return Number.isInteger(settings[keys[band]]) ? settings[keys[band]] : defaults[band];
}

// Keep the visible gauge and scoring boundaries in sync.
export function timeBand(startedAt, duration, at) {
  return Math.max(0, Math.min(2, Math.floor((at - startedAt) * 3 / (duration * 1000))));
}

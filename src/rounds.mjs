export const COUNTDOWN_MS = 3000;
export const REVEAL_DELAY_MS = 2000;

export function turnStart(room) {
  return Number.isFinite(room?.turnStartedAt) ? room.turnStartedAt + COUNTDOWN_MS : null;
}
export function countdownRemaining(room, now) {
  const start = turnStart(room);
  return start === null ? null : Math.max(0, start - now);
}
export function resultReady(claim, now) {
  return Number.isFinite(claim?.ended?.at) && now >= claim.ended.at + REVEAL_DELAY_MS;
}
export function correctEntries(claim) {
  return Object.entries(claim?.slots || {}).sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value).filter(Boolean);
}
export function nextSlot(claim, maxCorrect) {
  const slots=claim?.slots || {};
  for(let i=0;i<maxCorrect;i++) if(!slots[`s${i}`]) return `s${i}`;
  return null;
}

// Preserve already-announced turns; late arrivals receive their configured
// number of drawing turns at the end of the existing schedule.
export function extendSchedule(schedule, players, rounds) {
  const existing = Array.isArray(schedule) ? schedule : [];
  const scheduled = new Set(existing);
  const newcomers = Object.keys(players || {}).filter(uid => !scheduled.has(uid)).sort();
  return [...existing, ...Array.from({length: rounds}, () => newcomers).flat()];
}

// Keep schedule slots and turn IDs stable, but never start an offline player's turn.
export function nextOnlineScheduleIndex(room, schedule, start) {
  for (let i=start;i<schedule.length;i++) {
    const uid=schedule[i];
    if (room.players?.[uid] && room.online?.[uid] && Object.keys(room.online[uid]).length) return i;
  }
  return -1;
}

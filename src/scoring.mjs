import { awardForClaim } from './timing.mjs';
import { correctEntries, resultReady } from './rounds.mjs';

// Passed topic IDs replace the schedule slot. No successful claim can be lost:
// passing is allowed only before the first correct answer.
export function drawerForTurn(room, turn) {
  const index = (room.schedule || []).findIndex((_, i) => String(room.turnIds?.[i] ?? i) === String(turn));
  return index < 0 ? null : room.schedule[index];
}
export function scoreDeltas(room, turn, claim, drawers = null) {
  const deltas = {};
  const drawer = drawers ? drawers.get(String(turn)) : drawerForTurn(room, turn);
  for (const entry of correctEntries(claim)) {
    deltas[entry.uid] = (deltas[entry.uid] || 0) + awardForClaim(entry, room, 'answer');
    if (drawer) deltas[drawer] = (deltas[drawer] || 0) + awardForClaim(entry, room, 'drawer');
  }
  return deltas;
}
export function scoresForRoom(room, claims, now, omitTurn = null) {
  const scores = Object.fromEntries(Object.entries(room.players || {}).map(([uid, p]) => [uid, p.score || 0]));
  // Long-running matches accumulate turns; index the schedule once rather
  // than scanning it separately for every claim on every UI update.
  const drawers = new Map((room.schedule || []).map((uid, i) => [String(room.turnIds?.[i] ?? i), uid]));
  for (const [turn, claim] of Object.entries(claims || {})) {
    if (String(turn) === String(omitTurn) || !claim?.ended || claim.ended.reason === 'pass' || (claim.ended.reason !== 'skip' && !resultReady(claim, now)) || !Number.isFinite(claim.ended.at)) continue;
    for (const [uid, points] of Object.entries(scoreDeltas(room, turn, claim, drawers))) if (uid in scores) scores[uid] += points;
  }
  return scores;
}
export function ranking(room, scores) {
  const order = room.order || [];
  const players = Object.keys(room.players || {}).sort((a,b) => scores[b] - scores[a] || (order.indexOf(a) < 0 ? Infinity : order.indexOf(a)) - (order.indexOf(b) < 0 ? Infinity : order.indexOf(b)) || a.localeCompare(b));
  return players.map((uid, index) => ({uid, rank: index && scores[uid] === scores[players[index-1]] ? null : index + 1, score: scores[uid]})).map((item, i, items) => ({...item, rank: item.rank ?? items.findIndex(x => x.score === item.score) + 1}));
}

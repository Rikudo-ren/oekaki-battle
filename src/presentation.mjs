// Visual pacing is separate from the RTDB's two-second secret-read rule.
// Every stage is derived from the server timestamp so late arrivals see the
// current stage instead of restarting an old animation.
export const END_SCENE_MS = 3200;
export const ANSWER_SCENE_MS = 2600;
export const SCORE_SCENE_MS = 7000;
// Relative to the scoreboard, not the beginning of the turn-end sequence.
export const SCORE_BONUS_MS = 900;
export const SCORE_COUNT_MS = 1500;
export const SCORE_COUNT_DURATION_MS = 1400;
export const SCORE_MOVE_MS = 3300;
export const SCORE_SETTLED_MS = 4500;
export function scoreStage(age) {
 if (age < SCORE_BONUS_MS) return 'ready';
 if (age < SCORE_COUNT_MS) return 'bonus';
 if (age < SCORE_MOVE_MS) return 'count';
 if (age < SCORE_SETTLED_MS) return 'move';
 return 'settled';
}
export function animatedScore(before, after, age, reducedMotion = false) {
 if (reducedMotion) return after;
 const t=Math.max(0,Math.min(1,(age-SCORE_COUNT_MS)/SCORE_COUNT_DURATION_MS));
 const eased=1-(1-t)**3;
 return Math.round(before+(after-before)*eased);
}
export const RESULT_SCENE_MS = END_SCENE_MS + ANSWER_SCENE_MS + SCORE_SCENE_MS;
export const FINAL_SCENE_MS = 4500;
export const GO_SCENE_MS = 600;
export function resultScene(claim, now) {
 if (!Number.isFinite(claim?.ended?.at) || !Number.isFinite(now) || (claim.ended.reason === 'pass' || claim.ended.reason === 'skip')) return null;
 const age = Math.max(0, now - claim.ended.at);
 if (age < END_SCENE_MS) return 'end';
 if (age < END_SCENE_MS + ANSWER_SCENE_MS) return 'answer';
 if (age < RESULT_SCENE_MS) return 'score';
 return 'done';
}
export function finalSceneVisible(room, now) {
 return room?.phase === 'finished' && Number.isFinite(room.finishedAt) && Number.isFinite(now) && now >= room.finishedAt - 1000 && now < room.finishedAt + FINAL_SCENE_MS;
}

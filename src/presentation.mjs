// Visual pacing is separate from the RTDB's two-second secret-read rule.
// Every stage is derived from the server timestamp so late arrivals see the
// current stage instead of restarting an old animation.
export const END_SCENE_MS = 3200;
export const ANSWER_SCENE_MS = 2600;
export const SCORE_SCENE_MS = 5000;
export const RESULT_SCENE_MS = END_SCENE_MS + ANSWER_SCENE_MS + SCORE_SCENE_MS;
export const FINAL_SCENE_MS = 4500;
export const GO_SCENE_MS = 600;
export function resultScene(claim, now) {
 if (!Number.isFinite(claim?.ended?.at) || !Number.isFinite(now) || claim.ended.reason === 'pass') return null;
 const age = Math.max(0, now - claim.ended.at);
 if (age < END_SCENE_MS) return 'end';
 if (age < END_SCENE_MS + ANSWER_SCENE_MS) return 'answer';
 if (age < RESULT_SCENE_MS) return 'score';
 return 'done';
}
export function finalSceneVisible(room, now) {
 return room?.phase === 'finished' && Number.isFinite(room.finishedAt) && Number.isFinite(now) && now >= room.finishedAt - 1000 && now < room.finishedAt + FINAL_SCENE_MS;
}

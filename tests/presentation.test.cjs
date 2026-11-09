const {test}=require('node:test');
const assert=require('node:assert/strict');
test('終了・答え・得点は共通の終了時刻から段階的に進む',async()=>{
 const {resultScene,END_SCENE_MS,ANSWER_SCENE_MS,RESULT_SCENE_MS}=await import('../src/presentation.mjs');
 const claim={ended:{at:10000,reason:'full'}};
 assert.equal(resultScene(claim,10000),'end');assert.equal(resultScene(claim,10000+END_SCENE_MS-1),'end');
 assert.equal(resultScene(claim,10000+END_SCENE_MS),'answer');assert.equal(resultScene(claim,10000+END_SCENE_MS+ANSWER_SCENE_MS-1),'answer');
 assert.equal(resultScene(claim,10000+END_SCENE_MS+ANSWER_SCENE_MS),'score');assert.equal(resultScene(claim,10000+RESULT_SCENE_MS-1),'score');assert.equal(resultScene(claim,10000+RESULT_SCENE_MS),'done');
 assert.equal(resultScene({ended:{at:10000,reason:'pass'}},12000),null);assert.equal(resultScene({},10000),null);
});
test('最終結果演出は終了時刻がある時だけ表示し、古い試合では再生しない',async()=>{
 const {finalSceneVisible,FINAL_SCENE_MS}=await import('../src/presentation.mjs');
 assert.equal(finalSceneVisible({phase:'finished',finishedAt:1000},1000),true);assert.equal(finalSceneVisible({phase:'finished',finishedAt:1000},1000+FINAL_SCENE_MS),false);assert.equal(finalSceneVisible({phase:'finished'},1000),false);assert.equal(finalSceneVisible({phase:'playing',finishedAt:1000},1000),false);
});
test('得点カウントは時間に従い、上下・同点・大きな点数も正確に止まる',async()=>{
 const {scoreStage,animatedScore,SCORE_BONUS_MS,SCORE_COUNT_MS,SCORE_COUNT_DURATION_MS,SCORE_MOVE_MS,SCORE_SETTLED_MS}=await import('../src/presentation.mjs');
 assert.equal(scoreStage(SCORE_BONUS_MS-1),'ready');assert.equal(scoreStage(SCORE_BONUS_MS),'bonus');assert.equal(scoreStage(SCORE_COUNT_MS),'count');assert.equal(scoreStage(SCORE_MOVE_MS),'move');assert.equal(scoreStage(SCORE_SETTLED_MS),'settled');
 assert.equal(animatedScore(10,30,SCORE_COUNT_MS),10);assert.ok(animatedScore(10,30,SCORE_COUNT_MS+500)>10);assert.ok(animatedScore(10,30,SCORE_COUNT_MS+500)<30);assert.equal(animatedScore(10,30,SCORE_COUNT_MS+SCORE_COUNT_DURATION_MS),30);
 assert.equal(animatedScore(10,10,SCORE_COUNT_MS+500),10);assert.equal(animatedScore(99,23,SCORE_COUNT_MS+SCORE_COUNT_DURATION_MS),23);assert.equal(animatedScore(90000,100000,SCORE_COUNT_MS+SCORE_COUNT_DURATION_MS),100000);assert.equal(animatedScore(2,22,0,true),22);
});
test('不在でスキップしたターンには結果演出を出さない',async()=>{
 const {resultScene}=await import('../src/presentation.mjs');for(const delta of [0,3200,5800,15000])assert.equal(resultScene({ended:{reason:'skip',at:1000}},1000+delta),null);
});

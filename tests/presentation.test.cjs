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

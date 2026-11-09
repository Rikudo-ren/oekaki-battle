const {test}=require('node:test');
const assert=require('node:assert/strict');

test('カウントダウンは3秒、結果は終了の2秒後から',async()=>{
  const {countdownRemaining,turnStart,resultReady}=await import('../src/rounds.mjs');
  assert.equal(countdownRemaining({turnStartedAt:1000},1000),3000);
  assert.equal(countdownRemaining({turnStartedAt:1000},4000),0);
  assert.equal(turnStart({turnStartedAt:1000}),4000);
  assert.equal(resultReady({ended:{at:9000}},10999),false);
  assert.equal(resultReady({ended:{at:9000}},11000),true);
});
test('正解枠は順序どおり、上限を超えない',async()=>{
  const {nextSlot,correctEntries}=await import('../src/rounds.mjs');
  const claim={slots:{s0:{uid:'a'},s1:{uid:'b'}}};
  assert.equal(nextSlot(claim,2),null);
  assert.equal(nextSlot(claim,3),'s2');
  assert.deepEqual(correctEntries(claim).map(x=>x.uid),['a','b']);
});
test('途中参加者の描画順を末尾に追加し、既存の順序や周回数を維持する',async()=>{
  const {extendSchedule}=await import('../src/rounds.mjs');
  const initial=['a','b','a','b'];
  assert.deepEqual(extendSchedule(initial,{a:{},b:{},c:{}},2),['a','b','a','b','c','c']);
  assert.deepEqual(extendSchedule(['a','b','a','b','c','c'],{a:{},b:{},c:{},d:{}},2),['a','b','a','b','c','c','d','d']);
});
test('不在者を飛ばし、再接続している人や元の順番は維持する',async()=>{
 const {nextOnlineScheduleIndex}=await import('../src/rounds.mjs');const room={players:{a:{},b:{},c:{}},online:{a:{tab:true},c:{tab:true}}};const schedule=['a','b','c','b'];
 assert.equal(nextOnlineScheduleIndex(room,schedule,1),2);assert.equal(nextOnlineScheduleIndex(room,schedule,3),-1);room.online.b={newTab:true};assert.equal(nextOnlineScheduleIndex(room,schedule,1),1);delete room.players.c;assert.equal(nextOnlineScheduleIndex(room,schedule,2),3);
});

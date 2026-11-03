const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('制限時間なしは従来通り1点、時間切れは0点', async () => {
  const { scoreForClaim, remainingMs } = await import('../src/timing.mjs');
  assert.equal(scoreForClaim({kind:'answer',duration:0,startedAt:1000,at:5000}),1);
  assert.equal(scoreForClaim({uid:'legacy',answer:'ねこ'}),1);
  assert.equal(scoreForClaim({kind:'timeout',duration:30,startedAt:1000,at:31000}),0);
  assert.equal(remainingMs(1000,0,5000),null);
});
test('時間ありは早いほど高得点、期限の直前まで最低1点', async () => {
  const { scoreForClaim, remainingMs } = await import('../src/timing.mjs');
  const answer=at=>({kind:'answer',duration:60,startedAt:1000,at});
  assert.equal(scoreForClaim(answer(1000)),5);
  assert.equal(scoreForClaim(answer(13000)),4);
  assert.equal(scoreForClaim(answer(25000)),3);
  assert.equal(scoreForClaim(answer(37000)),2);
  assert.equal(scoreForClaim(answer(60999)),1);
  assert.equal(remainingMs(1000,60,61000),0);
  assert.equal(remainingMs(1000,60,90000),0);
});
test('Firebaseルールで正解と時間切れの条件にサーバー時刻を使う', () => {
  const rules=JSON.parse(readFileSync('database.rules.json','utf8')).rules;
  const claim=rules.claims.$room.$game.$turn;
  assert.match(claim['.write'],/!data\.child\('ended'\)\.exists/);
  assert.match(claim['.validate'],/child\('at'\)\.val\(\) == now/);
  assert.match(claim['.write'],/now < /);
  assert.match(claim['.write'],/now >= /);
  assert.match(rules.verified.$room.$game.$turn.$uid['.validate'],/secrets/);
  assert.match(rules.secrets.$room.$game.$turn['.read'],/2000/);
});
test('配点を変更でき、順位では変わらない', async () => {
  const {scoreForClaim} = await import('../src/timing.mjs');
  const settings={minPoints:2,maxPoints:10,flatPoints:4};
  assert.equal(scoreForClaim({startedAt:1000,duration:100,at:1001},settings),10);
  assert.equal(scoreForClaim({startedAt:1000,duration:100,at:100999},settings),2);
  assert.equal(scoreForClaim({startedAt:1000,duration:0,at:100999},settings),4);
  assert.equal(scoreForClaim({startedAt:1000,duration:100,at:1001},{...settings,minPoints:4,maxPoints:4}),4);
});
test('制限時間を三等分して回答者と描き手に加点し、境界は次の区分', async () => {
 const {awardForClaim}=await import('../src/timing.mjs');
 const settings={scoreMode:'thirds',flatPoints:4,flatDrawerPoints:2};
 const claim=elapsed=>({uid:'x',startedAt:1000,duration:60,at:1000+elapsed});
 for(const [elapsed,answer,drawer] of [[0,20,15],[19999,20,15],[20000,10,7],[39999,10,7],[40000,5,3],[59999,5,3]]){
  assert.equal(awardForClaim(claim(elapsed),settings),answer);assert.equal(awardForClaim(claim(elapsed),settings,'drawer'),drawer);
 }
 assert.equal(awardForClaim(claim(0),{...settings,answerEarly:42,drawerEarly:9}),42);
 assert.equal(awardForClaim(claim(0),{...settings,answerEarly:42,drawerEarly:9},'drawer'),9);
 assert.equal(awardForClaim({...claim(0),duration:0},settings),4);
 assert.equal(awardForClaim({...claim(0),duration:0},settings,'drawer'),2);
 assert.equal(awardForClaim({kind:'skip'},settings,'drawer'),0);
});
test('各正解者ごとに描き手へ得点、パス後のIDと同点順位も正しく扱う', async()=>{
 const {scoreDeltas,scoresForRoom,ranking}=await import('../src/scoring.mjs');
 const room={scoreMode:'thirds',schedule:['a','b'],turnIds:{0:8},order:['a','b','c'],players:{a:{score:1},b:{score:3},c:{score:3}}};
 const claim={ended:{at:90000},slots:{s0:{uid:'b',startedAt:1000,duration:60,at:2000},s1:{uid:'c',startedAt:1000,duration:60,at:42000}}};
 assert.deepEqual(scoreDeltas(room,8,claim),{a:18,b:20,c:5});
 const scores=scoresForRoom(room,{0:{ended:{reason:'pass',at:2000}},8:claim},100000);
 assert.deepEqual(scores,{a:19,b:23,c:8});
 assert.deepEqual(scoresForRoom(room,{8:claim},100000,8),{a:1,b:3,c:3});
 assert.deepEqual(ranking(room,{a:3,b:5,c:5}).map(x=>[x.uid,x.rank]),[['b',1],['c',1],['a',3]]);
});

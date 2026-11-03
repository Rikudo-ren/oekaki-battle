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

const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../database.rules.json').rules;

test('共有の正解枠は上限と既存枠の保護、重複禁止を検証する',()=>{
  const rule=rules.claims.$room.$game.$turn;
  assert.match(rule['.write'],/newData\.exists\(\)/);
  assert.match(rule['.write'],/!data\.child\('ended'\)\.exists\(\)/);
  assert.match(rule['.write'],/child\('maxCorrect'\)/);
  assert.match(rule['.validate'],/child\('verified'\)/);
  for(let i=0;i<7;i++){
    assert.ok(rule['.validate'].includes(`data.child('slots').child('s${i}')`));
    for(let j=i+1;j<7;j++)assert.ok(rule['.validate'].includes(`newData.child('slots').child('s${i}').child('uid').val() != newData.child('slots').child('s${j}').child('uid').val()`));
  }
});
test('未終了の回答や開始前の描画にはサーバー時刻と秘密の判定が必要',()=>{
  const verified=rules.verified.$room.$game.$turn.$uid;
  assert.match(verified['.read'],/auth.uid == \$uid/);
  assert.match(verified['.write'],/now >= .*3000/);
  assert.match(verified['.validate'],/child\('secrets'\)/);
  assert.match(rules.drawings.$room.$game.$turn.$stroke['.write'],/now >= .*3000/);
  assert.match(rules.secrets.$room.$game.$turn['.read'],/child\('ended'\).*2000/);
});

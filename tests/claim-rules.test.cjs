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


test('正解を伏せたチャットだけを保存し、発表前の答え本文を拒否するルール',()=>{
 const rules=JSON.parse(require('node:fs').readFileSync('database.rules.json','utf8')).rules;
 const chat=rules.chats.$room.$game.$message;
 assert.match(chat['.validate'],/child\('text'\).*●●●/);
 assert.match(chat['.validate'],/child\('verified'\)/);
 assert.match(chat['.validate'],/child\('secrets'\)/);
 assert.match(chat['.validate'],/ended.*now.*2000/);
 assert.equal(chat.$other['.validate'],false);
 const guard=rules.chatGuard.$room.$game.$turn.$uid;assert.match(guard['.write'],/auth.uid == \$uid/);assert.match(guard['.write'],/child\('ended'\)/);assert.equal(guard['.validate'],'newData.val() == true');assert.equal(guard['.read'],undefined);
 const secret=rules.secrets.$room.$game.$turn['.read'];
 assert.match(secret,/players/);assert.match(secret,/child\('ended'\).*2000/);
});

test('パスは描き手のみ正解前に確定し、次のお題はGMだけが準備できる',()=>{
 const pass=rules.passCandidates.$room.$game.$turn,claim=rules.claims.$room.$game.$turn;
 assert.match(pass['.write'],/drawer.*auth.uid/);assert.match(pass['.write'],/!.*slots.*exists/);
 assert.match(pass['.validate'],/child\('secrets'\)/);assert.match(pass['.read'],/host.*reason.*pass/);
 assert.match(claim['.write'],/reason'\).val\(\) == 'pass'.*!data.child\('slots'\).exists\(\).*passCandidates/);
 assert.match(claim.ended.reason['.validate'],/pass/);
 for(const path of [rules.secrets.$room.$game.$turn,rules.hints.$room.$game.$turn])assert.match(path['.write'],/host.*nextTurnIndex.*pass.*2000/);
 for(const root of ['secrets','claims','drawings','chats','hints','verified','chatGuard','passCandidates']){const rule=rules[root].$room.$game['.write'];assert.match(rule,/host/);assert.match(rule,/starting/);}
});

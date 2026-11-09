const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('複数タブでは一つでも接続が残れば参加中', async () => {
  const { isOnline, onlinePlayers } = await import('../src/room-management.mjs');
  const room = {players:{alice:{},bob:{}},online:{alice:{tab1:true,tab2:true},bob:{tab3:true}}};
  delete room.online.alice.tab1;
  assert.equal(isOnline(room,'alice'),true);
  assert.deepEqual(onlinePlayers(room),['alice','bob']);
  delete room.online.alice;
  assert.equal(isOnline(room,'alice'),false);
  assert.deepEqual(onlinePlayers(room),['bob']);
});
test('全員不在で5分を過ぎた部屋だけ、次回アクセス時に片付ける', async () => {
  const { isAbandoned, ABANDONED_AFTER_MS } = await import('../src/room-management.mjs');
  const lastOnline=1000;
  assert.equal(isAbandoned({lastOnline},lastOnline+ABANDONED_AFTER_MS-1),false);
  assert.equal(isAbandoned({lastOnline},lastOnline+ABANDONED_AFTER_MS),true);
  assert.equal(isAbandoned({lastOnline,online:{alice:{tab:true}}},lastOnline+ABANDONED_AFTER_MS),false);
  assert.equal(isAbandoned({},lastOnline+ABANDONED_AFTER_MS),false); // 古い画面の部屋は誤削除しない
});
test('描き手の切断記録後すぐスキップ、他の接続が残っていれば対象外', async () => {
  const { canSkipAbsentDrawer } = await import('../src/room-management.mjs');
  const room={phase:'playing',drawer:'alice',lastDisconnects:{alice:1000}};
  assert.equal(canSkipAbsentDrawer(room,999),false);
  assert.equal(canSkipAbsentDrawer(room,1000),true);
  assert.equal(canSkipAbsentDrawer({phase:'playing',drawer:'alice'},90000),false);
  assert.equal(canSkipAbsentDrawer({...room,online:{alice:{tab:true}}},90000),false);
  assert.equal(canSkipAbsentDrawer({...room,phase:'lobby'},90000),false);
});
test('不在スキップでは得点を付けない', async () => {
  const { scoreForClaim } = await import('../src/timing.mjs');
  assert.equal(scoreForClaim({kind:'skip',duration:0}),0);
  assert.equal(scoreForClaim({kind:'skip',duration:60,startedAt:1000,at:3000}),0);
});
test('部屋の接続記録・安全な片付け・スキップのルールがある', () => {
  const rules=JSON.parse(readFileSync('database.rules.json','utf8')).rules;
  const room=rules.rooms.$room;
  assert.match(room.online.$uid.$connection['.write'],/auth.uid == \$uid/);
  assert.match(room['.write'],/!data\.child\('online'\)\.exists\(\)/);
  assert.match(room['.write'],/300000/);
  for(const root of ['secrets','claims','drawings','chats','hints','verified']) {
    assert.match(rules[root].$room.$game['.write'],/phase'\)\.val\(\) == 'closing'/);
    assert.match(rules[root].$room.$game['.write'],/!newData\.exists\(\)/);
  }
  assert.match(rules.claims.$room.$game.$turn['.write'],/lastDisconnects/);
  assert.match(rules.secrets.$room.$game.$turn['.read'],/child\('ended'\)/);
});

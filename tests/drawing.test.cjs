const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const stroke = (points) => ({ color:'#393632', width:5, points:JSON.stringify(points) });

test('保存済みの線を順番に復元できる', async () => {
  const { reduceDrawingEvents } = await import('../src/drawing.mjs');
  const a=stroke([[1,2],[3,4]]), b=stroke([[5,6]]);
  assert.deepEqual(reduceDrawingEvents([a,b]),[a,b]);
});
test('もどすは直前の線のみ消し、その後の線は残す', async () => {
  const { reduceDrawingEvents } = await import('../src/drawing.mjs');
  const a=stroke([[1,2]]), b=stroke([[3,4]]), c=stroke([[5,6]]);
  assert.deepEqual(reduceDrawingEvents([a,b,{action:'undo'},c]),[a,c]);
  assert.deepEqual(reduceDrawingEvents([{action:'undo'},a,{action:'undo'},{action:'undo'}]),[]);
});
test('全部消すの後も新たに描け、履歴の再生結果は同じ', async () => {
  const { reduceDrawingEvents } = await import('../src/drawing.mjs');
  const a=stroke([[1,2]]), b=stroke([[3,4]]);
  const history=[a,{action:'clear'},b,{action:'undo'},a];
  assert.deepEqual(reduceDrawingEvents(history),[a]);
  assert.deepEqual(reduceDrawingEvents(JSON.parse(JSON.stringify(history))),[a]);
});
test('不正なイベントは復元中に無視される', async () => {
  const { reduceDrawingEvents } = await import('../src/drawing.mjs');
  const a=stroke([[1,2]]);
  assert.deepEqual(reduceDrawingEvents([null,{}, {points:'bad'},a]),[a]);
});
test('データベースルールは部屋のメンバーに限定したチャットと描画操作を含む', () => {
  const rules=JSON.parse(readFileSync('database.rules.json','utf8')).rules;
  const chat=rules.chats.$room.$game;
  assert.match(chat['.read'],/players/);
  assert.match(chat.$message['.write'],/players/);
  assert.match(chat.$message['.validate'],/auth.uid/);
  assert.match(chat.$message['.validate'],/length <= 200/);
  const drawing=rules.drawings.$room.$game.$turn.$stroke;
  assert.match(drawing['.write'],/drawer/);
  assert.match(drawing['.validate'],/'undo'/);
  assert.match(drawing['.validate'],/'clear'/);
});

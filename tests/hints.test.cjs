const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('お題はすべて異なる2〜6文字のひらがな', async () => {
  const { topics } = await import('../src/topics.mjs');
  assert.ok(topics.length >= 1000);
  assert.equal(new Set(topics).size, topics.length);
  assert.ok(topics.includes('ねこ'));
  for (const unwanted of ['こねこ', 'かばさん', 'こうま', 'こぶた', 'こじか', 'こひつじ', 'といれっと', 'りすざる', 'ばすけっと']) assert.ok(!topics.includes(unwanted), unwanted);
  for (const word of topics) {
    assert.match(word, /^[\u3041-\u3096ー]+$/);
    assert.ok(Array.from(word).length >= 2 && Array.from(word).length <= 6, word);
  }
});

test('2・3・4文字は1文字、5・6文字は異なる2文字を公開', async () => {
  const { createHint, hintCharacters } = await import('../src/hints.mjs');
  const words = ['ねこ', 'うさぎ', 'ぺんぎん', 'おにぎりや', 'とうもろこし'];
  for (const word of words) {
    const hint = createHint(word, indices => [...indices].reverse());
    const expected = Array.from(word).length <= 4 ? 1 : 2;
    assert.equal(Object.keys(hint).length, expected);
    const visible = hintCharacters(Array.from(word).length, hint);
    assert.equal(visible.filter(Boolean).length, expected);
    visible.forEach((char, index) => { if (char) assert.equal(char, Array.from(word)[index]); });
  }
  assert.deepEqual(createHint('ねこ', indices => indices), { p0: 'ね' });
  assert.throws(() => createHint('ね', indices => indices));
  assert.throws(() => createHint('あいうえおかき', indices => indices));
});

test('ルールは現在の部屋とターンの参加者に、ヒント時刻以降だけ許可する', () => {
  const rules = JSON.parse(readFileSync('database.rules.json', 'utf8')).rules.hints.$room.$game.$turn;
  assert.match(rules['.read'], /players/);
  assert.match(rules['.read'], /hintSeconds/);
  assert.match(rules['.read'], /now >=/);
  assert.match(rules['.read'], /turnStartedAt/);
  assert.match(rules['.read'], /!root\.child\('claims'\)/);
  assert.match(rules['.write'], /host/);
  assert.match(rules['.write'], /starting/);
});

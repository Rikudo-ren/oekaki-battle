const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const script = path.resolve(__dirname, '../scripts/firebase-config.cjs');
const names = ['FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_DATABASE_URL', 'FIREBASE_PROJECT_ID', 'FIREBASE_APP_ID', 'VERCEL'];
function run(vars) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oekaki-config-'));
  const env = { ...process.env }; for (const name of names) delete env[name];
  const result = spawnSync(process.execPath, [script], { cwd: dir, env: { ...env, ...vars }, encoding: 'utf8' });
  const file = path.join(dir, 'public/firebase-config.js');
  const output = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.rmSync(dir, { recursive: true, force: true });
  return { ...result, output };
}
test('ローカルでは未設定でも画面確認できる', () => {
  const result = run({}); assert.equal(result.status, 0); assert.match(result.output, /"apiKey": ""/);
});
test('Vercelで設定が不足したらビルドを止める', () => {
  const result = run({ VERCEL: '1' }); assert.equal(result.status, 1); assert.match(result.stderr, /FIREBASE_DATABASE_URL/); assert.equal(result.output, '');
});
test('一部だけ設定された場合も失敗する', () => {
  const result = run({ FIREBASE_API_KEY: 'test' }); assert.equal(result.status, 1); assert.match(result.stderr, /FIREBASE_APP_ID/);
});
test('設定値が安全なJavaScriptとして生成される', () => {
  const result = run({ VERCEL: '1', FIREBASE_API_KEY: 'key"\\example', FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com', FIREBASE_DATABASE_URL: 'https://example.firebaseio.com', FIREBASE_PROJECT_ID: 'example', FIREBASE_APP_ID: 'app-id' });
  assert.equal(result.status, 0); const context = { window: {} }; vm.runInNewContext(result.output, context);
  assert.equal(context.window.FIREBASE_CONFIG.apiKey, 'key"\\example'); assert.equal(context.window.FIREBASE_CONFIG.databaseURL, 'https://example.firebaseio.com');
});

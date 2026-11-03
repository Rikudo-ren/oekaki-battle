// Firebase's web configuration is public: this file is served to browsers.
const fs = require('node:fs');
const path = require('node:path');

const fields = {
  apiKey: 'FIREBASE_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  databaseURL: 'FIREBASE_DATABASE_URL',
  projectId: 'FIREBASE_PROJECT_ID',
  appId: 'FIREBASE_APP_ID',
};
const missing = Object.values(fields).filter(name => !process.env[name]?.trim());
const anySet = missing.length !== Object.keys(fields).length;
if (missing.length && (anySet || process.env.VERCEL === '1')) {
  console.error(`Firebase設定が不足しています: ${missing.join(', ')}`);
  process.exit(1);
}
const config = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, process.env[name]?.trim() || '']));
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync(path.join('public', 'firebase-config.js'), `window.FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
if (missing.length) console.warn('Firebase設定なしでビルドしました。画面は確認できますが、オンライン対戦は利用できません。');

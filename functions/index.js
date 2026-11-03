const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const crypto = require('crypto');
initializeApp();
const db = getDatabase();
const opts = { region: 'asia-northeast1' };
const topics = ['ねこ','いぬ','うさぎ','ぞう','きりん','ぱんだ','らいおん','ぺんぎん','りんご','ばなな','いちご','すいか','おにぎり','らーめん','ぷりん','けーき','ひこうき','じてんしゃ','でんしゃ','くるま','かさ','めがね','とけい','はなび','ゆきだるま','たいよう','おばけ','さかな','たこ','かめ','かえる','ちょうちょ','ひまわり','さくら','やま','ろけっと','ぎたー','ぴあの','ぼうし','くつ'];
const fail = (code, message) => { throw new HttpsError(code, message); };
const uidOf = r => r.auth?.uid || fail('unauthenticated', 'ログインできませんでした。');
const codeOf = value => { const code = String(value || '').trim().toUpperCase(); if (!/^[A-Z0-9]{6}$/.test(code)) fail('invalid-argument','合言葉は半角英数字6文字です。'); return code; };
const nameOf = value => { const name = String(value || '').trim(); if (!name || name.length > 12) fail('invalid-argument','名前は1〜12文字で入力してください。'); return name; };
const shuffle = a => { a = [...a]; for(let i=a.length-1;i>0;i--){const j=crypto.randomInt(i+1); [a[i],a[j]]=[a[j],a[i]];} return a; };
async function roomFor(code, uid) { const room=(await db.ref(`rooms/${code}`).get()).val(); if (!room || !room.players?.[uid]) fail('permission-denied','部屋に参加していません。'); return room; }
exports.createRoom = onCall(opts, async r => {
  const uid=uidOf(r), name=nameOf(r.data.name);
  for (let i=0;i<10;i++) {
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let code=''; for(let n=0;n<6;n++) code+=alphabet[crypto.randomInt(alphabet.length)];
    const result=await db.ref(`rooms/${code}`).transaction(current => current ? undefined : {host:uid, phase:'lobby', players:{[uid]:{name,score:0}}, createdAt:Date.now()});
    if(result.committed) return {code};
  }
  fail('resource-exhausted','部屋を作れませんでした。もう一度お試しください。');
});
exports.joinRoom = onCall(opts, async r => {
  const uid=uidOf(r), code=codeOf(r.data.code), name=nameOf(r.data.name); let reason='';
  const result=await db.ref(`rooms/${code}`).transaction(room => {
    if(!room){reason='部屋が見つかりません。';return;}
    if(room.players?.[uid]) return room;
    if(room.phase!=='lobby'){reason='このゲームはすでに始まっています。';return;}
    if(Object.keys(room.players||{}).length>=8){reason='部屋は満員です。';return;}
    room.players[uid]={name,score:0}; return room;
  });
  if(!result.committed) fail('failed-precondition',reason || '参加できませんでした。'); return {code};
});
exports.startGame = onCall(opts, async r => {
  const uid=uidOf(r), code=codeOf(r.data.code), rounds=Number(r.data.rounds), room=await roomFor(code,uid);
  if(room.host!==uid) fail('permission-denied','ホストだけが開始できます。');
  if(room.phase!=='lobby') fail('failed-precondition','ゲームはすでに始まっています。');
  if(!Number.isInteger(rounds)||rounds<1||rounds>5) fail('invalid-argument','周回数は1〜5にしてください。');
  const order=shuffle(Object.keys(room.players)); if(order.length<2) fail('failed-precondition','2人以上で始めてください。');
  const answers=Array.from({length:order.length*rounds},()=>topics[crypto.randomInt(topics.length)]);
  // Lock the lobby before writing secrets so simultaneous starts cannot replace the answer list.
  const locked=await db.ref(`rooms/${code}`).transaction(current=>{
    if(!current || current.host!==uid || current.phase!=='lobby' || Object.keys(current.players).sort().join(',')!==[...order].sort().join(',')) return;
    return {...current,phase:'starting'};
  });
  if(!locked.committed) fail('aborted','参加者が変わりました。もう一度開始してください。');
  try {
    await db.ref(`secrets/${code}`).set({answers});
    await db.ref(`rooms/${code}`).update({phase:'playing',rounds,order,turn:0,drawer:order[0],wordLength:Array.from(answers[0]).length});
  } catch (error) {
    await db.ref(`rooms/${code}/phase`).set('lobby');
    throw error;
  }
});
exports.getWord = onCall(opts, async r => {
  const uid=uidOf(r), code=codeOf(r.data.code), room=await roomFor(code,uid);
  if(room.phase!=='playing' || room.drawer!==uid) fail('permission-denied','描く人だけがお題を見られます。');
  const answer=(await db.ref(`secrets/${code}/answers/${room.turn}`).get()).val(); if(!answer) fail('failed-precondition','お題が見つかりません。');
  return {word:answer,turn:room.turn};
});
exports.submitAnswer = onCall(opts, async r => {
  const uid=uidOf(r), code=codeOf(r.data.code), room=await roomFor(code,uid);
  if(room.phase!=='playing'||room.drawer===uid) fail('failed-precondition','今は回答できません。');
  const guess=String(r.data.answer||'').trim().normalize('NFKC');
  if(!/^[\u3041-\u3096ー]+$/.test(guess)) fail('invalid-argument','答えはひらがなで入力してください。');
  const answer=(await db.ref(`secrets/${code}/answers/${room.turn}`).get()).val();
  if(guess!==answer) return {correct:false};
  const result=await db.ref(`rooms/${code}`).transaction(current=>{
    if(!current || current.phase!=='playing' || current.turn!==room.turn || !current.players?.[uid] || current.drawer===uid) return;
    current.phase='revealed'; current.winner=uid; current.answer=answer; current.players[uid].score=(current.players[uid].score||0)+1; return current;
  });
  return {correct:result.committed};
});
exports.nextTurn = onCall(opts, async r => {
  const uid=uidOf(r), code=codeOf(r.data.code), room=await roomFor(code,uid);
  if(room.host!==uid) fail('permission-denied','ホストだけが進められます。');
  if(room.phase!=='revealed') fail('failed-precondition','まだ正解が出ていません。');
  const next=room.turn+1, done=next>=room.order.length*room.rounds;
  const answer=done?null:(await db.ref(`secrets/${code}/answers/${next}`).get()).val();
  if(!done&&!answer) fail('failed-precondition','お題が見つかりません。');
  const result=await db.ref(`rooms/${code}`).transaction(current=>{
    if(!current || current.host!==uid || current.phase!=='revealed' || current.turn!==room.turn) return;
    current.phase=done?'finished':'playing'; if(!done){current.turn=next;current.drawer=current.order[next%current.order.length];current.wordLength=Array.from(answer).length;delete current.answer;delete current.winner;} return current;
  });
  if(!result.committed) fail('aborted','すでに進行しています。');
});
exports.leaveRoom = onCall(opts, async r => {
  const uid=uidOf(r), code=codeOf(r.data.code); await roomFor(code,uid);
  await db.ref(`rooms/${code}`).transaction(room=>{
    if(!room || !room.players?.[uid] || room.phase!=='lobby') return;
    delete room.players[uid]; const remaining=Object.keys(room.players);
    if(!remaining.length) return null;
    if(room.host===uid) room.host=remaining[0]; return room;
  });
});

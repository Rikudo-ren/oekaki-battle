// Run separately with a local Firebase Realtime Database emulator; never uses production.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const timestamp={'.sv':'timestamp'};

test('Realtime Database: 非公開のお題、複数正解の競合と結果発表',async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-oekaki',database:{rules:fs.readFileSync('database.rules.json','utf8')}});
  try {
    const started=Date.now()-5000;
    const players=Object.fromEntries(['host','drawer','alice','bob','charlie'].map(uid=>[uid,{name:uid,score:0}]));
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.database();
      await db.ref('rooms/ABC123').set({host:'host',phase:'playing',gameId:'game',players,drawer:'drawer',turn:0,turnStartedAt:started,timeLimit:60,maxCorrect:2});
      await db.ref('secrets/ABC123/game/0').set('さくら');
    });
    const db=uid=>env.authenticatedContext(uid).database();
    const claims='claims/ABC123/game/0',secret='secrets/ABC123/game/0';
    const verify=uid=>`verified/ABC123/game/0/${uid}`;
    await assertSucceeds(db('late').ref('rooms/ABC123/players/late').set({name:'late',score:0}));
    await assertFails(db('late').ref('rooms/ABC123/players/other').set({name:'other',score:0}));
    await assertFails(db('late').ref('rooms/ABC123/players/late').set(null));
    await assertFails(db('alice').ref(secret).get());
    await assertSucceeds(db('drawer').ref(secret).get());
    const guard=uid=>`chatGuard/ABC123/game/0/${uid}`;
    await assertSucceeds(db('alice').ref(guard('alice')).set(true));
    await assertFails(db('alice').ref(guard('bob')).set(true));
    await assertFails(db('alice').ref(guard('alice')).set('yes'));
    await assertFails(db('alice').ref(guard('alice')).get());
    const chat='chats/ABC123/game', message=(uid,text,extra={})=>({uid,name:uid,text,at:timestamp,...extra});
    await assertFails(db('drawer').ref(`${chat}/drawerSecret`).set(message('drawer','さくら')));
    await assertFails(db('alice').ref(`${chat}/rawAnswer`).set(message('alice','さくら')));
    await assertSucceeds(db('drawer').ref(`${chat}/conversation`).set(message('drawer','がんばって')));
    await assertSucceeds(db('alice').ref(`${chat}/wrong`).set(message('alice','すいか')));
    await assertFails(db('alice').ref(`${chat}/forged`).set(message('alice','●●●',{kind:'correct',turn:0})));
    await assertFails(db('alice').ref(`${chat}/extra`).set(message('alice','こんにちは',{secret:'さくら'})));

    await assertFails(db('alice').ref(verify('alice')).set('すいか'));
    for(const uid of ['alice','bob','charlie'])await assertSucceeds(db(uid).ref(verify(uid)).set('さくら'));
    await assertSucceeds(db('alice').ref(`${chat}/masked`).set(message('alice','●●●',{kind:'correct',turn:0})));
    await assertFails(db('alice').ref(`${chat}/disguised`).set(message('alice','さくら',{kind:'correct',turn:0})));
    assert.equal((await db('bob').ref(`${chat}/masked`).get()).val().text,'●●●');
    await assertFails(db('bob').ref(verify('alice')).get());
    const slot=uid=>({uid,at:timestamp,startedAt:started+3000,duration:60});
    await assertFails(db('alice').ref(claims).set({slots:{s0:{...slot('alice'),at:1}}}));
    await assertSucceeds(db('alice').ref(claims).transaction(current=>({...current,slots:{s0:slot('alice')}}),undefined,false));
    await assertFails(db('alice').ref(claims).transaction(current=>({...current,slots:{...current.slots,s1:slot('alice')},ended:{reason:'full',at:timestamp}}),undefined,false));
    const fill=uid=>db(uid).ref(claims).transaction(current=>{
      if(current?.ended)return;
      return {...current,slots:{...current.slots,s1:slot(uid)},ended:{reason:'full',at:timestamp}};
    },undefined,false);
    const results=await Promise.all([fill('bob'),fill('charlie')]);
    assert.equal(results.filter(result=>result.committed).length,1);
    const final=(await db('alice').ref(claims).get()).val();
    assert.equal(Object.keys(final.slots).length,2);
    assert.notEqual(final.slots.s0.uid,final.slots.s1.uid);
    assert.equal(final.ended.reason,'full');
    await assertFails(db('bob').ref(guard('bob')).set(true));
    await assertFails(db('alice').ref(secret).get());
    await assertFails(db('alice').ref(`${chat}/earlyReveal`).set(message('alice','さくら')));
    await new Promise(resolve=>setTimeout(resolve,2200));
    assert.equal((await assertSucceeds(db('alice').ref(secret).get())).val(),'さくら');
    await assertSucceeds(db('alice').ref(`${chat}/afterReveal`).set(message('alice','さくら')));
    await env.withSecurityRulesDisabled(async context=>{await context.database().ref('rooms/ABC123/turn').set(1);await context.database().ref('secrets/ABC123/game/1').set('ねこ');});
    assert.equal((await assertSucceeds(db('alice').ref(secret).get())).val(),'さくら');
    await assertFails(db('alice').ref('secrets/ABC123/game/1').get());
    console.log('Firebase Emulator のルール・同時受付テストに成功しました。');
  } finally { await env.cleanup(); }
});

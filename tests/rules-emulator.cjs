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

test('Realtime Database: 描き手のパス、正解との競合、GM権限と再開',async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-oekaki-pass',database:{rules:fs.readFileSync('database.rules.json','utf8')}});
  try{
    const started=Date.now()-5000;
    const room={host:'host',phase:'playing',gameId:'game',players:{host:{name:'host',score:0},drawer:{name:'drawer',score:0},alice:{name:'alice',score:0}},drawer:'drawer',turn:0,nextTurnIndex:8,turnStartedAt:started,timeLimit:60,maxCorrect:2};
    await env.withSecurityRulesDisabled(async c=>{await c.database().ref('rooms/PASS01').set(room);await c.database().ref('secrets/PASS01/game/0').set('ねこ');});
    const db=uid=>env.authenticatedContext(uid).database();
    const candidate='passCandidates/PASS01/game/0',claim='claims/PASS01/game/0',next='secrets/PASS01/game/8';
    await assertFails(db('alice').ref(candidate).set('いぬ'));
    await assertFails(db('drawer').ref(candidate).set('ねこ'));
    await assertSucceeds(db('drawer').ref(candidate).set('いぬ'));
    await assertFails(db('alice').ref(candidate).get());await assertFails(db('host').ref(candidate).get());
    await assertFails(db('alice').ref(claim).set({ended:{reason:'pass',at:timestamp}}));
    await assertSucceeds(db('drawer').ref(claim).set({ended:{reason:'pass',at:timestamp}}));
    assert.equal((await assertSucceeds(db('host').ref(candidate).get())).val(),'いぬ');
    await assertFails(db('host').ref(next).set('いぬ'));
    await assertFails(db('alice').ref('verified/PASS01/game/0/alice').set('ねこ'));
    await new Promise(resolve=>setTimeout(resolve,2200));
    await assertFails(db('drawer').ref(next).set('いぬ'));await assertFails(db('host').ref(next).set('さる'));
    await assertSucceeds(db('host').ref(next).set('いぬ'));
    await assertSucceeds(db('host').ref('hints/PASS01/game/8').set({p0:'い'}));
    await assertFails(db('alice').ref('rooms/PASS01').update({phase:'lobby'}));
    await assertSucceeds(db('host').ref('rooms/PASS01').update({phase:'lobby'}));
    // A completed claim must beat a concurrent pass; the drawer may not discard points.
    await env.withSecurityRulesDisabled(async c=>{
      await c.database().ref('rooms/PASS01').set(room);
      await c.database().ref(claim).set({slots:{s0:{uid:'alice',at:started+3500,startedAt:started+3000,duration:60}}});
    });
    await assertFails(db('drawer').ref(candidate).set('いぬ'));
    await assertFails(db('drawer').ref(claim).transaction(value=>({...value,ended:{reason:'pass',at:timestamp}}),undefined,false));
  }finally{await env.cleanup();}
});

test('Realtime Database: 終了後にロビーから再開するためのデータ削除とゲームID切り替え',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-oekaki-restart',database:{rules:fs.readFileSync('database.rules.json','utf8')}});
 try{
  const roots=['secrets','claims','drawings','chats','hints','verified','chatGuard','passCandidates'];
  await env.withSecurityRulesDisabled(async c=>{
   const db=c.database();await db.ref('rooms/RETRY1').set({host:'host',phase:'lobby',gameId:'old',players:{host:{name:'host',score:0},guest:{name:'guest',score:1}},online:{host:{tab:true},guest:{tab:true}},hasPlayed:true});
   for(const root of roots)await db.ref(`${root}/RETRY1/old/example`).set(true);
  });
  const host=env.authenticatedContext('host').database(),guest=env.authenticatedContext('guest').database();
  await assertFails(guest.ref('rooms/RETRY1').update({phase:'starting'}));
  await assertFails(host.ref('claims/RETRY1/old').set(null));
  await assertSucceeds(host.ref('rooms/RETRY1').update({phase:'starting'}));
  for(const root of roots){await assertFails(guest.ref(`${root}/RETRY1/old`).set(null));await assertSucceeds(host.ref(`${root}/RETRY1/old`).set(null));}
  await assertSucceeds(host.ref('rooms/RETRY1').update({gameId:'new'}));
  await assertSucceeds(host.ref('secrets/RETRY1/new/0').set('ねこ'));
  await assertSucceeds(host.ref('hints/RETRY1/new/0').set({p0:'ね'}));
  await assertSucceeds(host.ref('rooms/RETRY1').update({phase:'playing',turn:0,drawer:'host',turnStartedAt:timestamp,timeLimit:60,maxCorrect:1}));
  assert.equal((await host.ref('secrets/RETRY1/new/0').get()).val(),'ねこ');
 }finally{await env.cleanup();}
});

test('Realtime Database: 試合終了後、得点記録を残してもう一周を準備',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-oekaki-again',database:{rules:fs.readFileSync('database.rules.json','utf8')}});
 try{
  await env.withSecurityRulesDisabled(async c=>{
   const db=c.database();await db.ref('rooms/AGAIN1').set({host:'host',phase:'finished',gameId:'game',players:{host:{name:'host',score:0},guest:{name:'guest',score:0}},turn:1,drawer:'guest',timeLimit:60});
   await db.ref('claims/AGAIN1/game/0').set({slots:{s0:{uid:'guest',at:100,startedAt:0,duration:60}},ended:{reason:'full',at:100}});
  });
  const host=env.authenticatedContext('host').database(),guest=env.authenticatedContext('guest').database();
  await assertFails(guest.ref('rooms/AGAIN1').update({phase:'starting'}));
  await assertSucceeds(host.ref('rooms/AGAIN1').update({phase:'starting',startOrigin:'finished'}));
  await assertFails(guest.ref('secrets/AGAIN1/game/8').set('ねこ'));
  await assertSucceeds(host.ref('secrets/AGAIN1/game/8').set('ねこ'));
  await assertSucceeds(host.ref('hints/AGAIN1/game/8').set({p0:'ね'}));
  await assertFails(guest.ref('secrets/AGAIN1/game/8').get());
  await assertSucceeds(host.ref('rooms/AGAIN1').update({phase:'playing',turn:8,drawer:'host',turnStartedAt:timestamp}));
  assert.equal((await host.ref('claims/AGAIN1/game/0').get()).val().slots.s0.uid,'guest');
  await assertFails(guest.ref('secrets/AGAIN1/game/8').get());
  assert.equal((await host.ref('secrets/AGAIN1/game/8').get()).val(),'ねこ');
 }finally{await env.cleanup();}
});

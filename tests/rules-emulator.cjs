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
    await assertFails(db('alice').ref(verify('alice')).set('すいか'));
    for(const uid of ['alice','bob','charlie'])await assertSucceeds(db(uid).ref(verify(uid)).set('さくら'));
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
    await assertFails(db('alice').ref(secret).get());
    await new Promise(resolve=>setTimeout(resolve,2200));
    assert.equal((await assertSucceeds(db('alice').ref(secret).get())).val(),'さくら');
    console.log('Firebase Emulator のルール・同時受付テストに成功しました。');
  } finally { await env.cleanup(); }
});

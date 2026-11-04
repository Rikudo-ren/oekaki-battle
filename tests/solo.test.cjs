const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../database.rules.json').rules;
test('CPU用線画は自然なお題とキャンバス内の線を持つ',async()=>{
 const {topics}=await import('../src/topics.mjs');const {soloDrawings,soloWords}=await import('../src/solo-drawings.mjs');
 assert.equal(soloWords.length,18);
 for(const word of soloWords){assert.ok(topics.includes(word),word);assert.ok(soloDrawings[word].length>0);for(const stroke of soloDrawings[word]){assert.ok(stroke.points.length>=2);for(const [x,y] of stroke.points)assert.ok(x>=0&&x<=900&&y>=0&&y<=540,word);}}
});
test('ローカルDBは更新・通知・回答判定をFirebaseから独立して扱う',async()=>{
 const {createMemoryDatabase,ref,set,get,update,onValue,runTransaction,serverTimestamp}=await import('../src/database.mjs');
 const db=createMemoryDatabase(),seen=[];const unsub=onValue(ref(db,'rooms/x'),snap=>seen.push(snap.val()));
 await set(ref(db,'rooms/x'),{phase:'lobby',time:serverTimestamp()});await update(ref(db,'rooms/x'),{'players/a':{name:'A'},'players/b':{name:'B'}});
 const result=await runTransaction(ref(db,'rooms/x'),current=>({...current,phase:'playing'}));assert.equal(result.committed,true);assert.equal(result.snapshot.val().phase,'playing');assert.equal(typeof result.snapshot.val().time,'number');
 await set(ref(db,'secrets/x/g/0'),'ねこ');await assert.rejects(set(ref(db,'verified/x/g/0/a'),'いぬ'),/permission_denied/);await set(ref(db,'verified/x/g/0/a'),'ねこ');assert.equal((await get(ref(db,'verified/x/g/0/a'))).val(),'ねこ');
 unsub();const count=seen.length;await set(ref(db,'rooms/x/phase'),'finished');await Promise.resolve();assert.equal(seen.length,count);
});
test('終了後の新規参加は固定公開部屋に限定される',()=>{
 const rule=rules.rooms.$room.players.$uid['.write'];for(const id of ['OPEN01','OPEN02','OPEN03'])assert.ok(rule.includes(`$room == '${id}'`));assert.match(rule,/finished/);
});

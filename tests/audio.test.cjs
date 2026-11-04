const {test}=require('node:test');
const assert=require('node:assert/strict');

test('BGMは場面に合わせて切り替わり、効果音と別に停止できる',async()=>{
 const stored=new Map(),listeners={},played=[];
 global.localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
 global.document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn};
 global.fetch=async url=>({ok:true,arrayBuffer:async()=>({url})});
 class FakeAudioContext {
  constructor(){this.state='running';this.destination={};}
  decodeAudioData(data){return Promise.resolve(data);}
  createBufferSource(){const source={connect(){},disconnect(){},start(){played.push(source);},stop(){source.stopped=true;}};return source;}
  createGain(){return {gain:{value:0},connect(){}};}
 }
 global.window={AudioContext:FakeAudioContext};
 const audio=await import('../src/audio.mjs');
 assert.equal(audio.soundEnabled(),false);assert.equal(audio.musicEnabled(),false);audio.unlockAudio();await new Promise(resolve=>setImmediate(resolve));assert.equal(played.length,0);
 audio.setSoundEnabled(true);audio.setMusicEnabled(true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(played[0].buffer.url,'/sounds/bgm-room.mp3');assert.equal(played[0].loop,true);
 audio.setMusicScene('play');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(played[0].stopped,true);assert.equal(played[1].buffer.url,'/sounds/bgm-play.mp3');
 audio.setMusicEnabled(false);assert.equal(played[1].stopped,true);assert.equal(stored.get('oekaki-music'),'off');
 audio.playSound('correct');await new Promise(resolve=>setImmediate(resolve));assert.equal(played[2].buffer.url,'/sounds/notification-success-sparkle.wav');
 audio.setMusicEnabled(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(played[3].buffer.url,'/sounds/bgm-play.mp3');
 document.hidden=true;listeners.visibilitychange();assert.equal(played[3].stopped,true);
 document.hidden=false;listeners.visibilitychange();await new Promise(resolve=>setImmediate(resolve));assert.equal(played[4].buffer.url,'/sounds/bgm-play.mp3');
 audio.setMusicEnabled(false);
});

test('音の初期設定は独立してオフ、明示的な保存値は復元',async()=>{
 global.document={hidden:false,addEventListener(){}};global.window={};
 const cases=[
  [{},false,false],
  [{'oekaki-sound':'on'},true,false],
  [{'oekaki-music':'on'},false,true],
  [{'oekaki-sound':'on','oekaki-music':'off'},true,false],
  [{'oekaki-sound':'off','oekaki-music':'on'},false,true],
  [{'oekaki-sound':'on','oekaki-music':'on'},true,true],
 ];
 for(const [i,[values,sound,music]] of cases.entries()){
  global.localStorage={getItem:key=>values[key]??null,setItem(){}};
  const audio=await import(`../src/audio.mjs?case=${i}`);
  assert.equal(audio.soundEnabled(),sound);assert.equal(audio.musicEnabled(),music);
 }
 global.localStorage={getItem(){throw Error('storage unavailable');}};
 const unavailable=await import('../src/audio.mjs?case=unavailable');
 assert.equal(unavailable.soundEnabled(),false);assert.equal(unavailable.musicEnabled(),false);
});

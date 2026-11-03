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
 audio.unlockAudio();await new Promise(resolve=>setImmediate(resolve));
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

const esbuild=require('esbuild');
const {JSDOM}=require('jsdom');
const {test}=require('node:test');
const fs=require('fs'),assert=require('assert/strict');
const exportsByModule={'firebase/app':['initializeApp'],'firebase/auth':['getAuth','signInAnonymously'],'firebase/database':['getDatabase','ref','onValue','push','set','get','runTransaction','query','limitToLast','serverTimestamp','update','onDisconnect']};
const wait=(ms=70)=>new Promise(r=>setTimeout(r,ms));
test('部屋の退出・切断・離席と空き部屋整理', async()=>{
const built=await esbuild.build({entryPoints:['src/app.js'],bundle:true,write:false,format:'iife',plugins:[{name:'fake-firebase',setup(build){build.onResolve({filter:/^firebase\//},a=>({path:a.path,namespace:'fake'}));build.onLoad({filter:/.*/,namespace:'fake'},a=>({contents:exportsByModule[a.path].map(n=>`export const ${n}=(...a)=>globalThis.__firebaseMocks.${n}(...a);`).join('\n'),loader:'js'}));}}]});
const html=fs.readFileSync('public/index.html','utf8').replace(/<script[^>]*><\/script>/g,'');
let data={},subs=[],connections={},seq=0,windows=[];
try {
const clone=v=>v==null?null:structuredClone(v);
const getPath=p=>p.split('/').reduce((v,k)=>v?.[k],data);
function write(p,v){const keys=p.split('/'),stack=[];let o=data;for(const k of keys.slice(0,-1)){stack.push([o,k]);o=o[k]??={};}const last=keys.at(-1);if(v===null)delete o[last];else o[last]=clone(v);for(const [parent,k] of stack.reverse()){const val=parent[k];if(val&&typeof val==='object'&&!Object.keys(val).length)delete parent[k];else break;}}
function notify(paths){for(const sub of subs)if(sub.active&&paths.some(p=>p===sub.path||p.startsWith(sub.path+'/')||sub.path.startsWith(p+'/')))queueMicrotask(()=>sub.active&&sub.cb({val:()=>clone(getPath(sub.path))}));}
function apply(p,values){const paths=[];for(const [k,v] of Object.entries(values)){const path=`${p}/${k}`;write(path,v);paths.push(path);}notify(paths);}
function makeClient(uid,history){const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});windows.push(dom.window);const w=dom.window,d=w.document;w.scrollTo=()=>{};w.confirm=()=>true;w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});w.HTMLCanvasElement.prototype.setPointerCapture=()=>{};w.FIREBASE_CONFIG={apiKey:'x',databaseURL:'https://example.test',projectId:'x',appId:'x'};
 const whistles=[],painted=[];w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},fillRect(){},drawImage(){},stroke(){painted.push(1);}});w.HTMLCanvasElement.prototype.toDataURL=()=>"data:image/png;base64,aGVsbG8=";w.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
 w.AudioContext=class {constructor(){this.state='running';this.currentTime=0;this.destination={};}decodeAudioData(){return Promise.resolve({});}createBufferSource(){return {connect(){},disconnect(){},start(){},stop(){}};}createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}createOscillator(){return {frequency:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},start(){whistles.push(true);},stop(){}};}};
 if(history)w.localStorage.setItem('oekaki-recent-rooms',history);
 connections[uid]={offline:[]};
 w.__firebaseMocks={initializeApp:()=>({}),getAuth:()=>({}),getDatabase:()=>({}),signInAnonymously:async()=>({user:{uid}}),ref:(_,p)=>p,query:p=>p,limitToLast:()=>{},serverTimestamp:()=>Date.now(),get:async p=>{if(p.startsWith('secrets/')){const [,c,g,t]=p.split('/'),current=getPath(`rooms/${c}`),end=getPath(`claims/${c}/${g}/${t}/ended/at`);if(!(current?.drawer===uid&&String(current.turn)===t)&&!(Number.isFinite(end)&&Date.now()>=end+2000)){const e=Error('permission_denied');e.code='PERMISSION_DENIED';throw e;}}return {val:()=>clone(getPath(p))};},push:p=>`${p}/${String(++seq).padStart(6,'0')}`,
 set:async(p,v)=>{if(p.startsWith('chats/')&&v){const [,c,g]=p.split('/'),current=getPath(`rooms/${c}`),t=current?.turn,end=getPath(`claims/${c}/${g}/${t}/ended/at`),secret=getPath(`secrets/${c}/${g}/${t}`);if((current.phase==='playing'&&v.text===secret&&!(Number.isFinite(end)&&Date.now()>=end+2000))||(v.kind==='correct'&&(!getPath(`verified/${c}/${g}/${v.turn}/${uid}`)||v.text!=='●●●'))){const error=Error('permission_denied');error.code='PERMISSION_DENIED';throw error;}}if(p.startsWith('verified/')&&v!==null&&p.split('/').length===5){const [,c,g,t]=p.split('/');if(v!==getPath(`secrets/${c}/${g}/${t}`)){const error=Error('permission_denied');error.code='PERMISSION_DENIED';throw error;}}write(p,v);notify([p]);},update:async(p,v)=>apply(p,v),onValue:(p,cb)=>{const sub={path:p,cb,active:true,uid};subs.push(sub);queueMicrotask(()=>sub.active&&cb({val:()=>p==='.info/connected'?true:p==='.info/serverTimeOffset'?0:clone(getPath(p))}));return ()=>{sub.active=false};},
 runTransaction:async(p,cb)=>{const val=cb(clone(getPath(p)));if(val===undefined)return {committed:false,snapshot:{val:()=>clone(getPath(p))}};write(p,val);notify([p]);return {committed:true,snapshot:{val:()=>clone(val)}};},onDisconnect:p=>({update:async v=>{connections[uid].offline.push({p,v});},cancel:async()=>{connections[uid].offline=[];}})};
 w.eval(built.outputFiles[0].text);d.dispatchEvent(new w.Event('pointerdown'));return {dom,d,w,uid,whistles,painted};}
function disconnect(client){for(const s of subs)if(s.uid===client.uid)s.active=false;for(const {p,v} of connections[client.uid].offline)apply(p,v);connections[client.uid].offline=[];client.dom.window.close();}
async function sendChat(client,text){client.d.querySelector('#chat-input').value=text;client.d.querySelector('#chat-form').dispatchEvent(new client.w.Event('submit',{bubbles:true,cancelable:true}));await wait();}
async function drawStroke(client){const canvas=client.d.querySelector('#canvas');canvas.getBoundingClientRect=()=>({left:0,top:0,width:900,height:900});for(const [type,x,y] of [['pointerdown',10,10],['pointermove',150,150],['pointerup',150,150]])canvas.dispatchEvent(new client.w.MouseEvent(type,{clientX:x,clientY:y,bubbles:true}));await wait(100);}
async function roomWithTwo(){const host=makeClient('host'),guest=makeClient('guest');host.d.querySelector('#create-name').value='ホスト';host.d.querySelector('#create').click();await wait();const code=Object.keys(data.rooms)[0];guest.d.querySelector('#join-name').value='ゲスト';guest.d.querySelector('#join-code').value=code;guest.d.querySelector('#join').click();await wait();assert.ok(getPath(`rooms/${code}/online/host`));assert.ok(getPath(`rooms/${code}/online/guest`));return {host,guest,code};}
// Tabs, settings and chat are accessible without scrolling the main game view.
{
 const c=makeClient('host');c.d.querySelector('#tab-join').click();assert.equal(c.d.body.classList.contains('join-mode'),true);assert.equal(c.d.querySelector('#tab-join').getAttribute('aria-selected'),'true');c.d.querySelector('#tab-create').click();assert.equal(c.d.body.classList.contains('join-mode'),false);
 c.d.querySelector('#create-name').value='ホスト';c.d.querySelector('#create').click();await wait();assert.ok(c.d.body.classList.contains('screen-lobby'));assert.equal(c.d.querySelector('#time-limit').value,'30');
 const colors=[...c.d.querySelectorAll('#colors button')];assert.equal(colors[0].getAttribute('aria-pressed'),'true');colors[1].click();assert.equal(colors[0].getAttribute('aria-pressed'),'false');assert.equal(colors[1].getAttribute('aria-pressed'),'true');colors[0].click();
 c.d.querySelector('#settings-open').click();assert.equal(c.d.querySelector('#settings-dialog').hasAttribute('open'),true);c.d.querySelector('#settings-close').click();assert.equal(c.d.querySelector('#settings-dialog').hasAttribute('open'),false);
 c.d.querySelector('#chat-expand').click();assert.ok(c.d.body.classList.contains('chat-open'));assert.equal(c.d.querySelector('#chat-expand').getAttribute('aria-expanded'),'true');c.d.querySelector('#chat-backdrop').click();assert.equal(c.d.body.classList.contains('chat-open'),false);
 assert.equal(c.d.querySelector('#music-toggle').getAttribute('aria-pressed'),'false');assert.equal(c.d.querySelector('#sound-toggle').getAttribute('aria-pressed'),'false');c.d.querySelector('#music-toggle').click();assert.equal(c.d.querySelector('#music-toggle').getAttribute('aria-pressed'),'true');c.d.querySelector('#music-toggle').click();assert.equal(c.d.querySelector('#music-toggle').getAttribute('aria-pressed'),'false');
 c.d.querySelector('#leave').click();await wait();assert.equal(c.d.body.classList.contains('screen-lobby'),false);c.dom.window.close();data={};subs=[];
}
// Public room entrances are shared, reusable after everyone leaves, and let
// a newcomer join the finished room without revealing private rooms.
{
 const host=makeClient('host'),guest=makeClient('guest');host.d.querySelector('#quick-name').value='ホスト';guest.d.querySelector('#quick-name').value='ゲスト';
 host.d.querySelector('[data-public-room="OPEN01"]').click();guest.d.querySelector('[data-public-room="OPEN01"]').click();await wait(200);
 assert.ok(getPath('rooms/OPEN01/players/host'));assert.ok(getPath('rooms/OPEN01/players/guest'));assert.match(host.d.querySelector('#room-code-title').textContent,/公開部屋/);
 write('rooms/OPEN01/phase','finished');notify(['rooms/OPEN01']);await wait();const late=makeClient('late');late.d.querySelector('#quick-name').value='新しい人';late.d.querySelector('[data-public-room="OPEN01"]').click();await wait();assert.ok(getPath('rooms/OPEN01/players/late'));
 host.d.querySelector('#leave').click();await wait();assert.equal(getPath('rooms/OPEN01'),undefined);for(const c of [guest,late]){assert.equal(c.d.querySelector('#home').classList.contains('hidden'),false);assert.match(c.d.querySelector('#toast').textContent,/GMが退出/);}
 host.d.querySelector('[data-public-room="OPEN01"]').click();await wait();assert.ok(getPath('rooms/OPEN01/players/host'));host.dom.window.close();guest.dom.window.close();late.dom.window.close();data={};subs=[];
}
// Single-player uses local data, draws a prepared topic and rejects wrong
// guesses. CPU answers are simulated without any Firebase writes.
{
 const c=makeClient('human');Object.defineProperty(c.w.crypto,'getRandomValues',{value:array=>{array.fill(0);return array;}});c.d.querySelector('#quick-name').value='ひとり';c.d.querySelector('#solo-start').click();await wait(250);
 assert.equal(c.d.querySelector('#time-limit').value,'30');assert.match(c.d.querySelector('#room-code-title').textContent,/CPU対戦/);assert.match(c.d.querySelector('#players').textContent,/もも CPU/);assert.deepEqual(data,{});
 c.d.querySelector('#time-limit').value='custom';c.d.querySelector('#custom-time').value='10';c.d.querySelector('#time-limit').dispatchEvent(new c.w.Event('change'));c.d.querySelector('#start').click();await wait(3500);
 assert.match(c.d.querySelector('.game-player.is-drawer').textContent,/CPU/);assert.ok(c.painted.length>0);await sendChat(c,'まちがい');assert.doesNotMatch(c.d.querySelector('#chat-messages').textContent,/正解！/);
 await wait(2500);assert.match(c.d.querySelector('#answer-slots').textContent,/正解 [1-2] \/ 3/);await sendChat(c,'いぬ');await wait(5500);assert.match(c.d.querySelector('#result').textContent,/答えは「いぬ」/);await wait(3000);assert.match(c.d.querySelector('#scoreboard-list').textContent,/ひとり/);assert.deepEqual(data,{});
 c.d.querySelector('#leave').click();await wait();assert.equal(c.d.querySelector('#home').classList.contains('hidden'),false);
 // Switching to a real room after solo restores the Firebase client.
 c.d.querySelector('#create-name').value='人間';c.d.querySelector('#create').click();await wait();assert.ok(data.rooms);c.dom.window.close();data={};subs=[];
}
// AI mode has one AI opponent, and sends drawings and guesses to the selected model.
{
 const c=makeClient('human');Object.defineProperty(c.w.crypto,'getRandomValues',{value:a=>{a.fill(0);return a;}});let elapsed=0;const now=Date.now;c.w.Date.now=()=>now()+elapsed;c.w.__firebaseMocks.serverTimestamp=()=>({'.sv':'timestamp'});const calls=[];
 c.w.fetch=async(url,options)=>{if(url==='/api/ai'){const body=JSON.parse(options.body);calls.push(body);if(body.action==='models')return {ok:true,json:async()=>({models:[{id:'gpt-test',label:'GPT Test'}]})};if(body.action==='guess')return {ok:true,json:async()=>({text:calls.filter(x=>x.action==='guess').length===1?'ねこ':'いぬ'})};return {ok:true,json:async()=>({text:JSON.stringify({strokes:[{color:'#393632',width:7,points:[[10,10],[200,200]]},{color:'#ef806d',width:7,points:[[250,100],[500,500]]}]})})};}return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)};};
 c.d.querySelector('#quick-name').value='ひとり';c.d.querySelector('#ai-key').value='test-key';c.d.querySelector('#ai-key').dispatchEvent(new c.w.Event('input'));c.d.querySelector('#ai-load-models').click();await wait();assert.ok([...c.d.querySelector('#ai-model').options].some(o=>o.value==='gpt-test'));c.d.querySelector('#ai-model').value='gpt-test';c.d.querySelector('#ai-start').click();await wait(150);assert.match(c.d.querySelector('#players').textContent,/あい AI/);assert.doesNotMatch(c.d.querySelector('#players').textContent,/CPU/);assert.equal(c.d.querySelector('#time-limit').value,'60');assert.equal(JSON.stringify(c.w.localStorage).includes('test-key'),false);c.d.querySelector('#start').click();await wait(200);
 elapsed+=4000;await wait(350);assert.match(c.d.querySelector('#turn-role-title').textContent,/あなたが描く番/);await drawStroke(c);elapsed+=15000;await wait(400);assert.match(c.d.querySelector('#chat-messages').textContent,/ねこ/);assert.doesNotMatch(c.d.querySelector('#chat-messages').textContent,/あい AI正解/);
 elapsed+=8000;await wait(400);const guesses=calls.filter(x=>x.action==='guess');assert.equal(guesses.length,2);assert.ok(guesses.every(x=>x.key==='test-key'&&x.provider==='openai'&&x.model==='gpt-test'&&x.image.startsWith('data:image/png;base64,')&&!Object.hasOwn(x,'word')));assert.match(c.d.querySelector('#chat-messages').textContent,/あい AI.*正解/);
 elapsed+=13500;await wait(450);c.d.querySelector('#next').click();await wait(200);elapsed+=4000;await wait(600);
 assert.match(c.d.querySelector('.game-player.is-drawer').textContent,/あい AI/);assert.equal(calls.filter(x=>x.action==='draw').length,1);assert.equal(calls.find(x=>x.action==='draw').model,'gpt-test');assert.equal(calls.find(x=>x.action==='draw').word,'うさぎ');assert.match(c.d.querySelector('#ai-game-status').textContent,/AIが生成した絵/);assert.ok(c.painted.length>0);
 c.d.querySelector('#leave').click();await wait(150);assert.equal(c.d.querySelector('#home').classList.contains('hidden'),false);assert.deepEqual(data,{});c.dom.window.close();data={};subs=[];
}
// Invalid models do not start; an API failure is visible and never simulated.
{
 const c=makeClient('human');Object.defineProperty(c.w.crypto,'getRandomValues',{value:a=>{a.fill(0);return a;}});let elapsed=0;const now=Date.now;c.w.Date.now=()=>now()+elapsed;c.w.__firebaseMocks.serverTimestamp=()=>({'.sv':'timestamp'});let count=0;
 c.w.fetch=async(url)=>{if(url==='/api/ai'){count++;return {ok:false,json:async()=>({error:'APIキーを確認してください。'})};}return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)};};
 c.d.querySelector('#quick-name').value='ひとり';c.d.querySelector('#ai-start').click();await wait();assert.match(c.d.querySelector('#toast').textContent,/APIキー/);assert.equal(c.d.querySelector('#home').classList.contains('hidden'),false);c.d.querySelector('#ai-key').value='invalid-key';c.d.querySelector('#solo-start').click();await wait();assert.match(c.d.querySelector('#toast').textContent,/モデル/);assert.equal(c.d.querySelector('#home').classList.contains('hidden'),false);assert.equal(count,0);
 c.d.querySelector('#ai-model').value='__custom';c.d.querySelector('#ai-model').dispatchEvent(new c.w.Event('change'));c.d.querySelector('#ai-custom-model').value='test-model';c.d.querySelector('#ai-start').click();await wait(150);c.d.querySelector('#start').click();await wait(200);elapsed+=4000;await wait(350);await drawStroke(c);elapsed+=15000;await wait(800);
 assert.equal(count,1);assert.match(c.d.querySelector('#ai-game-status').textContent,/APIキーを確認/);assert.match(c.d.querySelector('#ai-game-status').textContent,/CPUの代行はありません/);assert.doesNotMatch(c.d.querySelector('#chat-messages').textContent,/あい AI.*正解/);
 c.d.querySelector('#leave').click();await wait();c.dom.window.close();data={};subs=[];
}
// A delayed AI response after a turn ends cannot submit an answer or points.
{
 const c=makeClient('human');Object.defineProperty(c.w.crypto,'getRandomValues',{value:a=>{a.fill(0);return a;}});let elapsed=0,release;const now=Date.now;c.w.Date.now=()=>now()+elapsed;c.w.__firebaseMocks.serverTimestamp=()=>({'.sv':'timestamp'});
 c.w.fetch=async(url)=>url==='/api/ai'?new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({text:'いぬ'})});}):({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
 c.d.querySelector('#quick-name').value='ひとり';c.d.querySelector('#ai-key').value='key';c.d.querySelector('#ai-model').value='__custom';c.d.querySelector('#ai-custom-model').value='test-model';c.d.querySelector('#ai-start').click();await wait(150);c.d.querySelector('#start').click();await wait(200);elapsed+=4000;await wait(350);await drawStroke(c);elapsed+=15000;await wait(350);assert.equal(typeof release,'function');
 c.d.querySelector('#gm-open').click();c.d.querySelector('#whistle').click();await wait(150);release();await wait(350);assert.doesNotMatch(c.d.querySelector('#chat-messages').textContent,/あい AI.*正解/);assert.doesNotMatch(c.d.querySelector('#chat-messages').textContent,/いぬ/);
 c.d.querySelector('#leave').click();await wait();c.dom.window.close();data={};subs=[];
}
// A slow AI draw is not replaced by a prepared CPU drawing after 8 seconds.
{
 const c=makeClient('human');Object.defineProperty(c.w.crypto,'getRandomValues',{value:a=>{a.fill(1);return a;}});let elapsed=0,release;const now=Date.now;c.w.Date.now=()=>now()+elapsed;c.w.__firebaseMocks.serverTimestamp=()=>({'.sv':'timestamp'});let requests=0;
 c.w.fetch=async(url,options)=>{if(url!=='/api/ai')return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)};requests++;const body=JSON.parse(options.body);assert.equal(body.action,'draw');return new Promise(resolve=>{release=()=>resolve({ok:true,json:async()=>({text:JSON.stringify({strokes:[{color:'#393632',width:7,points:[[5,5],[200,200]]},{color:'#ef806d',width:6,points:[[300,300],[500,500]]}]})})});});};
 c.d.querySelector('#quick-name').value='ひとり';c.d.querySelector('#ai-key').value='key';c.d.querySelector('#ai-model').value='__custom';c.d.querySelector('#ai-custom-model').value='test-model';c.d.querySelector('#ai-start').click();await wait(150);c.d.querySelector('#start').click();await wait(650);assert.equal(requests,1);elapsed+=12000;await wait(500);assert.equal(c.painted.length,0);assert.match(c.d.querySelector('#ai-game-status').textContent,/生成を依頼/);release();await wait(650);assert.ok(c.painted.length>0);assert.match(c.d.querySelector('#ai-game-status').textContent,/AIが生成した絵/);
 c.d.querySelector('#leave').click();await wait();c.dom.window.close();data={};subs=[];
}
// A failed drawing remains blank and displays the actual safe error.
{
 const c=makeClient('human');Object.defineProperty(c.w.crypto,'getRandomValues',{value:a=>{a.fill(1);return a;}});c.w.fetch=async(url)=>url==='/api/ai'?({ok:false,json:async()=>({error:'利用制限または料金枠を確認してください。'})}):({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
 c.d.querySelector('#quick-name').value='ひとり';c.d.querySelector('#ai-key').value='key';c.d.querySelector('#ai-model').value='__custom';c.d.querySelector('#ai-custom-model').value='test-model';c.d.querySelector('#ai-start').click();await wait(150);c.d.querySelector('#start').click();await wait(4000);assert.equal(c.painted.length,0);assert.match(c.d.querySelector('#ai-game-status').textContent,/利用制限/);assert.match(c.d.querySelector('#ai-game-status').textContent,/CPUの絵は使いません/);
 c.d.querySelector('#leave').click();await wait();c.dom.window.close();data={};subs=[];
}
// A complete solo lap and an extra lap, including simulated CPU guesses on
// the human's drawing turn. A virtual clock avoids waiting for animations.
{
 const c=makeClient('human');Object.defineProperty(c.w.crypto,'getRandomValues',{value:a=>{a.fill(0);return a;}});let elapsed=0;const now=Date.now;c.w.Date.now=()=>now()+elapsed;c.w.__firebaseMocks.serverTimestamp=()=>({'.sv':'timestamp'});
 c.d.querySelector('#quick-name').value='ひとり';c.d.querySelector('#solo-start').click();await wait(150);c.d.querySelector('#start').click();await wait(250);
 for(let i=0;i<4;i++){
  elapsed+=i===2?20000:4000;await wait(350);
  if(i===2){assert.match(c.d.querySelector('#turn-role-title').textContent,/あなたが描く番/);assert.equal(c.d.querySelector('#game-stage').classList.contains('is-my-turn'),true);assert.match(c.d.querySelector('.game-player.is-drawer').textContent,/ひとり/);assert.match(c.d.querySelector('#answer-slots').textContent,/正解 [1-3] \/ 3/);}
  c.d.querySelector('#gm-open').click();assert.equal(c.d.querySelector('#gm-dialog').hasAttribute('open'),true);c.d.querySelector('#whistle').click();await wait(100);assert.equal(c.d.querySelector('#gm-dialog').hasAttribute('open'),false);elapsed+=13500;await wait(350);assert.equal(c.d.querySelector('#next').classList.contains('hidden'),false);c.d.querySelector('#next').click();await wait(150);
 }
 assert.match(c.d.querySelector('#prompt').textContent,/おつかれ/);assert.match(c.d.querySelector('#result').textContent,/ポイント/);assert.equal(c.d.querySelector('#game-players').dataset.heading,'最終順位');assert.match(c.d.querySelector('#guide-title').textContent,/次はどうする/);assert.match(c.d.querySelector('#guide-description').textContent,/得点を引き継ぐ/);assert.match(c.d.querySelector('.game-player-name').textContent,/位/);assert.equal(c.d.querySelector('#final-scene').classList.contains('hidden'),false);assert.match(c.d.querySelector('#final-winners').textContent,/ひとり|CPU/);elapsed+=5000;await wait(350);assert.equal(c.d.querySelector('#final-scene').classList.contains('hidden'),true);
 c.d.querySelector('#again').click();await wait(200);assert.match(c.d.querySelector('#turn-label').textContent,/5 \/ 8/);assert.match(c.d.querySelector('.game-player.is-drawer').textContent,/CPU/);
 elapsed+=4000;await wait(900);assert.equal(c.d.querySelector('#canvas-placeholder').classList.contains('hidden'),true);assert.deepEqual(data,{});c.dom.window.close();data={};subs=[];
}
// The GM's explicit exit closes the room even while other participants (or
// another GM tab) are online. Cancel leaves the room unchanged.
for(const phase of ['lobby','playing','finished']){
 const {host,guest,code}=await roomWithTwo();const game=getPath(`rooms/${code}/gameId`);
 if(phase!=='lobby'){host.d.querySelector('#start').click();await wait();if(phase==='finished'){write(`rooms/${code}/phase`,'finished');notify([`rooms/${code}`]);await wait();}}
 for(const root of ['secrets','claims','drawings','chats','hints','verified','chatGuard','passCandidates'])write(`${root}/${code}/${game}/dummy`,{x:1});
 write(`rooms/${code}/online/host/other-tab`,true);notify([`rooms/${code}/online/host/other-tab`]);await wait();
 let prompt='';host.w.confirm=message=>{prompt=message;return false;};host.d.querySelector('#leave').click();await wait();assert.match(prompt,/GM.*部屋が解散/);assert.equal(getPath(`rooms/${code}/phase`),phase);assert.ok(getPath(`rooms/${code}/players/guest`));
 host.w.confirm=()=>true;host.d.querySelector('#leave').click();await wait(200);assert.equal(getPath(`rooms/${code}`),undefined);for(const root of ['secrets','claims','drawings','chats','hints','verified','chatGuard','passCandidates'])assert.equal(getPath(`${root}/${code}/${game}`),undefined,root);
 assert.equal(guest.d.querySelector('#home').classList.contains('hidden'),false);assert.match(guest.d.querySelector('#toast').textContent,/GMが退出/);assert.equal(host.d.querySelector('#home').classList.contains('hidden'),false);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// A non-GM leaving does not dissolve the room.
{
 const {host,guest,code}=await roomWithTwo();guest.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}/host`),'host');assert.ok(getPath(`rooms/${code}/players/host`));assert.equal(getPath(`rooms/${code}/players/guest`),undefined);
 host.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}`),undefined);host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// Unexpected host disconnect triggers election and leaves guest in the room.
{
 const {host,guest,code}=await roomWithTwo();disconnect(host);await wait(400);assert.equal(getPath(`rooms/${code}/host`),'guest');assert.equal(getPath(`rooms/${code}/online/host`),undefined);guest.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}`),undefined);guest.dom.window.close();data={};subs=[];
}
// An absent drawer is skipped immediately without result scenes; existing answers keep points.
{
 const {host,guest,code}=await roomWithTwo(),third=makeClient('third');third.d.querySelector('#join-name').value='3人目';third.d.querySelector('#join-code').value=code;third.d.querySelector('#join').click();await wait();host.d.querySelector('#time-limit').value='0';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`),start=Date.now()-10000;
 write(`rooms/${code}/schedule`,['guest','host','third','guest','host']);write(`rooms/${code}/scheduleIndex`,0);write(`rooms/${code}/turn`,0);write(`rooms/${code}/drawer`,'guest');write(`rooms/${code}/turnStartedAt`,start);write(`claims/${code}/${game}/0`,{slots:{s0:{uid:'third',at:Date.now()-1000,startedAt:start+3000,duration:0}}});notify([`rooms/${code}`,`claims/${code}/${game}/0`]);await wait();disconnect(guest);write(`rooms/${code}/lastDisconnects/guest`,Date.now()-50);notify([`rooms/${code}/lastDisconnects/guest`]);await wait(700);
 assert.equal(getPath(`claims/${code}/${game}/0`).ended.reason,'skip');assert.equal(getPath(`rooms/${code}/turn`),1);assert.equal(getPath(`rooms/${code}/drawer`),'host');assert.equal(getPath(`rooms/${code}/maxCorrect`),1);assert.match(host.d.querySelector('#game-players').textContent,/3人目.*1 pt/);for(const id of ['round-end','answer-scene','scoreboard'])assert.ok(host.d.querySelector('#'+id).classList.contains('hidden'),id);assert.doesNotMatch(host.d.querySelector('#result').textContent,/離席|正解者はいません/);
 host.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}`),undefined);host.dom.window.close();third.dom.window.close();data={};subs=[];
}
// A drawer already offline is omitted when advancing, with the original turn ID preserved.
{
 const {host,guest,code}=await roomWithTwo(),third=makeClient('third');third.d.querySelector('#join-name').value='3人目';third.d.querySelector('#join-code').value=code;third.d.querySelector('#join').click();await wait();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);disconnect(guest);write(`rooms/${code}/schedule`,['host','guest','third']);write(`rooms/${code}/scheduleIndex`,0);write(`rooms/${code}/turn`,0);write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnIds`,{2:7});write(`rooms/${code}/lengths/7`,2);write(`secrets/${code}/${game}/7`,'ねこ');write(`claims/${code}/${game}/0`,{ended:{reason:'whistle',at:Date.now()-14000}});notify([`rooms/${code}`,`claims/${code}/${game}/0`]);await wait(500);host.d.querySelector('#next').click();await wait(300);assert.equal(getPath(`rooms/${code}/scheduleIndex`),2);assert.equal(getPath(`rooms/${code}/turn`),7);assert.equal(getPath(`rooms/${code}/drawer`),'third');assert.equal(getPath(`claims/${code}/${game}/1`),undefined);host.d.querySelector('#leave').click();await wait();host.dom.window.close();third.dom.window.close();data={};subs=[];
}
// A persisted skip stays silent even if the host has not advanced yet.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);const transaction=host.w.__firebaseMocks.runTransaction;host.w.__firebaseMocks.runTransaction=async(p,cb)=>p===`rooms/${code}`?new Promise(()=>{}):transaction(p,cb);
 write(`rooms/${code}/drawer`,'guest');write(`claims/${code}/${game}/0`,{ended:{reason:'skip',at:Date.now()-5000},slots:{s0:{uid:'host',at:Date.now()-10000,startedAt:Date.now()-12000,duration:60}}});write(`chats/${code}/${game}/mock`,{uid:'host',name:'ホスト',text:'●●●',kind:'correct',turn:0,at:Date.now()});notify([`rooms/${code}`,`claims/${code}/${game}/0`,`chats/${code}/${game}`]);await wait(500);
 for(const id of ['round-end','answer-scene','scoreboard','result'])assert.ok(host.d.querySelector('#'+id).classList.contains('hidden'),id);assert.match(host.d.querySelector('#chat-messages').textContent,/●/);assert.doesNotMatch(host.d.querySelector('#chat-messages').textContent,/正解！ [ぁ-ゖー]+/);host.w.__firebaseMocks.runTransaction=transaction;host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// If the GM disconnects after recording a skip, the new GM completes it.
{
 const {host,guest,code}=await roomWithTwo(),third=makeClient('third');third.d.querySelector('#join-name').value='3人目';third.d.querySelector('#join-code').value=code;third.d.querySelector('#join').click();await wait();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/schedule`,['host','guest','third']);write(`rooms/${code}/scheduleIndex`,0);write(`rooms/${code}/turn`,0);write(`rooms/${code}/drawer`,'host');write(`claims/${code}/${game}/0`,{ended:{reason:'skip',at:Date.now()-100}});disconnect(host);notify([`rooms/${code}`,`claims/${code}/${game}/0`]);await wait(900);
 assert.equal(getPath(`rooms/${code}/host`),'guest');assert.equal(getPath(`rooms/${code}/turn`),1);assert.equal(getPath(`rooms/${code}/drawer`),'guest');assert.ok(guest.d.querySelector('#answer-scene').classList.contains('hidden'));guest.d.querySelector('#leave').click();await wait();guest.dom.window.close();third.dom.window.close();data={};subs=[];
}
// With no other connected players, finishing replaces an unplayable turn.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);write(`rooms/${code}/drawer`,'guest');notify([`rooms/${code}/drawer`]);disconnect(guest);write(`rooms/${code}/lastDisconnects/guest`,Date.now()-50);notify([`rooms/${code}/lastDisconnects/guest`]);await wait(700);assert.equal(getPath(`claims/${code}/${game}/0`).ended.reason,'skip');assert.equal(getPath(`rooms/${code}/phase`),'finished');assert.ok(host.d.querySelector('#answer-scene').classList.contains('hidden'));host.d.querySelector('#leave').click();await wait();host.dom.window.close();data={};subs=[];
}
// The new default is used in a real start, and typing outside controls goes
// to chat without consuming shortcuts, dialogs or IME composition events.
{
 const {host,guest,code}=await roomWithTwo();assert.equal(host.d.querySelector('#time-limit').value,'30');host.d.querySelector('#start').click();await wait();assert.equal(getPath(`rooms/${code}/timeLimit`),30);
 const input=guest.d.querySelector('#chat-input'),canvas=guest.d.querySelector('#canvas');
 const key=(target,k,extra={})=>{const event=new guest.w.KeyboardEvent('keydown',{key:k,bubbles:true,cancelable:true,...extra});target.dispatchEvent(event);return event;};
 assert.ok(input.disabled);key(guest.d.body,'a');assert.equal(input.value,'');
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(350);assert.equal(input.disabled,false);
 assert.ok(guest.d.querySelector('#game-stage').contains(guest.d.querySelector('#word-count')));assert.ok(guest.d.querySelector('#game-stage').contains(guest.d.querySelector('#word-tiles')));
 const first=key(canvas,'a');assert.equal(first.defaultPrevented,true);assert.equal(input.value,'a');assert.equal(guest.d.activeElement,input);
 input.blur();key(guest.d.body,'い');assert.equal(input.value,'aい');input.blur();
 key(guest.d.body,'v',{ctrlKey:true});assert.equal(guest.d.activeElement,guest.d.body);assert.equal(input.value,'aい');
 const button=guest.d.querySelector('#chat-expand');button.focus();const space=key(button,' ');assert.equal(space.defaultPrevented,false);assert.equal(guest.d.activeElement,button);
 const range=guest.d.querySelector('#brush-size');range.focus();key(range,'9');assert.equal(guest.d.activeElement,range);assert.equal(input.value,'aい');
 guest.d.querySelector('#gm-dialog').setAttribute('open','');key(guest.d.body,'x');assert.equal(input.value,'aい');guest.d.querySelector('#gm-dialog').removeAttribute('open');
 const ime=key(guest.d.body,'Process',{isComposing:true,keyCode:229});assert.equal(ime.defaultPrevented,false);assert.equal(guest.d.activeElement,input);assert.equal(input.value,'aい');
 input.value='x'.repeat(200);input.blur();key(guest.d.body,'b');assert.equal(input.value.length,200);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// Timed gauge, word length and hint are visible to both roles and use the
// same bands as scoring. A hint is announced only to answerers.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='60';host.d.querySelector('#answer-middle').value='12';host.d.querySelector('#drawer-middle').value='8';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/schedule`,['host','guest']);write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(350);
 for(const c of [host,guest]){assert.equal(c.d.querySelector('#word-count').textContent,`${getPath(`rooms/${code}/lengths/0`)}文字`);assert.equal(c.d.querySelector('#score-gauge').classList.contains('hidden'),false);assert.deepEqual([...c.d.querySelectorAll('.gauge-band')].map(x=>x.textContent),['20 / 15点','12 / 8点','5 / 3点']);assert.equal(c.d.querySelector('.gauge-band.is-current').dataset.band,'0');}
 write(`rooms/${code}/turnStartedAt`,Date.now()-33000);notify([`rooms/${code}/turnStartedAt`]);await wait(350);assert.equal(guest.d.querySelector('.gauge-band.is-current').dataset.band,'1');assert.match(guest.d.querySelector('.gauge-track').getAttribute('aria-valuetext'),/答える人12点、描く人8点/);
 write(`rooms/${code}/turnStartedAt`,Date.now()-54000);notify([`rooms/${code}/turnStartedAt`]);await wait(450);assert.equal(guest.d.querySelector('.gauge-band.is-current').dataset.band,'2');assert.equal(guest.d.querySelector('#hint-notice').classList.contains('hidden'),false);assert.equal(guest.d.querySelector('#hint-state').classList.contains('hidden'),false);assert.ok(guest.d.querySelector('.word-tile.hint'));assert.equal(host.d.querySelector('#hint-state').classList.contains('hidden'),true);assert.equal(host.d.querySelector('#hint-notice').classList.contains('hidden'),true);
 const tile=guest.d.querySelector('.word-tile.hint');notify([`rooms/${code}`]);await wait();assert.equal(guest.d.querySelector('.word-tile.hint'),tile);
 write(`claims/${code}/${game}/0`,{ended:{reason:'whistle',at:Date.now()}});notify([`claims/${code}/${game}/0`]);await wait();assert.equal(guest.d.querySelector('#hint-notice').classList.contains('hidden'),true);assert.equal(guest.d.querySelector('#hint-state').classList.contains('hidden'),true);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// No timer means no three-band gauge.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='0';host.d.querySelector('#start').click();await wait(300);assert.equal(host.d.querySelector('#score-gauge').classList.contains('hidden'),true);assert.match(host.d.querySelector('#word-count').textContent,/文字/);host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// Two answer slots: the first answer does not reveal or end the turn.
{
 const {host,guest,code}=await roomWithTwo();const third=makeClient('third');third.d.querySelector('#join-name').value='さんにんめ';third.d.querySelector('#join-code').value=code;third.d.querySelector('#join').click();await wait();
 for(const client of [host,guest,third])client.d.querySelector('#sound-toggle').click();
 host.d.querySelector('#time-limit').value='60';host.d.querySelector('#max-correct').value='2';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/schedule`,['host','guest','third']);write(`rooms/${code}/turnStartedAt`,Date.now()-3001);notify([`rooms/${code}`]);await wait();
 const word=getPath(`secrets/${code}/${game}/0`);
 assert.match(host.d.querySelector('.is-drawer .game-player-role').textContent,/あなたが描く番/);assert.match(guest.d.querySelector('.is-drawer .game-player-role').textContent,/ホストがおえかき中/);assert.match(host.d.querySelector('#turn-role-title').textContent,/あなたが描く番/);assert.match(host.d.querySelector('#compact-role').textContent,/あなたが描く/);assert.match(host.d.querySelector('#canvas-placeholder').textContent,/絵を描こう/);assert.match(guest.d.querySelector('#turn-role-title').textContent,/あなたは答える番/);assert.match(guest.d.querySelector('#compact-role').textContent,/答える番/);assert.equal(host.d.querySelector('#game-stage').classList.contains('is-my-turn'),true);assert.equal(guest.d.querySelector('#game-stage').classList.contains('is-my-turn'),false);assert.match(guest.d.querySelector('#guide-description').textContent,/ひらがな/);
 await sendChat(host,word);assert.equal(getPath(`chats/${code}/${game}`),undefined);assert.match(host.d.querySelector('#toast').textContent,/お題をチャットに送れません/);
 await sendChat(host,'がんばって！');assert.equal(Object.values(getPath(`chats/${code}/${game}`)).at(-1).text,'がんばって！');
 const realSet=guest.w.__firebaseMocks.set;guest.w.__firebaseMocks.set=async(p,v)=>{if(p.startsWith('chatGuard/')){const e=Error('permission_denied');e.code='PERMISSION_DENIED';throw e;}return realSet(p,v);};
 await sendChat(guest,word);assert.match(guest.d.querySelector('#toast').textContent,/Firebaseルール/);assert.equal(getPath(`claims/${code}/${game}/0`),undefined);assert.ok(!Object.values(getPath(`chats/${code}/${game}`)).some(m=>m.text===word));guest.w.__firebaseMocks.set=realSet;
 await sendChat(guest,'まちがい');assert.equal(getPath(`claims/${code}/${game}/0`),undefined);assert.equal(Object.values(getPath(`chats/${code}/${game}`)).at(-1).text,'まちがい');
 await sendChat(guest,word);const first=getPath(`claims/${code}/${game}/0`);assert.equal(Object.keys(first.slots).length,1);assert.equal(first.ended,undefined);assert.equal(JSON.stringify(first).includes(word),false);assert.match(host.d.querySelector('#answer-slots').textContent,/1 \/ 2/);assert.equal(host.d.querySelector('#result').classList.contains('hidden'),true);assert.equal(host.d.querySelector('#round-end').classList.contains('hidden'),true);assert.equal(host.whistles.length,0);assert.match(host.d.querySelector('#correct-notice-name').textContent,/ゲストさん 正解/);assert.equal(host.d.querySelector('#correct-notice').classList.contains('hidden'),false);
 const filledSlot=host.d.querySelector('.answer-slot.filled');assert.ok(filledSlot);assert.equal(filledSlot.classList.contains('no-pop'),false);assert.match(guest.d.querySelector('#turn-role-title').textContent,/正解！待機中/);assert.match(guest.d.querySelector('#compact-role').textContent,/正解済み/);assert.equal(guest.d.querySelector('.game-player.has-answered').getAttribute('aria-label').includes('正解済み'),true);
 const earlyReturn=makeClient('guest');earlyReturn.d.querySelector('#join-name').value='ゲスト';earlyReturn.d.querySelector('#join-code').value=code;earlyReturn.d.querySelector('#join').click();await wait();assert.equal(earlyReturn.d.querySelector('.answer-slot.filled').classList.contains('no-pop'),true);earlyReturn.dom.window.close();const masked=Object.values(getPath(`chats/${code}/${game}`)).at(-1);assert.equal(masked.text,'●●●');assert.equal(masked.kind,'correct');assert.equal(masked.turn,0);assert.match(host.d.querySelector('#chat-messages').textContent,/正解！ ●/);assert.ok(!host.d.querySelector('#chat-messages').textContent.includes(word));
 assert.equal(host.d.querySelector('#pass-topic').disabled,true);
 await sendChat(guest,'こんにちは');assert.equal(host.d.querySelector('.answer-slot.filled'),filledSlot);assert.equal(Object.values(getPath(`chats/${code}/${game}`)).at(-1).text,'こんにちは');assert.equal(Object.keys(getPath(`claims/${code}/${game}/0/slots`)).length,1);
 guest.d.querySelector('#sound-toggle').click();
 await sendChat(third,word);const final=getPath(`claims/${code}/${game}/0`);assert.equal(final.ended.reason,'full');assert.equal(Object.keys(final.slots).length,2);assert.match(host.d.querySelector('#result').textContent,/終了/);assert.equal(host.d.querySelector('#next').classList.contains('hidden'),true);
 for(const c of [host,guest,third])assert.equal(c.d.querySelector('#round-end').classList.contains('hidden'),false);
 for(const c of [host,guest,third])assert.equal(c.d.querySelector('#chat-input').disabled,true);
 assert.equal(host.whistles.length,2);assert.equal(third.whistles.length,2);assert.equal(guest.whistles.length,0);assert.ok(Object.values(getPath(`chats/${code}/${game}`)).filter(m=>m.kind==='correct').every(m=>m.text==='●●●'));assert.ok(!host.d.querySelector('#chat-messages').textContent.includes(word));
 notify([`claims/${code}/${game}/0`]);await wait();assert.equal(host.whistles.length,2);
 write(`claims/${code}/${game}/0/ended/at`,Date.now()-1000);notify([`claims/${code}/${game}/0`]);await wait(100);assert.equal(host.d.querySelector('#round-end').classList.contains('hidden'),false);assert.equal(host.whistles.length,2);assert.equal(host.d.querySelector('#chat-input').disabled,true);assert.doesNotMatch(host.d.querySelector('#chat-messages').textContent,new RegExp(`正解！ ${word}`));
 write(`claims/${code}/${game}/0/ended/at`,Date.now()-3400);notify([`claims/${code}/${game}/0`]);await wait(150);for(const c of [host,guest,third]){assert.equal(c.d.querySelector('#round-end').classList.contains('hidden'),true);assert.equal(c.d.querySelector('#answer-scene').classList.contains('hidden'),false);assert.equal(c.d.querySelector('#answer-scene-word').textContent,word);}assert.equal(host.d.querySelector('#chat-input').disabled,false);assert.match(host.d.querySelector('#result').textContent,/答えは/);assert.match(host.d.querySelector('#chat-messages').textContent,new RegExp(`正解！ ${word}`));assert.match(host.d.querySelector('#result').textContent,/ゲスト \+20点/);assert.match(host.d.querySelector('#result').textContent,/さんにんめ \+20点/);assert.match(host.d.querySelector('#result').textContent,/ホスト \+30点/);
 // Seed earlier scores so this round produces an actual rank reversal.
 write(`rooms/${code}/players/host/score`,10);write(`rooms/${code}/players/guest/score`,50);write(`rooms/${code}/players/third/score`,15);write(`claims/${code}/${game}/0/ended/at`,Date.now()-6100);notify([`rooms/${code}/players`,`claims/${code}/${game}/0`]);await wait(150);for(const c of [host,guest,third]){assert.equal(c.d.querySelector('#answer-scene').classList.contains('hidden'),true);assert.equal(c.d.querySelector('#scoreboard').classList.contains('hidden'),false);assert.match(c.d.querySelector('#scoreboard-list').textContent,/ホスト.*\+30/);assert.match(c.d.querySelector('#scoreboard-list').textContent,/ゲスト.*\+20/);const row=[...c.d.querySelectorAll('.scoreboard-row')].find(r=>r.querySelector('.scoreboard-name').textContent==='ホスト');assert.equal(row.querySelector('.rank-before').textContent,'3位');assert.equal(row.querySelector('.rank-after').textContent,'2位');assert.equal(row.querySelector('.rank-change').textContent,'▲1');assert.match(row.getAttribute('aria-label'),/10点から40点、2位/);}
 // A newcomer during the scoreboard is inserted without restarting the show.
 const initialOffset=host.d.querySelector('#scoreboard').style.getPropertyValue('--scene-offset');const late=makeClient('late');late.d.querySelector('#join-name').value='後から';late.d.querySelector('#join-code').value=code;late.d.querySelector('#join').click();await wait(200);assert.equal(host.d.querySelectorAll('.scoreboard-row').length,4);assert.equal(host.d.querySelector('#scoreboard').style.getPropertyValue('--scene-offset'),initialOffset);assert.match(host.d.querySelector('#scoreboard-list').textContent,/後から/);late.dom.window.close();

 assert.equal(host.d.querySelector('#next').classList.contains('hidden'),true);
 // Reconnecting after the reveal must not replay an old whistle or overlay.
 const returning=makeClient('guest');returning.d.querySelector('#join-name').value='ゲスト';returning.d.querySelector('#join-code').value=code;returning.d.querySelector('#join').click();await wait();assert.equal(returning.whistles.length,0);assert.equal(returning.d.querySelector('#round-end').classList.contains('hidden'),true);assert.equal(returning.d.querySelector('#scoreboard').classList.contains('hidden'),false);assert.ok(parseFloat(returning.d.querySelector('#scoreboard').style.getPropertyValue('--scene-offset'))<0);assert.match(returning.d.querySelector('#chat-messages').textContent,new RegExp(`正解！ ${word}`));returning.dom.window.close();
 write(`claims/${code}/${game}/0/ended/at`,Date.now()-13000);notify([`claims/${code}/${game}/0`]);await wait(300);assert.equal(host.d.querySelector('#scoreboard').classList.contains('hidden'),true);assert.equal(host.d.querySelector('#next').classList.contains('hidden'),false);host.d.querySelector('#next').click();await wait();assert.equal(getPath(`rooms/${code}/turn`),1);assert.equal(host.d.querySelector('#countdown').classList.contains('hidden'),false);
 const afterNext=makeClient('guest');afterNext.d.querySelector('#join-name').value='ゲスト';afterNext.d.querySelector('#join-code').value=code;afterNext.d.querySelector('#join').click();await wait();assert.match(afterNext.d.querySelector('#chat-messages').textContent,new RegExp(`正解！ ${word}`));afterNext.dom.window.close();
 write(`rooms/${code}/turnStartedAt`,Date.now()-64000);notify([`rooms/${code}/turnStartedAt`]);await wait(500);assert.equal(getPath(`claims/${code}/${game}/1`).ended.reason,'time');assert.match(host.d.querySelector('#result').textContent,/時間切れ/);
 host.dom.window.close();guest.dom.window.close();third.dom.window.close();data={};subs=[];
}
// Pass keeps the original timer, changes only the topic and clears the drawing.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='60';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/schedule`,['host','guest']);write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(350);
 assert.equal(host.d.querySelector('#pass-topic').disabled,false);assert.equal(guest.d.querySelector('#gm-open').classList.contains('hidden'),true);
 const started=getPath(`rooms/${code}/turnStartedAt`),old=getPath(`secrets/${code}/${game}/0`),gaugeBefore=Number(guest.d.querySelector('.gauge-track').getAttribute('aria-valuenow'));host.d.querySelector('#pass-topic').click();await wait();
 assert.equal(getPath(`claims/${code}/${game}/0/ended/reason`),'pass');assert.notEqual(getPath(`passCandidates/${code}/${game}/0`),old);
 for(const c of [host,guest]){assert.equal(c.d.querySelector('#round-end').classList.contains('hidden'),false);assert.match(c.d.querySelector('#round-end').textContent,/パス/);assert.equal(c.d.querySelector('#chat-input').disabled,true);}
 write(`claims/${code}/${game}/0/ended/at`,Date.now()-2200);notify([`claims/${code}/${game}/0`]);await wait(450);
 assert.equal(getPath(`rooms/${code}/turn`),8);assert.equal(getPath(`rooms/${code}/turnStartedAt`),started);assert.ok(Number(guest.d.querySelector('.gauge-track').getAttribute('aria-valuenow'))>=gaugeBefore);assert.equal(getPath(`rooms/${code}/turnIds/0`),8);assert.equal(getPath(`rooms/${code}/scheduleIndex`),0);assert.equal(getPath(`rooms/${code}/drawer`),'host');assert.notEqual(getPath(`secrets/${code}/${game}/8`),old);assert.equal(getPath(`rooms/${code}/lengths/8`),getPath(`secrets/${code}/${game}/8`).length);assert.match(host.d.querySelector('#turn-label').textContent,/1 \/ 2/);assert.equal(host.d.querySelector('#round-end').classList.contains('hidden'),true);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait(350);host.d.querySelector('#pass-topic').click();await wait();write(`claims/${code}/${game}/8/ended/at`,Date.now()-2200);notify([`claims/${code}/${game}/8`]);await wait(1400);assert.equal(getPath(`rooms/${code}/turn`),9);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait(350);await sendChat(guest,getPath(`secrets/${code}/${game}/9`));await wait(3400);assert.equal(getPath(`claims/${code}/${game}/9/slots/s0/uid`),'guest');assert.match(host.d.querySelector('#result').textContent,/ホスト \+15点/);assert.match(host.d.querySelector('#result').textContent,/ゲスト \+20点/);write(`claims/${code}/${game}/9/ended/at`,Date.now()-13000);notify([`claims/${code}/${game}/9`]);await wait(300);host.d.querySelector('#next').click();await wait();assert.equal(getPath(`rooms/${code}/turn`),1);assert.equal(getPath(`rooms/${code}/scheduleIndex`),1);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// The pass announcement consumes time too; an expired turn ends immediately.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='30';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/schedule`,['host','guest']);write(`rooms/${code}/turnStartedAt`,Date.now()-31000);notify([`rooms/${code}`]);await wait(250);
 host.d.querySelector('#pass-topic').click();await wait();assert.equal(getPath(`claims/${code}/${game}/0/ended/reason`),'pass');
 await wait(3000);assert.equal(getPath(`rooms/${code}/turn`),8);assert.equal(getPath(`claims/${code}/${game}/8/ended/reason`),'time');assert.equal(host.d.querySelector('#countdown').classList.contains('hidden'),true);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// Configurable awards survive returning to the lobby and include drawer points.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='60';host.d.querySelector('#answer-early').value='24';host.d.querySelector('#drawer-early').value='12';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/schedule`,['host','guest']);write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();await sendChat(guest,getPath(`secrets/${code}/${game}/0`));write(`claims/${code}/${game}/0/ended/at`,Date.now()-13000);notify([`claims/${code}/${game}/0`]);await wait(300);
 host.d.querySelector('#gm-open').click();host.d.querySelector('#force-end').click();await wait();assert.equal(getPath(`rooms/${code}/players/host/score`),12);assert.equal(getPath(`rooms/${code}/players/guest/score`),24);assert.equal(host.d.querySelector('#answer-early').value,'24');assert.equal(host.d.querySelector('#drawer-early').value,'12');
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// GM can return the match to the lobby with confirmed scores, then restart cleanly.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='0';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();await sendChat(guest,getPath(`secrets/${code}/${game}/0`));await wait(2200);
 guest.d.querySelector('#gm-open').click();assert.equal(guest.d.querySelector('#gm-dialog').hasAttribute('open'),false);
 host.d.querySelector('#gm-open').click();assert.equal(host.d.querySelector('#gm-dialog').hasAttribute('open'),true);host.d.querySelector('#force-end').click();await wait();
 assert.equal(getPath(`rooms/${code}/phase`),'lobby');assert.equal(getPath(`rooms/${code}/players/guest/score`),1);assert.match(guest.d.querySelector('#players').textContent,/ゲスト.*1 pt/);assert.ok(getPath(`rooms/${code}/players/host`));
 const oldMatch=getPath(`rooms/${code}/matchId`);host.d.querySelector('#start').click();await wait(250);assert.equal(getPath(`rooms/${code}/phase`),'playing');assert.equal(getPath(`rooms/${code}/players/guest/score`),0);assert.equal(getPath(`claims/${code}/${game}`),undefined);assert.notEqual(getPath(`rooms/${code}/matchId`),oldMatch);assert.notEqual(getPath(`rooms/${code}/gameId`),game);
 const newGame=getPath(`rooms/${code}/gameId`);write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(250);await sendChat(guest,getPath(`secrets/${code}/${newGame}/0`));assert.equal(getPath(`claims/${code}/${newGame}/0/slots/s0/uid`),'guest');
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// Play a full two-person lap through the normal result screens, then replay.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='0';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/order`,['host','guest']);write(`rooms/${code}/schedule`,['host','guest']);write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();
 await sendChat(guest,getPath(`secrets/${code}/${game}/0`));write(`claims/${code}/${game}/0/ended/at`,Date.now()-13000);notify([`claims/${code}/${game}/0`]);await wait(400);host.d.querySelector('#next').click();await wait();
 assert.equal(getPath(`rooms/${code}/turn`),1);write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait(250);await sendChat(host,getPath(`secrets/${code}/${game}/1`));write(`claims/${code}/${game}/1/ended/at`,Date.now()-13000);notify([`claims/${code}/${game}/1`]);await wait(400);host.d.querySelector('#next').click();await wait();
 assert.equal(getPath(`rooms/${code}/phase`),'finished');assert.match(host.d.querySelector('#result').textContent,/ポイント/);host.d.querySelector('#again').click();await wait(250);assert.equal(getPath(`rooms/${code}/phase`),'playing');assert.equal(getPath(`rooms/${code}/turn`),8);assert.equal(getPath(`rooms/${code}/extraRounds`),1);assert.match(host.d.querySelector('#game-players').textContent,/ゲスト.*1 pt/);assert.match(host.d.querySelector('#game-players').textContent,/ホスト.*1 pt/);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// At a normal finish, only the GM chooses; another round keeps scores and
// uses fresh IDs even when earlier passes consumed reserved turn numbers.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='60';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();await sendChat(guest,getPath(`secrets/${code}/${game}/0`));
 write(`claims/${code}/${game}/0/ended/at`,Date.now()-2200);write(`rooms/${code}/schedule`,['host','guest','host','guest','host','guest','host','guest']);write(`rooms/${code}/order`,['host','guest']);write(`rooms/${code}/scheduleIndex`,7);write(`rooms/${code}/nextTurnIndex`,10);write(`rooms/${code}/phase`,'finished');notify([`rooms/${code}`,`claims/${code}/${game}/0`]);await wait(350);
 assert.equal(host.d.querySelector('#final-controls').classList.contains('hidden'),false);assert.equal(host.d.querySelector('#final-host-actions').classList.contains('hidden'),false);assert.equal(guest.d.querySelector('#final-host-actions').classList.contains('hidden'),true);assert.equal(guest.d.querySelector('#final-wait').classList.contains('hidden'),false);
 guest.d.querySelector('#again').click();await wait();assert.equal(getPath(`rooms/${code}/phase`),'finished');
 host.d.querySelector('#again').click();await wait(200);assert.equal(getPath(`rooms/${code}/phase`),'playing');assert.equal(getPath(`rooms/${code}/gameId`),game);assert.equal(getPath(`rooms/${code}/scheduleIndex`),8);assert.equal(getPath(`rooms/${code}/turn`),10);assert.equal(getPath(`rooms/${code}/extraRounds`),1);assert.equal(getPath(`rooms/${code}/nextTurnIndex`),18);assert.equal(getPath(`rooms/${code}/turnIds/8`),10);assert.ok(getPath(`secrets/${code}/${game}/10`));assert.ok(getPath(`hints/${code}/${game}/10`));assert.match(host.d.querySelector('#game-players').textContent,/ゲスト.*20 pt/);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(250);await sendChat(guest,getPath(`secrets/${code}/${game}/10`));write(`claims/${code}/${game}/10/ended/at`,Date.now()-13000);notify([`claims/${code}/${game}/10`]);await wait(400);assert.match(host.d.querySelector('#game-players').textContent,/ゲスト.*40 pt/);host.d.querySelector('#next').click();await wait();assert.equal(getPath(`rooms/${code}/turn`),11);assert.equal(getPath(`rooms/${code}/scheduleIndex`),9);
 write(`rooms/${code}/phase`,'finished');notify([`rooms/${code}`]);await wait();host.d.querySelector('#lobby-return').click();await wait();assert.equal(getPath(`rooms/${code}/phase`),'lobby');assert.ok(host.d.querySelector('#settings-dialog').hasAttribute('open'));assert.equal(host.d.querySelector('#time-limit').value,'60');assert.equal(getPath(`rooms/${code}/players/guest/score`),40);assert.ok(getPath(`rooms/${code}/players/host`));
 // The previously supplied old rules deny cleanup. Report the actual cause,
 // return to the lobby, and allow a retry after the rules are updated.
 host.d.querySelector('#settings-close').click();const realSet=host.w.__firebaseMocks.set;host.w.__firebaseMocks.set=async(p,v)=>{if(v===null&&p.endsWith(`/${code}/${game}`)){const e=Error('permission_denied');e.code='PERMISSION_DENIED';throw e;}return realSet(p,v);};
 host.d.querySelector('#start').click();await wait(250);assert.equal(getPath(`rooms/${code}/phase`),'lobby');assert.match(host.d.querySelector('#toast').textContent,/最新のFirebaseルール/);host.w.__firebaseMocks.set=realSet;
 host.d.querySelector('#start').click();await wait(300);assert.equal(getPath(`rooms/${code}/phase`),'playing');assert.notEqual(getPath(`rooms/${code}/gameId`),game);assert.equal(getPath(`rooms/${code}/players/guest/score`),0);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// If the host leaves while another lap is being prepared, the next host
// sees the final screen again and can choose rather than losing the scores.
{
 const {host,guest,code}=await roomWithTwo(),third=makeClient('third');third.d.querySelector('#join-name').value='3人目';third.d.querySelector('#join-code').value=code;third.d.querySelector('#join').click();await wait();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);write(`rooms/${code}/phase`,'finished');notify([`rooms/${code}`]);await wait();
 const original=host.w.__firebaseMocks.set;let release;const blocked=new Promise(resolve=>{release=resolve;});host.w.__firebaseMocks.set=async(p,v)=>{if(p===`secrets/${code}/${game}/8`)await blocked;return original(p,v);};
 host.d.querySelector('#again').click();await wait();assert.equal(getPath(`rooms/${code}/phase`),'starting');disconnect(host);await wait(600);assert.equal(getPath(`rooms/${code}/host`),'guest');assert.equal(getPath(`rooms/${code}/phase`),'finished');release();await wait(150);
 guest.d.querySelector('#again').click();await wait(250);assert.equal(getPath(`rooms/${code}/phase`),'playing');assert.equal(getPath(`rooms/${code}/extraRounds`),1);guest.dom.window.close();third.dom.window.close();data={};subs=[];
}
// If the host disconnects during the pass overlay, the elected host resumes it.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'guest');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(350);
 guest.d.querySelector('#pass-topic').click();await wait();assert.equal(getPath(`claims/${code}/${game}/0/ended/reason`),'pass');disconnect(host);write(`claims/${code}/${game}/0/ended/at`,Date.now()-2200);notify([`claims/${code}/${game}/0`]);await wait(700);
 assert.equal(getPath(`rooms/${code}/host`),'guest');assert.equal(getPath(`rooms/${code}/turn`),8);assert.equal(getPath(`rooms/${code}/drawer`),'guest');guest.dom.window.close();data={};subs=[];
}
// An unfinished correct answer is discarded when the GM aborts the entire match.
{
 const {host,guest,code}=await roomWithTwo();const third=makeClient('third');third.d.querySelector('#join-name').value='三人目';third.d.querySelector('#join-code').value=code;third.d.querySelector('#join').click();await wait();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();await sendChat(guest,getPath(`secrets/${code}/${game}/0`));assert.equal(host.d.querySelector('#pass-topic').disabled,true);
 host.d.querySelector('#gm-open').click();host.d.querySelector('#force-end').click();await wait();assert.equal(getPath(`rooms/${code}/phase`),'lobby');assert.equal(getPath(`rooms/${code}/players/guest/score`),0);
 host.dom.window.close();guest.dom.window.close();third.dom.window.close();data={};subs=[];
}
// The host can end a no-limit turn with the whistle, without a correct answer.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='0';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait();host.d.querySelector('#whistle').click();await wait();
 assert.equal(getPath(`claims/${code}/${game}/0`).ended.reason,'whistle');assert.match(guest.d.querySelector('#result').textContent,/終了/);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// A returning participant keeps their score; a newcomer can play and will draw.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='0';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/order`,['host','guest']);write(`rooms/${code}/schedule`,['host','guest']);write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();
 await sendChat(guest,getPath(`secrets/${code}/${game}/0`));await wait(2200);
 disconnect(guest);const returning=makeClient('guest');returning.d.querySelector('#join-name').value='別の入力名';returning.d.querySelector('#join-code').value=code;returning.d.querySelector('#join').click();await wait(180);
 assert.equal(getPath(`rooms/${code}/players/guest/name`),'ゲスト');assert.ok(getPath(`rooms/${code}/online/guest`));assert.match(returning.d.querySelector('#game-players').textContent,/ゲスト.*1 pt/);
 const newcomer=makeClient('late');newcomer.d.querySelector('#join-name').value='途中参加';newcomer.d.querySelector('#join-code').value=code;newcomer.d.querySelector('#join').click();await wait();assert.ok(getPath(`rooms/${code}/players/late`));assert.equal(newcomer.d.querySelector('#game').classList.contains('hidden'),false);
 write(`claims/${code}/${game}/0/ended/at`,Date.now()-13000);notify([`claims/${code}/${game}/0`]);await wait(300);host.d.querySelector('#next').click();await wait();assert.deepEqual(getPath(`rooms/${code}/schedule`),['host','guest','late']);assert.equal(getPath(`rooms/${code}/maxCorrect`),2);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait();await sendChat(newcomer,getPath(`secrets/${code}/${game}/1`));assert.equal(getPath(`claims/${code}/${game}/1/slots/s0/uid`),'late');
 host.dom.window.close();returning.dom.window.close();newcomer.dom.window.close();data={};subs=[];
}
// A participant returning to their own still-existing abandoned room is not swept.
{
 const {host,guest,code}=await roomWithTwo();const history=host.w.localStorage.getItem('oekaki-recent-rooms');disconnect(host);disconnect(guest);write(`rooms/${code}/lastOnline`,Date.now()-301000);
 const returning=makeClient('host',history);returning.d.querySelector('#join-name').value='ホスト';returning.d.querySelector('#join-code').value=code;returning.d.querySelector('#join').click();await wait(200);
 assert.ok(getPath(`rooms/${code}/online/host`));assert.notEqual(getPath(`rooms/${code}/phase`),'closing');returning.dom.window.close();data={};subs=[];
}
// If everyone vanishes, revisit on that browser after five minutes sweeps it.
{
 const {host,guest,code}=await roomWithTwo();const history=host.w.localStorage.getItem('oekaki-recent-rooms'),game=getPath(`rooms/${code}/gameId`);write(`chats/${code}/${game}/dummy`,{text:'x'});disconnect(host);disconnect(guest);write(`rooms/${code}/lastOnline`,Date.now()-301000);
 const returning=makeClient('returning',history);returning.d.querySelector('#create-name').value='新しい部屋';returning.d.querySelector('#create').click();await wait(200);assert.equal(getPath(`rooms/${code}`),undefined);assert.equal(getPath(`chats/${code}/${game}`),undefined);returning.dom.window.close();
}
} finally { for(const s of subs)s.active=false;for(const w of windows)w.close(); }
});

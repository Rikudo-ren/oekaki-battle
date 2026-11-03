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
 const whistles=[];w.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
 w.AudioContext=class {constructor(){this.state='running';this.currentTime=0;this.destination={};}decodeAudioData(){return Promise.resolve({});}createBufferSource(){return {connect(){},disconnect(){},start(){},stop(){}};}createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}createOscillator(){return {frequency:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){},start(){whistles.push(true);},stop(){}};}};
 if(history)w.localStorage.setItem('oekaki-recent-rooms',history);
 connections[uid]={offline:[]};
 w.__firebaseMocks={initializeApp:()=>({}),getAuth:()=>({}),getDatabase:()=>({}),signInAnonymously:async()=>({user:{uid}}),ref:(_,p)=>p,query:p=>p,limitToLast:()=>{},serverTimestamp:()=>Date.now(),get:async p=>{if(p.startsWith('secrets/')){const [,c,g,t]=p.split('/'),current=getPath(`rooms/${c}`),end=getPath(`claims/${c}/${g}/${t}/ended/at`);if(!(current?.drawer===uid&&String(current.turn)===t)&&!(Number.isFinite(end)&&Date.now()>=end+2000)){const e=Error('permission_denied');e.code='PERMISSION_DENIED';throw e;}}return {val:()=>clone(getPath(p))};},push:p=>`${p}/${String(++seq).padStart(6,'0')}`,
 set:async(p,v)=>{if(p.startsWith('chats/')&&v){const [,c,g]=p.split('/'),current=getPath(`rooms/${c}`),t=current?.turn,end=getPath(`claims/${c}/${g}/${t}/ended/at`),secret=getPath(`secrets/${c}/${g}/${t}`);if((current.phase==='playing'&&v.text===secret&&!(Number.isFinite(end)&&Date.now()>=end+2000))||(v.kind==='correct'&&(!getPath(`verified/${c}/${g}/${v.turn}/${uid}`)||v.text!=='●●●'))){const error=Error('permission_denied');error.code='PERMISSION_DENIED';throw error;}}if(p.startsWith('verified/')&&v!==null&&p.split('/').length===5){const [,c,g,t]=p.split('/');if(v!==getPath(`secrets/${c}/${g}/${t}`)){const error=Error('permission_denied');error.code='PERMISSION_DENIED';throw error;}}write(p,v);notify([p]);},update:async(p,v)=>apply(p,v),onValue:(p,cb)=>{const sub={path:p,cb,active:true,uid};subs.push(sub);queueMicrotask(()=>sub.active&&cb({val:()=>p==='.info/connected'?true:p==='.info/serverTimeOffset'?0:clone(getPath(p))}));return ()=>{sub.active=false};},
 runTransaction:async(p,cb)=>{const val=cb(clone(getPath(p)));if(val===undefined)return {committed:false,snapshot:{val:()=>clone(getPath(p))}};write(p,val);notify([p]);return {committed:true,snapshot:{val:()=>clone(val)}};},onDisconnect:p=>({update:async v=>{connections[uid].offline.push({p,v});},cancel:async()=>{connections[uid].offline=[];}})};
 w.eval(built.outputFiles[0].text);d.dispatchEvent(new w.Event('pointerdown'));return {dom,d,w,uid,whistles};}
function disconnect(client){for(const s of subs)if(s.uid===client.uid)s.active=false;for(const {p,v} of connections[client.uid].offline)apply(p,v);connections[client.uid].offline=[];client.dom.window.close();}
async function sendChat(client,text){client.d.querySelector('#chat-input').value=text;client.d.querySelector('#chat-form').dispatchEvent(new client.w.Event('submit',{bubbles:true,cancelable:true}));await wait();}
async function roomWithTwo(){const host=makeClient('host'),guest=makeClient('guest');host.d.querySelector('#create-name').value='ホスト';host.d.querySelector('#create').click();await wait();const code=Object.keys(data.rooms)[0];guest.d.querySelector('#join-name').value='ゲスト';guest.d.querySelector('#join-code').value=code;guest.d.querySelector('#join').click();await wait();assert.ok(getPath(`rooms/${code}/online/host`));assert.ok(getPath(`rooms/${code}/online/guest`));return {host,guest,code};}
// Tabs, settings and chat are accessible without scrolling the main game view.
{
 const c=makeClient('host');c.d.querySelector('#tab-join').click();assert.equal(c.d.body.classList.contains('join-mode'),true);assert.equal(c.d.querySelector('#tab-join').getAttribute('aria-selected'),'true');c.d.querySelector('#tab-create').click();assert.equal(c.d.body.classList.contains('join-mode'),false);
 c.d.querySelector('#create-name').value='ホスト';c.d.querySelector('#create').click();await wait();assert.ok(c.d.body.classList.contains('screen-lobby'));
 c.d.querySelector('#settings-open').click();assert.equal(c.d.querySelector('#settings-dialog').hasAttribute('open'),true);c.d.querySelector('#settings-close').click();assert.equal(c.d.querySelector('#settings-dialog').hasAttribute('open'),false);
 c.d.querySelector('#chat-expand').click();assert.ok(c.d.body.classList.contains('chat-open'));assert.equal(c.d.querySelector('#chat-expand').getAttribute('aria-expanded'),'true');c.d.querySelector('#chat-backdrop').click();assert.equal(c.d.body.classList.contains('chat-open'),false);
 c.d.querySelector('#music-toggle').click();assert.equal(c.d.querySelector('#music-toggle').getAttribute('aria-pressed'),'false');
 c.d.querySelector('#leave').click();await wait();assert.equal(c.d.body.classList.contains('screen-lobby'),false);c.dom.window.close();data={};subs=[];
}
// Voluntary host exit hands off; the last person removes all game resources.
{
 const {host,guest,code}=await roomWithTwo();const room=getPath(`rooms/${code}`),game=room.gameId;
 for(const root of ['secrets','claims','drawings','chats','hints','verified','chatGuard','passCandidates'])write(`${root}/${code}/${game}/dummy`,{x:1});
 host.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}/host`),'guest');assert.ok(getPath(`rooms/${code}/players/guest`));assert.equal(getPath(`rooms/${code}/players/host`),undefined);
 guest.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}`),undefined);for(const root of ['secrets','claims','drawings','chats','hints','verified','chatGuard','passCandidates'])assert.equal(getPath(`${root}/${code}/${game}`),undefined,root);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// Unexpected host disconnect triggers election and leaves guest in the room.
{
 const {host,guest,code}=await roomWithTwo();disconnect(host);await wait(400);assert.equal(getPath(`rooms/${code}/host`),'guest');assert.equal(getPath(`rooms/${code}/online/host`),undefined);guest.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}`),undefined);guest.dom.window.close();data={};subs=[];
}
// The host skips an absent drawer after the grace period, including no-limit games.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);assert.equal(getPath(`rooms/${code}/phase`),'playing');write(`rooms/${code}/drawer`,'guest');notify([`rooms/${code}/drawer`]);disconnect(guest);write(`rooms/${code}/lastDisconnects/guest`,Date.now()-31000);notify([`rooms/${code}/lastDisconnects/guest`]);await wait(450);assert.equal(getPath(`claims/${code}/${game}/0`).ended.reason,'skip');assert.match(host.d.querySelector('#result').textContent,/終了/);write(`claims/${code}/${game}/0/ended/at`,Date.now()-2100);notify([`claims/${code}/${game}/0/ended/at`]);await wait(350);assert.match(host.d.querySelector('#result').textContent,/答えは/);host.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}`),undefined);host.dom.window.close();data={};subs=[];
}
// Two answer slots: the first answer does not reveal or end the turn.
{
 const {host,guest,code}=await roomWithTwo();const third=makeClient('third');third.d.querySelector('#join-name').value='さんにんめ';third.d.querySelector('#join-code').value=code;third.d.querySelector('#join').click();await wait();
 host.d.querySelector('#time-limit').value='60';host.d.querySelector('#max-correct').value='2';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-3001);notify([`rooms/${code}`]);await wait();
 const word=getPath(`secrets/${code}/${game}/0`);
 assert.match(host.d.querySelector('.is-drawer .game-player-role').textContent,/ホストがおえかき中/);
 await sendChat(host,word);assert.equal(getPath(`chats/${code}/${game}`),undefined);assert.match(host.d.querySelector('#toast').textContent,/お題をチャットに送れません/);
 await sendChat(host,'がんばって！');assert.equal(Object.values(getPath(`chats/${code}/${game}`)).at(-1).text,'がんばって！');
 const realSet=guest.w.__firebaseMocks.set;guest.w.__firebaseMocks.set=async(p,v)=>{if(p.startsWith('chatGuard/')){const e=Error('permission_denied');e.code='PERMISSION_DENIED';throw e;}return realSet(p,v);};
 await sendChat(guest,word);assert.match(guest.d.querySelector('#toast').textContent,/Firebaseルール/);assert.equal(getPath(`claims/${code}/${game}/0`),undefined);assert.ok(!Object.values(getPath(`chats/${code}/${game}`)).some(m=>m.text===word));guest.w.__firebaseMocks.set=realSet;
 await sendChat(guest,'まちがい');assert.equal(getPath(`claims/${code}/${game}/0`),undefined);assert.equal(Object.values(getPath(`chats/${code}/${game}`)).at(-1).text,'まちがい');
 await sendChat(guest,word);const first=getPath(`claims/${code}/${game}/0`);assert.equal(Object.keys(first.slots).length,1);assert.equal(first.ended,undefined);assert.equal(JSON.stringify(first).includes(word),false);assert.match(host.d.querySelector('#answer-slots').textContent,/1 \/ 2/);assert.equal(host.d.querySelector('#result').classList.contains('hidden'),true);assert.equal(host.d.querySelector('#round-end').classList.contains('hidden'),true);assert.equal(host.whistles.length,0);
 const masked=Object.values(getPath(`chats/${code}/${game}`)).at(-1);assert.equal(masked.text,'●●●');assert.equal(masked.kind,'correct');assert.equal(masked.turn,0);assert.match(host.d.querySelector('#chat-messages').textContent,/正解！ ●/);assert.ok(!host.d.querySelector('#chat-messages').textContent.includes(word));
 assert.equal(host.d.querySelector('#pass-topic').disabled,true);
 await sendChat(guest,'こんにちは');assert.equal(Object.values(getPath(`chats/${code}/${game}`)).at(-1).text,'こんにちは');assert.equal(Object.keys(getPath(`claims/${code}/${game}/0/slots`)).length,1);
 guest.d.querySelector('#sound-toggle').click();
 await sendChat(third,word);const final=getPath(`claims/${code}/${game}/0`);assert.equal(final.ended.reason,'full');assert.equal(Object.keys(final.slots).length,2);assert.match(host.d.querySelector('#result').textContent,/終了/);assert.equal(host.d.querySelector('#next').classList.contains('hidden'),true);
 for(const c of [host,guest,third])assert.equal(c.d.querySelector('#round-end').classList.contains('hidden'),false);
 for(const c of [host,guest,third])assert.equal(c.d.querySelector('#chat-input').disabled,true);
 assert.equal(host.whistles.length,2);assert.equal(third.whistles.length,2);assert.equal(guest.whistles.length,0);assert.ok(Object.values(getPath(`chats/${code}/${game}`)).filter(m=>m.kind==='correct').every(m=>m.text==='●●●'));assert.ok(!host.d.querySelector('#chat-messages').textContent.includes(word));
 notify([`claims/${code}/${game}/0`]);await wait();assert.equal(host.whistles.length,2);
 await wait(2200);assert.equal(host.d.querySelector('#round-end').classList.contains('hidden'),true);assert.equal(host.whistles.length,2);assert.equal(host.d.querySelector('#chat-input').disabled,false);assert.match(host.d.querySelector('#result').textContent,/答えは/);assert.match(host.d.querySelector('#chat-messages').textContent,new RegExp(`正解！ ${word}`));assert.match(host.d.querySelector('#result').textContent,/ゲスト \+5点/);assert.match(host.d.querySelector('#result').textContent,/さんにんめ \+5点/);assert.equal(host.d.querySelector('#next').classList.contains('hidden'),false);
 // Reconnecting after the reveal must not replay an old whistle or overlay.
 const returning=makeClient('guest');returning.d.querySelector('#join-name').value='ゲスト';returning.d.querySelector('#join-code').value=code;returning.d.querySelector('#join').click();await wait();assert.equal(returning.whistles.length,0);assert.equal(returning.d.querySelector('#round-end').classList.contains('hidden'),true);assert.match(returning.d.querySelector('#chat-messages').textContent,new RegExp(`正解！ ${word}`));returning.dom.window.close();
 host.d.querySelector('#next').click();await wait();assert.equal(getPath(`rooms/${code}/turn`),1);assert.equal(host.d.querySelector('#countdown').classList.contains('hidden'),false);
 const afterNext=makeClient('guest');afterNext.d.querySelector('#join-name').value='ゲスト';afterNext.d.querySelector('#join-code').value=code;afterNext.d.querySelector('#join').click();await wait();assert.match(afterNext.d.querySelector('#chat-messages').textContent,new RegExp(`正解！ ${word}`));afterNext.dom.window.close();
 write(`rooms/${code}/turnStartedAt`,Date.now()-64000);notify([`rooms/${code}/turnStartedAt`]);await wait(500);assert.equal(getPath(`claims/${code}/${game}/1`).ended.reason,'time');assert.match(host.d.querySelector('#result').textContent,/時間切れ/);
 host.dom.window.close();guest.dom.window.close();third.dom.window.close();data={};subs=[];
}
// Pass is drawer-only, keeps the same schedule turn, and resets the drawing and timer.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#time-limit').value='60';host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(350);
 assert.equal(host.d.querySelector('#pass-topic').disabled,false);assert.equal(guest.d.querySelector('#gm-open').classList.contains('hidden'),true);
 const old=getPath(`secrets/${code}/${game}/0`);host.d.querySelector('#pass-topic').click();await wait();
 assert.equal(getPath(`claims/${code}/${game}/0/ended/reason`),'pass');assert.notEqual(getPath(`passCandidates/${code}/${game}/0`),old);
 for(const c of [host,guest]){assert.equal(c.d.querySelector('#round-end').classList.contains('hidden'),false);assert.match(c.d.querySelector('#round-end').textContent,/パス/);assert.equal(c.d.querySelector('#chat-input').disabled,true);}
 write(`claims/${code}/${game}/0/ended/at`,Date.now()-2200);notify([`claims/${code}/${game}/0`]);await wait(450);
 assert.equal(getPath(`rooms/${code}/turn`),8);assert.equal(getPath(`rooms/${code}/scheduleIndex`),0);assert.equal(getPath(`rooms/${code}/drawer`),'host');assert.notEqual(getPath(`secrets/${code}/${game}/8`),old);assert.equal(getPath(`rooms/${code}/lengths/8`),getPath(`secrets/${code}/${game}/8`).length);assert.match(host.d.querySelector('#turn-label').textContent,/1 \/ 2/);assert.equal(host.d.querySelector('#round-end').classList.contains('hidden'),true);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait(350);host.d.querySelector('#pass-topic').click();await wait();write(`claims/${code}/${game}/8/ended/at`,Date.now()-2200);notify([`claims/${code}/${game}/8`]);await wait(1400);assert.equal(getPath(`rooms/${code}/turn`),9);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait(350);await sendChat(guest,getPath(`secrets/${code}/${game}/9`));await wait(2200);assert.equal(getPath(`claims/${code}/${game}/9/slots/s0/uid`),'guest');host.d.querySelector('#next').click();await wait();assert.equal(getPath(`rooms/${code}/turn`),1);assert.equal(getPath(`rooms/${code}/scheduleIndex`),1);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// GM can return the match to the lobby with confirmed scores, then restart cleanly.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();await sendChat(guest,getPath(`secrets/${code}/${game}/0`));await wait(2200);
 guest.d.querySelector('#gm-open').click();assert.equal(guest.d.querySelector('#gm-dialog').hasAttribute('open'),false);
 host.d.querySelector('#gm-open').click();assert.equal(host.d.querySelector('#gm-dialog').hasAttribute('open'),true);host.d.querySelector('#force-end').click();await wait();
 assert.equal(getPath(`rooms/${code}/phase`),'lobby');assert.equal(getPath(`rooms/${code}/players/guest/score`),1);assert.match(guest.d.querySelector('#players').textContent,/ゲスト.*1 pt/);assert.ok(getPath(`rooms/${code}/players/host`));
 const oldMatch=getPath(`rooms/${code}/matchId`);host.d.querySelector('#start').click();await wait(250);assert.equal(getPath(`rooms/${code}/phase`),'playing');assert.equal(getPath(`rooms/${code}/players/guest/score`),0);assert.equal(getPath(`claims/${code}/${game}`),undefined);assert.notEqual(getPath(`rooms/${code}/matchId`),oldMatch);assert.notEqual(getPath(`rooms/${code}/gameId`),game);
 const newGame=getPath(`rooms/${code}/gameId`);write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait(250);await sendChat(guest,getPath(`secrets/${code}/${newGame}/0`));assert.equal(getPath(`claims/${code}/${newGame}/0/slots/s0/uid`),'guest');
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
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
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait();host.d.querySelector('#whistle').click();await wait();
 assert.equal(getPath(`claims/${code}/${game}/0`).ended.reason,'whistle');assert.match(guest.d.querySelector('#result').textContent,/終了/);
 host.dom.window.close();guest.dom.window.close();data={};subs=[];
}
// A returning participant keeps their score; a newcomer can play and will draw.
{
 const {host,guest,code}=await roomWithTwo();host.d.querySelector('#start').click();await wait();const game=getPath(`rooms/${code}/gameId`);
 write(`rooms/${code}/drawer`,'host');write(`rooms/${code}/order`,['host','guest']);write(`rooms/${code}/schedule`,['host','guest']);write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}`]);await wait();
 await sendChat(guest,getPath(`secrets/${code}/${game}/0`));await wait(2200);
 disconnect(guest);const returning=makeClient('guest');returning.d.querySelector('#join-name').value='別の入力名';returning.d.querySelector('#join-code').value=code;returning.d.querySelector('#join').click();await wait(180);
 assert.equal(getPath(`rooms/${code}/players/guest/name`),'ゲスト');assert.ok(getPath(`rooms/${code}/online/guest`));assert.match(returning.d.querySelector('#game-players').textContent,/ゲスト.*1 pt/);
 const newcomer=makeClient('late');newcomer.d.querySelector('#join-name').value='途中参加';newcomer.d.querySelector('#join-code').value=code;newcomer.d.querySelector('#join').click();await wait();assert.ok(getPath(`rooms/${code}/players/late`));assert.equal(newcomer.d.querySelector('#game').classList.contains('hidden'),false);
 host.d.querySelector('#next').click();await wait();assert.deepEqual(getPath(`rooms/${code}/schedule`),['host','guest','late']);assert.equal(getPath(`rooms/${code}/maxCorrect`),2);
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

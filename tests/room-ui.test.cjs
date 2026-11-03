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
function makeClient(uid,history){const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true});windows.push(dom.window);const w=dom.window,d=w.document;w.scrollTo=()=>{};w.confirm=()=>true;w.HTMLCanvasElement.prototype.getContext=()=>({clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}});w.HTMLCanvasElement.prototype.setPointerCapture=()=>{};w.FIREBASE_CONFIG={apiKey:'x',databaseURL:'https://example.test',projectId:'x',appId:'x'};if(history)w.localStorage.setItem('oekaki-recent-rooms',history);
 connections[uid]={offline:[]};
 w.__firebaseMocks={initializeApp:()=>({}),getAuth:()=>({}),getDatabase:()=>({}),signInAnonymously:async()=>({user:{uid}}),ref:(_,p)=>p,query:p=>p,limitToLast:()=>{},serverTimestamp:()=>Date.now(),get:async p=>({val:()=>clone(getPath(p))}),push:p=>`${p}/${String(++seq).padStart(6,'0')}`,
 set:async(p,v)=>{if(p.startsWith('verified/')&&v!==null&&p.split('/').length===5){const [,c,g,t]=p.split('/');if(v!==getPath(`secrets/${c}/${g}/${t}`)){const error=Error('permission_denied');error.code='PERMISSION_DENIED';throw error;}}write(p,v);notify([p]);},update:async(p,v)=>apply(p,v),onValue:(p,cb)=>{const sub={path:p,cb,active:true,uid};subs.push(sub);queueMicrotask(()=>sub.active&&cb({val:()=>p==='.info/connected'?true:p==='.info/serverTimeOffset'?0:clone(getPath(p))}));return ()=>{sub.active=false};},
 runTransaction:async(p,cb)=>{const val=cb(clone(getPath(p)));if(val===undefined)return {committed:false,snapshot:{val:()=>clone(getPath(p))}};write(p,val);notify([p]);return {committed:true,snapshot:{val:()=>clone(val)}};},onDisconnect:p=>({update:async v=>{connections[uid].offline.push({p,v});},cancel:async()=>{connections[uid].offline=[];}})};
 w.eval(built.outputFiles[0].text);return {dom,d,w,uid};}
function disconnect(client){for(const s of subs)if(s.uid===client.uid)s.active=false;for(const {p,v} of connections[client.uid].offline)apply(p,v);connections[client.uid].offline=[];client.dom.window.close();}
async function roomWithTwo(){const host=makeClient('host'),guest=makeClient('guest');host.d.querySelector('#create-name').value='ホスト';host.d.querySelector('#create').click();await wait();const code=Object.keys(data.rooms)[0];guest.d.querySelector('#join-name').value='ゲスト';guest.d.querySelector('#join-code').value=code;guest.d.querySelector('#join').click();await wait();assert.ok(getPath(`rooms/${code}/online/host`));assert.ok(getPath(`rooms/${code}/online/guest`));return {host,guest,code};}
// Voluntary host exit hands off; the last person removes all game resources.
{
 const {host,guest,code}=await roomWithTwo();const room=getPath(`rooms/${code}`),game=room.gameId;
 for(const root of ['secrets','claims','drawings','chats','hints','verified'])write(`${root}/${code}/${game}/dummy`,{x:1});
 host.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}/host`),'guest');assert.ok(getPath(`rooms/${code}/players/guest`));assert.equal(getPath(`rooms/${code}/players/host`),undefined);
 guest.d.querySelector('#leave').click();await wait();assert.equal(getPath(`rooms/${code}`),undefined);for(const root of ['secrets','claims','drawings','chats','hints','verified'])assert.equal(getPath(`${root}/${code}/${game}`),undefined,root);
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
 guest.d.querySelector('#answer').value='まちがい';guest.d.querySelector('#answer-form').dispatchEvent(new guest.w.Event('submit',{bubbles:true,cancelable:true}));await wait();assert.equal(getPath(`claims/${code}/${game}/0`),undefined);
 guest.d.querySelector('#answer').value=word;guest.d.querySelector('#answer-form').dispatchEvent(new guest.w.Event('submit',{bubbles:true,cancelable:true}));await wait();const first=getPath(`claims/${code}/${game}/0`);assert.equal(Object.keys(first.slots).length,1);assert.equal(first.ended,undefined);assert.equal(JSON.stringify(first).includes(word),false);assert.match(host.d.querySelector('#answer-slots').textContent,/1 \/ 2/);assert.equal(host.d.querySelector('#result').classList.contains('hidden'),true);
 third.d.querySelector('#answer').value=word;third.d.querySelector('#answer-form').dispatchEvent(new third.w.Event('submit',{bubbles:true,cancelable:true}));await wait();const final=getPath(`claims/${code}/${game}/0`);assert.equal(final.ended.reason,'full');assert.equal(Object.keys(final.slots).length,2);assert.match(host.d.querySelector('#result').textContent,/終了/);assert.equal(host.d.querySelector('#next').classList.contains('hidden'),true);
 await wait(2200);assert.match(host.d.querySelector('#result').textContent,/答えは/);assert.match(host.d.querySelector('#result').textContent,/ゲスト \+5点/);assert.match(host.d.querySelector('#result').textContent,/さんにんめ \+5点/);assert.equal(host.d.querySelector('#next').classList.contains('hidden'),false);
 host.d.querySelector('#next').click();await wait();assert.equal(getPath(`rooms/${code}/turn`),1);assert.equal(host.d.querySelector('#countdown').classList.contains('hidden'),false);
 write(`rooms/${code}/turnStartedAt`,Date.now()-64000);notify([`rooms/${code}/turnStartedAt`]);await wait(500);assert.equal(getPath(`claims/${code}/${game}/1`).ended.reason,'time');assert.match(host.d.querySelector('#result').textContent,/時間切れ/);
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
 guest.d.querySelector('#answer').value=getPath(`secrets/${code}/${game}/0`);guest.d.querySelector('#answer-form').dispatchEvent(new guest.w.Event('submit',{bubbles:true,cancelable:true}));await wait(2200);
 disconnect(guest);const returning=makeClient('guest');returning.d.querySelector('#join-name').value='別の入力名';returning.d.querySelector('#join-code').value=code;returning.d.querySelector('#join').click();await wait(180);
 assert.equal(getPath(`rooms/${code}/players/guest/name`),'ゲスト');assert.ok(getPath(`rooms/${code}/online/guest`));assert.match(returning.d.querySelector('#game-players').textContent,/ゲスト.*1 pt/);
 const newcomer=makeClient('late');newcomer.d.querySelector('#join-name').value='途中参加';newcomer.d.querySelector('#join-code').value=code;newcomer.d.querySelector('#join').click();await wait();assert.ok(getPath(`rooms/${code}/players/late`));assert.equal(newcomer.d.querySelector('#game').classList.contains('hidden'),false);
 host.d.querySelector('#next').click();await wait();assert.deepEqual(getPath(`rooms/${code}/schedule`),['host','guest','late']);assert.equal(getPath(`rooms/${code}/maxCorrect`),2);
 write(`rooms/${code}/turnStartedAt`,Date.now()-4000);notify([`rooms/${code}/turnStartedAt`]);await wait();newcomer.d.querySelector('#answer').value=getPath(`secrets/${code}/${game}/1`);newcomer.d.querySelector('#answer-form').dispatchEvent(new newcomer.w.Event('submit',{bubbles:true,cancelable:true}));await wait();assert.equal(getPath(`claims/${code}/${game}/1/slots/s0/uid`),'late');
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

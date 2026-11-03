import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, onValue, push, set, get, runTransaction, query, limitToLast, serverTimestamp, update, onDisconnect } from 'firebase/database';
import { reduceDrawingEvents } from './drawing.mjs';
import { remainingMs, scoreForClaim } from './timing.mjs';
import { topics } from './topics.mjs';
import { createHint, hintCharacters } from './hints.mjs';
import { unlockAudio, playSound, playWhistle, soundEnabled, setSoundEnabled } from './audio.mjs';
import { isOnline, onlinePlayers, isAbandoned, canSkipAbsentDrawer } from './room-management.mjs';
import { turnStart, countdownRemaining, resultReady, correctEntries, nextSlot, extendSchedule } from './rounds.mjs';

const $ = id => document.getElementById(id);
let app, auth, db, user, code, room, claims={}, unsubscribe, unsubscribeClaims, unsubscribeDrawing, unsubscribeChat, activeTurn, wordKey, drawerWord='', color='#393632', drawing=false, points=[], strokes=[], pendingDraws=0, drawQueue=Promise.resolve(), serverOffset=0, timeoutPending='', timeoutWord='', timeoutWordKey='', timerHandle=null, hintKey='', hintValue=null, hintPending='', hintRetryAt=0, soundTurnKey='', soundResultKey='', soundHadRoomState=false;
let presenceSession=null, hostElectionPending=false, hostElectionRetryAt=0, skipPending='', skipRetryAt=0, prunePending=false, pruneRetryAt=0;
let countdownKey='', countdownValue=0, revealKey='', revealRetryAt=0;
const canvas=$('canvas'), ctx=canvas.getContext('2d');
const show=(id, visible)=>$(id).classList.toggle('hidden',!visible);
function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('visible'),3500); }
function friendly(error){console.error(error); return error?.message?.replace(/^Firebase: /,'') || 'エラーが発生しました。もう一度お試しください。';}
async function connect(){
  if(user) return;
  const config=window.FIREBASE_CONFIG;
  if(!config?.apiKey || !config?.databaseURL || !config?.projectId || !config?.appId) throw new Error('Firebaseの設定が必要です。READMEの手順をご確認ください。');
  if(!app){app=initializeApp(config);auth=getAuth(app);db=getDatabase(app);onValue(ref(db,'.info/serverTimeOffset'),snap=>{const offset=snap.val();if(typeof offset==='number')serverOffset=offset;});}
  user=(await signInAnonymously(auth)).user;
}
function randomInt(n){ const values=new Uint32Array(1); crypto.getRandomValues(values); return values[0]%n; }
function randomId(length,alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'){ return Array.from({length},()=>alphabet[randomInt(alphabet.length)]).join(''); }
function shuffle(items){items=[...items];for(let i=items.length-1;i>0;i--){const j=randomInt(i+1);[items[i],items[j]]=[items[j],items[i]];}return items;}
const transaction=(path, updater)=>runTransaction(ref(db,path),updater,{applyLocally:false});
async function call(name,data){
  if(name==='createRoom'){
    for(let i=0;i<10;i++){
      const newCode=randomId(6), gameId=randomId(20);
      const result=await transaction(`rooms/${newCode}`,current=>current?undefined:{host:user.uid,phase:'lobby',gameId,players:{[user.uid]:{name:data.name,score:0}},createdAt:serverTimestamp(),lastOnline:serverTimestamp()});
      if(result.committed){rememberRoom(newCode);return {code:newCode};}
    }
    throw Error('部屋を作れませんでした。もう一度お試しください。');
  }
  if(name==='joinRoom'){
    const current=(await get(ref(db,`rooms/${data.code}`))).val();
    if(!current||current.phase==='closing')throw Error('部屋が見つかりません。');
    if(current.players?.[user.uid]){rememberRoom(data.code);return {code:data.code};}
    if(!['lobby','starting','playing'].includes(current.phase))throw Error('このゲームは終了しています。');
    if(Object.keys(current.players||{}).length>=8)throw Error('部屋は満員です。');
    try { await set(ref(db,`rooms/${data.code}/players/${user.uid}`),{name:data.name,score:0}); }
    catch(e){if(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied'))throw Error('参加できませんでした。部屋が終了した可能性があります。');throw e;}
    rememberRoom(data.code);return {code:data.code};
  }
  if(name==='leaveRoom'){
    await stopPresence();
    const result=await transaction(`rooms/${data.code}`,current=>{
      if(!current)return;
      if(current.phase==='closing')return current.cleanupBy===user.uid?current:undefined;
      const online=onlinePlayers(current);
      if(!online.length&&current.players?.[user.uid]){current.phase='closing';current.cleanupBy=user.uid;current.closingAt=serverTimestamp();return current;}
      if(current.host!==user.uid||isOnline(current,user.uid))return;
      if(current.phase==='lobby')delete current.players[user.uid];
      if(online.length)current.host=online[0];
      if(current.phase==='starting')current.phase='lobby';
      return current;
    });
    const current=result.snapshot?.val() || (await get(ref(db,`rooms/${data.code}`))).val();
    if(current?.phase==='closing'&&current.cleanupBy===user.uid){await cleanupRoom(data.code,current.gameId);forgetRoom(data.code);return;}
    if(current?.phase==='lobby'&&current.players?.[user.uid]&&!isOnline(current,user.uid))await set(ref(db,`rooms/${data.code}/players/${user.uid}`),null);
    return;
  }
  if(name==='startGame'){
    const rounds=data.rounds,timeLimit=data.timeLimit,hintSeconds=timeLimit ? data.hintSeconds : 0,requestedMax=data.maxCorrect,minPoints=data.minPoints,maxPoints=data.maxPoints,flatPoints=data.flatPoints; if(!Number.isInteger(rounds)||rounds<1||rounds>5)throw Error('周回数は1〜5にしてください。');if(!Number.isInteger(timeLimit)||(timeLimit!==0&&(timeLimit<10||timeLimit>600)))throw Error('制限時間は10〜600秒で設定してください。');if(!Number.isInteger(requestedMax)||requestedMax<0||requestedMax>7)throw Error('正解できる人数を選んでください。');if(![minPoints,maxPoints,flatPoints].every(n=>Number.isInteger(n)&&n>=1&&n<=100)||minPoints>maxPoints)throw Error('配点は1〜100点で、最低点が最高点以下になるように設定してください。');if(![0,5,10,15,20].includes(hintSeconds)||hintSeconds>=timeLimit&&hintSeconds!==0)throw Error('文字ヒントのタイミングを選んでください。');
    let reason='開始できませんでした。'; let order, gameId;
    const locked=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='lobby'||!isOnline(current,user.uid))return;
      order=shuffle(onlinePlayers(current));
      if(order.length<2){reason='2人以上で始めてください。';return;}if(order.length>8){reason='参加人数が8人を超えています。8人以下にしてから始めてください。';return;}
      gameId=current.gameId;current.phase='starting';return current;
    });
    if(!locked.committed)throw Error(reason);
    const answers=shuffle(topics).slice(0,8*rounds);
    const schedule=Array.from({length:rounds},()=>order).flat();
    try{
      await Promise.all(answers.flatMap((answer,i)=>{const writes=[set(ref(db,`secrets/${data.code}/${gameId}/${i}`),answer)];if(hintSeconds)writes.push(set(ref(db,`hints/${data.code}/${gameId}/${i}`),createHint(answer,shuffle)));return writes;}));
      const started=await transaction(`rooms/${data.code}`,current=>{
        if(!current||current.host!==user.uid||current.phase!=='starting'||current.gameId!==gameId)return;
        return {...current,phase:'playing',rounds,timeLimit,hintSeconds,maxCorrect:requestedMax===0?order.length-1:Math.min(requestedMax,order.length-1),minPoints,maxPoints,flatPoints,correctSetting:requestedMax,turnStartedAt:serverTimestamp(),order,schedule,turn:0,drawer:order[0],lengths:answers.map(answer=>Array.from(answer).length)};
      });
      if(!started.committed)throw Error('ゲームを開始できませんでした。');
    }catch(e){await transaction(`rooms/${data.code}`,current=>{if(current?.phase==='starting'&&current.host===user.uid){current.phase='lobby';return current;}});throw e;}
    return;
  }
  if(name==='getWord'){
    const turn=room.turn, gameId=room.gameId;
    const word=(await get(ref(db,`secrets/${data.code}/${gameId}/${turn}`))).val();
    if(!word)throw Error('お題が見つかりません。');return {word,turn};
  }
  if(name==='submitAnswer'){
    const answer=String(data.answer||'').trim().normalize('NFKC');
    if(!/^[\u3041-\u3096ー]+$/.test(answer))throw Error('答えはひらがなで入力してください。');
    const turn=room.turn,gameId=room.gameId,startedAt=turnStart(room),duration=room.timeLimit,limit=room.maxCorrect;
    if(countdownRemaining(room,Date.now()+serverOffset)>0)throw Error('スタートを待ってね。');
    if(duration>0&&remainingMs(startedAt,duration,Date.now()+serverOffset)===0)throw Error('時間切れです。結果を待ってね。');
    const verifiedPath=`verified/${data.code}/${gameId}/${turn}/${user.uid}`;
    try {
      const prior=(await get(ref(db,verifiedPath))).val();
      if(!prior)await set(ref(db,verifiedPath),answer);
    }catch(e){if(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied'))return {correct:false};throw e;}
    const result=await transaction(`claims/${data.code}/${gameId}/${turn}`,current=>{
      current=current||{};if(current.ended||correctEntries(current).some(entry=>entry.uid===user.uid))return;
      const slot=nextSlot(current,limit);if(!slot)return;
      current.slots={...(current.slots||{}),[slot]:{uid:user.uid,at:serverTimestamp(),startedAt,duration}};
      if(correctEntries(current).length===limit)current.ended={reason:'full',at:serverTimestamp()};
      return current;
    });
    const state=result.snapshot.val();
    return {correct:result.committed||correctEntries(state).some(entry=>entry.uid===user.uid),ended:!!state?.ended};
  }
  if(name==='endTurn'){
    const {turn,gameId,reason}=data;
    return transaction(`claims/${data.code}/${gameId}/${turn}`,current=>{
      current=current||{};if(current.ended)return;
      current.ended={reason,at:serverTimestamp()};return current;
    });
  }
  if(name==='nextTurn'){
    const turn=room.turn, claim=claims[turn]; if(!claim?.ended||!resultReady(claim,Date.now()+serverOffset)||timeoutWordKey!==`${code}:${room.gameId}:${turn}`||!timeoutWord)throw Error('結果発表を待ってね。');
    const result=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='playing'||current.turn!==turn)return;
      const schedule=extendSchedule(current.schedule,current.players,current.rounds);
      current.schedule=schedule;
      const next=turn+1;if(next>=schedule.length)current.phase='finished';
      else {
        current.turn=next;current.drawer=schedule[next];current.turnStartedAt=serverTimestamp();
        current.maxCorrect=Math.min(current.correctSetting||7,Object.keys(current.players||{}).length-1,7);
      }return current;
    });
    if(!result.committed)throw Error('すでに進行しています。');return;
  }
}
const ROOM_HISTORY_KEY='oekaki-recent-rooms';
function knownRooms(){try{const codes=JSON.parse(localStorage.getItem(ROOM_HISTORY_KEY)||'[]');return Array.isArray(codes)?codes.filter(c=>typeof c==='string'&&/^[A-Z0-9]{6}$/.test(c)).slice(-30):[];}catch{return [];}}
function saveKnownRooms(codes){try{localStorage.setItem(ROOM_HISTORY_KEY,JSON.stringify(codes.slice(-30)));}catch{}}
function rememberRoom(roomCode){saveKnownRooms([...knownRooms().filter(c=>c!==roomCode),roomCode]);}
function forgetRoom(roomCode){saveKnownRooms(knownRooms().filter(c=>c!==roomCode));}
async function cleanupRoom(roomCode,gameId){
  // The room is locked in closing state first; nobody can join during cleanup.
  await Promise.all(['secrets','claims','drawings','chats','hints','verified'].map(root=>set(ref(db,`${root}/${roomCode}/${gameId}`),null)));
  await set(ref(db,`rooms/${roomCode}`),null);
}
async function cleanupAbandoned(roomCode){
  const snapshot=(await get(ref(db,`rooms/${roomCode}`))).val();
  if(!snapshot){forgetRoom(roomCode);return;}
  if(!isAbandoned(snapshot,Date.now()+serverOffset))return;
  const result=await transaction(`rooms/${roomCode}`,current=>{
    const now=Date.now()+serverOffset;
    if(!isAbandoned(current,now))return;
    if(current.phase==='closing'&&current.cleanupBy!==user.uid&&(!Number.isFinite(current.closingAt)||now<current.closingAt+30000))return;
    current.phase='closing';current.cleanupBy=user.uid;current.closingAt=serverTimestamp();return current;
  });
  if(result.committed){await cleanupRoom(roomCode,result.snapshot.val().gameId);forgetRoom(roomCode);}
}
async function sweepKnownRooms(){
 for(const roomCode of knownRooms()){
  if(code===roomCode)continue;
  try{await cleanupAbandoned(roomCode);}catch(e){console.error('空き部屋の片付けを再試行します',e);}
 }
}
function startPresence(roomCode){
 const uid=user.uid,connection=randomId(20),path=`rooms/${roomCode}`;
 const session={roomCode,uid,connection,active:true,ready:Promise.resolve(),disconnect:null,online:false};presenceSession=session;
 session.unsubscribe=onValue(ref(db,'.info/connected'),snap=>{
  if(!snap.val()){session.online=false;return;}
  session.ready=session.ready.then(async()=>{
   if(!session.active)return;
   const disconnect=onDisconnect(ref(db,path));
   await disconnect.update({[`online/${uid}/${connection}`]:null,[`lastDisconnects/${uid}`]:serverTimestamp(),lastOnline:serverTimestamp()});
   if(!session.active){await disconnect.cancel();return;}
   await update(ref(db,path),{[`online/${uid}/${connection}`]:true,lastOnline:serverTimestamp()});
   session.disconnect=disconnect;session.online=true;
  }).catch(e=>{if(session.active)toast('接続状態を登録できません。Firebaseのルールを確認してください。');console.error(e);});
 });
}
async function stopPresence(){
 const session=presenceSession;if(!session)return;
 session.active=false;session.unsubscribe();await session.ready;
 if(session.online){
  const {roomCode,uid,connection}=session;
  await update(ref(db,`rooms/${roomCode}`),{[`online/${uid}/${connection}`]:null,[`lastDisconnects/${uid}`]:serverTimestamp(),lastOnline:serverTimestamp()});
  if(session.disconnect)await session.disconnect.cancel();
 }
 if(presenceSession===session)presenceSession=null;
}
function maybeTransferHost(){
 if(!room||!user||room.phase==='closing'||room.host===user.uid||!isOnline(room,user.uid)||isOnline(room,room.host)||!Number.isFinite(room.lastDisconnects?.[room.host])||hostElectionPending||Date.now()<hostElectionRetryAt)return;
 const oldHost=room.host,roomCode=code;
 hostElectionPending=true;
 transaction(`rooms/${roomCode}/host`,current=>current===oldHost?user.uid:undefined).then(async result=>{
  if(!result.committed)return;
  await transaction(`rooms/${roomCode}`,current=>{
   if(current?.host===user.uid&&current.phase==='starting'){current.phase='lobby';return current;}
  });
 }).catch(e=>console.error('ホスト交代を再試行します',e)).finally(()=>{hostElectionPending=false;hostElectionRetryAt=Date.now()+1000;});
}
async function action(button, task){button.disabled=true; try{await task();}catch(e){toast(friendly(e));}finally{button.disabled=false;}}
function enterRoom(roomCode){
  code=roomCode; startPresence(roomCode);show('home',false);show('room',true);$('room-code').textContent=code;
  if(unsubscribe) unsubscribe();
  unsubscribe=onValue(ref(db,`rooms/${code}`), snap=>{room=snap.val();if(!room){toast('部屋が終了しました。');goHome();return;}if(room.phase==='closing'){toast('部屋を終了しています。');goHome();return;}maybeTransferHost();if(!unsubscribeClaims){unsubscribeClaims=onValue(ref(db,`claims/${code}/${room.gameId}`),snap=>{claims=snap.val()||{};if(room)render();},e=>toast(friendly(e)));}if(!unsubscribeChat){unsubscribeChat=onValue(query(ref(db,`chats/${code}/${room.gameId}`),limitToLast(100)),snap=>renderChat(snap.val()),e=>toast(friendly(e)));}render();}, e=>toast(friendly(e)));
  if(timerHandle)clearInterval(timerHandle);timerHandle=setInterval(()=>{updateTimer();maybeTransferHost();maybeSkipAbsentDrawer();maybePruneLobby();},250);
  window.scrollTo(0,0);
}
function goHome(){if(presenceSession)void stopPresence().catch(e=>console.error(e));if(unsubscribe)unsubscribe();if(unsubscribeDrawing)unsubscribeDrawing();if(unsubscribeClaims)unsubscribeClaims();if(unsubscribeChat)unsubscribeChat();unsubscribe=null;unsubscribeClaims=null;unsubscribeChat=null;unsubscribeDrawing=null;if(timerHandle)clearInterval(timerHandle);timerHandle=null;timeoutPending='';timeoutWord='';timeoutWordKey='';countdownKey='';countdownValue=0;revealKey='';revealRetryAt=0;show('countdown',false);hintKey='';hintValue=null;hintPending='';hintRetryAt=0;soundTurnKey='';soundResultKey='';soundHadRoomState=false;claims={};strokes=[];drawing=false;activeTurn=undefined;wordKey=undefined;drawerWord='';room=null;code=null;delete $('chat-messages').dataset.loaded;renderChat(null);show('room',false);show('home',true);}
function refreshSoundButton(){const on=soundEnabled(),button=$('sound-toggle');button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',on?'効果音をオフにする':'効果音をオンにする');button.querySelector('span').textContent=on?'効果音 ON':'効果音 OFF';}
$('sound-toggle').onclick=()=>{setSoundEnabled(!soundEnabled());refreshSoundButton();if(soundEnabled())playSound('turn');};
document.addEventListener('pointerdown',unlockAudio,{passive:true});document.addEventListener('keydown',unlockAudio);
refreshSoundButton();
function selectedTimeLimit(){return $('time-limit').value==='custom'?($('custom-time').value.trim()?Number($('custom-time').value):NaN):Number($('time-limit').value);}
function updateHintSetting(){
 const host=room?.host===user?.uid,limit=selectedTimeLimit(),timed=limit>0,custom=$('time-limit').value==='custom';
 $('hint-seconds').disabled=!host||!timed;$('max-correct').disabled=!host;$('custom-time').disabled=!host;
 show('custom-time-wrap',custom);show('time-points',timed);show('flat-points-wrap',!timed);
 for(const id of ['min-points','max-points','flat-points'])$(id).disabled=!host;
 for(const option of $('hint-seconds').options)option.disabled=Number(option.value)>0&&Number(option.value)>=limit;
 if(timed&&$('hint-seconds').selectedOptions[0]?.disabled)$('hint-seconds').value='0';
}
for(const id of ['time-limit','custom-time'])$(id).addEventListener('change',updateHintSetting);
$('create').onclick=()=>action($('create'),async()=>{const name=$('create-name').value.trim();if(!name)throw Error('なまえを入力してね。');await connect();const result=await call('createRoom',{name});enterRoom(result.code);void sweepKnownRooms();});
$('join').onclick=()=>action($('join'),async()=>{const name=$('join-name').value.trim(), roomCode=$('join-code').value.trim().toUpperCase();if(!name)throw Error('なまえを入力してね。');if(!/^[A-Z0-9]{6}$/.test(roomCode))throw Error('合言葉は半角英数字6文字で入力してね。');await connect();await call('joinRoom',{name,code:roomCode});enterRoom(roomCode);void sweepKnownRooms();});
$('leave').onclick=()=>action($('leave'),async()=>{if(room?.phase!=='lobby'&&!confirm('部屋から退出しますか？ ほかの人が残っていれば、同じブラウザから再参加できます。'))return;await call('leaveRoom',{code});goHome();});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);toast('合言葉をコピーしました！');}catch{toast('合言葉を選択してコピーしてね。');}};
$('start').onclick=()=>action($('start'),async()=>{await call('startGame',{code,rounds:Number($('rounds').value),timeLimit:selectedTimeLimit(),hintSeconds:Number($('hint-seconds').value),maxCorrect:Number($('max-correct').value),minPoints:Number($('min-points').value),maxPoints:Number($('max-points').value),flatPoints:Number($('flat-points').value)});});
$('next').onclick=()=>action($('next'),async()=>{await call('nextTurn',{code});});
$('whistle').onclick=()=>action($('whistle'),async()=>{if(!confirm('このターンを終了して答えを発表しますか？'))return;await call('endTurn',{code,turn:room.turn,gameId:room.gameId,reason:'whistle'});});
$('answer-form').onsubmit=e=>{e.preventDefault();action(e.submitter || e.currentTarget.querySelector('button[type=submit], button:not([type])'),async()=>{const answer=$('answer').value.trim();if(!answer)throw Error('答えを入力してね。');const result=await call('submitAnswer',{code,answer});$('answer').value='';if(result.correct){playSound('correct');toast('正解！結果発表まで待ってね。');}else toast(result.ended?'終了！結果を待ってね。':room?.timeLimit&&remainingMs(turnStart(room),room.timeLimit,Date.now()+serverOffset)===0?'時間切れです。結果を待ってね。':'おしい！もう一度考えてみよう。');});};
function renderChat(messages){
 const list=$('chat-messages'), wasAtBottom=list.scrollHeight-list.scrollTop-list.clientHeight<40;
 const entries=Object.entries(messages||{}).sort(([a],[b])=>a<b?-1:a>b?1:0);
 if(!entries.length){const empty=document.createElement('p');empty.className='chat-empty';empty.append('まだメッセージはありません。',document.createElement('br'),'最初のひとことを送ってみよう！');list.replaceChildren(empty);return;}
 list.replaceChildren(...entries.map(([,message])=>{
   const row=document.createElement('div');row.className='chat-message'+(message.uid===user?.uid?' mine':'');
   const meta=document.createElement('span');meta.className='chat-message-meta';
   const date=new Date(message.at);const time=Number.isFinite(date.getTime())?date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'';
   meta.textContent=`${message.name||'なまえなし'}${time?'　'+time:''}`;
   const text=document.createElement('span');text.className='chat-message-text';text.textContent=message.text||'';
   row.append(meta,text);return row;
 }));
 if(wasAtBottom||!list.dataset.loaded)list.scrollTop=list.scrollHeight;list.dataset.loaded='true';
}
$('chat-form').onsubmit=e=>{e.preventDefault();action(e.submitter || e.currentTarget.querySelector('button[type=submit], button:not([type])'),async()=>{
 const input=$('chat-input'),text=input.value.trim();if(!text)return;
 if(!room?.players?.[user.uid])throw Error('部屋に参加していません。');
 const path=`chats/${code}/${room.gameId}`;
 await set(push(ref(db,path)),{uid:user.uid,name:room.players[user.uid].name,text,at:serverTimestamp()});
 input.value='';$('chat-messages').scrollTop=$('chat-messages').scrollHeight;
});};
function renderTiles(length,word,hint){
 const tiles=$('word-tiles'),chars=word?Array.from(word):hintCharacters(length,hint);
 const label=word?`お題 ${word}`:`お題 ${length}文字${hint?'、ヒント '+chars.map(c=>c||'空欄').join('、'):''}`;
 tiles.setAttribute('aria-label',label);
 tiles.replaceChildren(...Array.from({length},(_,i)=>{const char=chars[i]||'',tile=document.createElement('span');tile.className='word-tile'+(!char?' empty':!word?' hint':'');tile.textContent=char||'？';tile.setAttribute('aria-hidden','true');return tile;}));
}
function updateGameSounds(){
 if(room.phase==='playing'){
  const key=`${code}:${room.gameId}:${room.turn}`,claim=claims[room.turn],first=!soundHadRoomState;
  if(soundTurnKey!==key)soundTurnKey=key;
  if(claim?.ended&&soundResultKey!==key){soundResultKey=key;if(!first)playWhistle();}
 }
 soundHadRoomState=true;
}

function render(){
 const host=room.host===user.uid, lobby=room.phase==='lobby'||room.phase==='starting', finished=room.phase==='finished', claim=claims[room.turn], ended=room.phase==='playing'&&!!claim?.ended, revealed=ended&&resultReady(claim,Date.now()+serverOffset), playing=room.phase==='playing'&&!ended, drawer=room.drawer===user.uid, entries=correctEntries(claim), mine=entries.some(entry=>entry.uid===user.uid);
 show('lobby',lobby);show('game',!lobby);show('players-panel',lobby);show('start',host&&room.phase==='lobby');show('start-hint',lobby&&(!host||room.phase==='starting'));$('start-hint').textContent=room.phase==='starting'?'ゲームを準備しています…':'ホストがゲームを開始するまで待ってね';$('rounds').disabled=!host;$('time-limit').disabled=!host;updateHintSetting();updateGameSounds();
 $('room-title').textContent=lobby?'みんなの部屋':finished?'ゲーム終了！':'おえかきバトル！';
 $('room-subtitle').textContent=lobby?'友だちが集まるまで、ちょっと待ってね。':finished?'みんなで遊んでくれてありがとう！':`合言葉 ${code}　・　みんなで楽しく遊ぼう`;
 const players=Object.entries(room.players||{}).map(([id,p])=>[id,{...p,score:Object.values(claims).filter(c=>c?.ended&&resultReady(c,Date.now()+serverOffset)).flatMap(correctEntries).filter(entry=>entry.uid===id).reduce((sum,entry)=>sum+scoreForClaim(entry,room),0)}]); $('player-count').textContent=`${players.length}人`;
 const order=room.order||players.map(([id])=>id);players.sort((a,b)=>{const x=order.indexOf(a[0]),y=order.indexOf(b[0]);return (x<0?Infinity:x)-(y<0?Infinity:y)||a[0].localeCompare(b[0]);});
 $('players').replaceChildren(...players.map(([id,p],i)=>{const div=document.createElement('div');div.className='player';const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('div');name.className='player-name';name.textContent=p.name+(id===user.uid?'（あなた）':'');const meta=document.createElement('small');meta.textContent=!isOnline(room,id)?'離席中':id===room.host?'HOST':(!lobby&&id===room.drawer?'おえかき中':'');name.appendChild(meta);const score=document.createElement('b');score.textContent=lobby?'':`${p.score||0} pt`;div.append(avatar,name,score);return div;}));
 $('game-players').replaceChildren(...players.map(([id,p],i)=>{const chip=document.createElement('div');chip.className='game-player'+(id===room.drawer?' is-drawer':'')+(!isOnline(room,id)?' is-offline':'');const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('span');name.className='game-player-name';name.textContent=p.name+(id===user.uid?'（自分）':'')+(!isOnline(room,id)?'（離席中）':'');const score=document.createElement('span');score.className='game-player-score';score.textContent=`${p.score||0} pt`;chip.append(avatar,name,score);if(id===room.drawer){const role=document.createElement('span');role.className='game-player-role';role.textContent='✎';chip.append(role);}return chip;}));
 if(lobby)return;
 const total=extendSchedule(room.schedule,room.players,room.rounds).length;
 $('turn-label').textContent=finished?'GAME COMPLETE':`${room.turn+1} / ${total} ターン　・　${room.rounds}周設定`;
 $('turn-badge').textContent=finished?'🏆':drawer?'🎨':'💡';
 show('tools',playing&&drawer);show('answer-form',playing&&!drawer&&!mine);show('answer-wait',playing&&!drawer&&mine);show('whistle',playing&&host);show('result',!playing);show('next',revealed&&host&&timeoutWordKey===`${code}:${room.gameId}:${room.turn}`&&!!timeoutWord);
 const slotNodes=Array.from({length:room.maxCorrect||0},(_,i)=>{const dot=document.createElement('span');dot.className='answer-slot'+(i<entries.length?' filled':'');dot.setAttribute('aria-hidden','true');return dot;});$('answer-slots').replaceChildren(document.createTextNode(`正解 ${entries.length} / ${room.maxCorrect||0}人　`),...slotNodes);
 if(finished){const max=Math.max(...players.map(([,p])=>p.score||0));const winners=players.filter(([,p])=>(p.score||0)===max).map(([,p])=>p.name).join('、');$('prompt').textContent='おつかれさま！';$('word-tiles').replaceChildren();$('game-hint').textContent='すべてのターンが終わりました。';$('result').textContent=`🏆 ${winners}　${max}ポイント！`;}
 else if(ended){
   const key=`${code}:${room.gameId}:${room.turn}`;const reason=claim.ended.reason;
   $('prompt').textContent=revealed?'答え発表！':'終了！';
   $('game-hint').textContent=revealed?(host?'次のターンに進もう！':'ホストが次へ進むのを待ってね。'):'答えを発表します…';
   if(!revealed){renderTiles(room.lengths[room.turn],'');$('result').textContent=reason==='time'?'⌛ 時間切れ！':reason==='skip'?'出題者が離席したため終了！':'終了！';}
   else {
    if(timeoutWordKey!==key&&Date.now()>=revealRetryAt){timeoutWordKey=key;timeoutWord='';call('getWord',{code}).then(data=>{if(room?.turn===data.turn&&timeoutWordKey===key&&claims[room.turn]?.ended){timeoutWord=data.word;render();}}).catch(e=>{if(timeoutWordKey===key){timeoutWordKey='';revealRetryAt=Date.now()+1000;}console.error(e);});}
    renderTiles(room.lengths[room.turn],timeoutWord);
    const awards=entries.map(entry=>`${room.players[entry.uid]?.name||'だれか'} +${scoreForClaim(entry,room)}点`).join('、');
    $('result').textContent=timeoutWord?`答えは「${timeoutWord}」！ ${awards||'正解者はいませんでした。'}`:'答えを確認中…';
   }
 }
 else {const drawerName=room.players[room.drawer]?.name||'だれか';$('prompt').textContent=drawer?'お題を描こう！':'何を描いているかな？'; $('game-hint').textContent=drawer?'あなたの番！お題の絵を描こう。':`${drawerName} さんがおえかき中！答えはひらがなで入力してね。`;
 const length=room.lengths[room.turn],key=`${code}:${room.gameId}:${room.turn}`;
 if(!drawer&&room.timeLimit&&room.hintSeconds)$('game-hint').textContent+=hintKey===key?' 💡 文字ヒント公開！':` 残り${room.hintSeconds}秒で文字ヒント！`;
 if(!drawer&&Array.isArray(room.schedule)&&!room.schedule.includes(user.uid))$('game-hint').textContent+=' 途中参加！描く順番は後ろに追加されます。';
 if(drawer){if(wordKey!==key){wordKey=key;drawerWord='';call('getWord',{code}).then(data=>{if(room?.phase==='playing'&&!claims[room.turn]?.ended&&room.turn===data.turn&&room.drawer===user.uid&&wordKey===key){drawerWord=data.word;renderTiles(length,drawerWord);}}).catch(e=>{if(wordKey===key)wordKey=undefined;toast(friendly(e));});}renderTiles(length,drawerWord);}
 else renderTiles(length,'',hintKey===key?hintValue:null);
 }
 if(activeTurn!==room.turn){
   activeTurn=room.turn;if(unsubscribeDrawing)unsubscribeDrawing();strokes=[];ctx.clearRect(0,0,canvas.width,canvas.height);show('canvas-placeholder',true);
   const drawingPath=`drawings/${code}/${room.gameId}/${room.turn}`;
   unsubscribeDrawing=onValue(ref(db,drawingPath),snap=>{
     const events=snap.val()||{};strokes=reduceDrawingEvents(Object.keys(events).sort().map(key=>events[key]));redraw();
   },e=>toast(friendly(e)));
 }
 updateDrawingControls();updateTimer();
}
function updateTimer(){
 if(!room||room.phase!=='playing'){show('timer',false);show('countdown',false);return;}
 const now=Date.now()+serverOffset,turn=room.turn,roomCode=code,gameId=room.gameId,key=`${roomCode}:${gameId}:${turn}`,claim=claims[turn],remaining=countdownRemaining(room,now);
 if(!claim?.ended&&remaining!==null&&remaining>0){
  const value=Math.ceil(remaining/1000);
  if(countdownKey!==key||countdownValue!==value){countdownKey=key;countdownValue=value;$('countdown-number').textContent=value;$('countdown-number').classList.remove('pulse');void $('countdown-number').offsetWidth;$('countdown-number').classList.add('pulse');playSound('tick');}
  show('countdown',true);
 }else{
  if(countdownKey===key&&countdownValue>0&&!claim?.ended){countdownValue=0;playSound('go');}
  show('countdown',false);
 }
 if(claim?.ended&&resultReady(claim,now)&&(revealKey!==key||(!timeoutWord&&Date.now()>=revealRetryAt&&timeoutWordKey!==key))){if(revealKey!==key&&claim.ended.reason==='time')playSound('timeout');revealKey=key;render();return;}
 updateDrawingControls();
 if(!room.timeLimit){show('timer',false);return;}
 const start=turnStart(room),left=remainingMs(start,room.timeLimit,now);
 if(left===null){show('timer',false);return;}
 const frozen=claim?.ended?.at?remainingMs(start,room.timeLimit,claim.ended.at):left;
 const seconds=Math.ceil(Math.min(room.timeLimit*1000,frozen)/1000);$('timer').textContent=`${seconds}秒`;$('timer').classList.toggle('low',seconds<=10);show('timer',true);
 if(!claim?.ended&&remaining===0&&left>0&&room.hintSeconds>0&&left<=room.hintSeconds*1000&&room.drawer!==user.uid)fetchHint();
 if(claim?.ended||remaining>0||left>0||timeoutPending===key)return;
 timeoutPending=key;
 call('endTurn',{code:roomCode,turn,gameId,reason:'time'}).catch(e=>{if(!(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied')))toast(friendly(e));}).finally(()=>{if(timeoutPending===key)setTimeout(()=>{if(timeoutPending===key)timeoutPending='';},1000);});
}
function maybePruneLobby(){
 if(!room||room.phase!=='lobby'||room.host!==user?.uid||prunePending||Date.now()<pruneRetryAt)return;
 const now=Date.now()+serverOffset;
 const stale=Object.keys(room.players||{}).some(uid=>uid!==room.host&&!isOnline(room,uid)&&Number.isFinite(room.lastDisconnects?.[uid])&&now>=room.lastDisconnects[uid]+30000);
 if(!stale)return;
 const roomCode=code;prunePending=true;
 transaction(`rooms/${roomCode}`,current=>{
  if(!current||current.phase!=='lobby'||current.host!==user.uid)return;
  let changed=false;
  for(const uid of Object.keys(current.players||{}))if(uid!==current.host&&!isOnline(current,uid)&&Number.isFinite(current.lastDisconnects?.[uid])&&Date.now()+serverOffset>=current.lastDisconnects[uid]+30000){delete current.players[uid];changed=true;}
  return changed?current:undefined;
 }).catch(e=>console.error('離席者の整理を再試行します',e)).finally(()=>{prunePending=false;pruneRetryAt=Date.now()+1000;});
}
function maybeSkipAbsentDrawer(){
 if(!room||room.host!==user?.uid||claims[room.turn]?.ended||!canSkipAbsentDrawer(room,Date.now()+serverOffset))return;
 const {turn,gameId}=room,roomCode=code,key=`${roomCode}:${gameId}:${turn}`;
 if(skipPending===key||Date.now()<skipRetryAt)return;
 skipPending=key;
 call('endTurn',{code:roomCode,turn,gameId,reason:'skip'}).catch(e=>{skipRetryAt=Date.now()+1000;if(!(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied')))console.error(e);}).finally(()=>{if(skipPending===key)skipPending='';});
}
function fetchHint(){
 const roomCode=code,gameId=room.gameId,turn=room.turn,key=`${roomCode}:${gameId}:${turn}`;
 if(hintKey===key||hintPending===key||Date.now()<hintRetryAt)return;
 hintPending=key;
 get(ref(db,`hints/${roomCode}/${gameId}/${turn}`)).then(snapshot=>{
  if(code!==roomCode||!room||room.gameId!==gameId||room.turn!==turn||room.phase!=='playing'||claims[turn]?.ended||room.drawer===user.uid)return;
  const value=snapshot.val();if(!value){hintRetryAt=Date.now()+3000;return;}
  hintKey=key;hintValue=value;playSound('hint');render();
 }).catch(()=>{hintRetryAt=Date.now()+1000;}).finally(()=>{if(hintPending===key)hintPending='';});
}
// Drawing events are append-only, so undo and clear replay consistently for late joiners.
function paint(stroke){const pts=JSON.parse(stroke.points);if(!Array.isArray(pts)||!pts.length)return;ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);if(pts.length===1)ctx.lineTo(pts[0][0]+.01,pts[0][1]+.01);else for(const p of pts.slice(1))ctx.lineTo(p[0],p[1]);ctx.stroke();}
function redraw(){ctx.clearRect(0,0,canvas.width,canvas.height);for(const stroke of strokes){try{paint(stroke);}catch(e){console.error(e);}}if(drawing&&points.length)paint({color,width:Number($('brush-size').value),points:JSON.stringify(points)});show('canvas-placeholder',!strokes.length&&!drawing);updateDrawingControls();}
function turnExpired(){return countdownRemaining(room,Date.now()+serverOffset)>0||!!(room?.timeLimit && remainingMs(turnStart(room),room.timeLimit,Date.now()+serverOffset)===0);}
function updateDrawingControls(){const disabled=!room||room.phase!=='playing'||!!claims[room.turn]?.ended||turnExpired()||room.drawer!==user.uid||drawing||pendingDraws>0||!strokes.length;$('undo').disabled=disabled;$('clear').disabled=disabled;}
function sendDrawingEvent(event){
 const roomCode=code,gameId=room.gameId,turn=room.turn;pendingDraws++;updateDrawingControls();
 const task=drawQueue.catch(()=>{}).then(async()=>{
   if(code!==roomCode||!room||room.gameId!==gameId||room.turn!==turn||room.phase!=='playing'||claims[turn]?.ended||room.drawer!==user.uid)throw Error('ターンが終了したため、描画を保存できませんでした。');
   await set(push(ref(db,`drawings/${roomCode}/${gameId}/${turn}`)),event);
 });
 drawQueue=task;task.catch(e=>toast(friendly(e))).finally(()=>{pendingDraws--;updateDrawingControls();});return task;
}
function pos(e){const rect=canvas.getBoundingClientRect();return [Math.max(0,Math.min(canvas.width,Math.round((e.clientX-rect.left)*canvas.width/rect.width))),Math.max(0,Math.min(canvas.height,Math.round((e.clientY-rect.top)*canvas.height/rect.height)))];}
canvas.addEventListener('pointerdown',e=>{if(!room||room.phase!=='playing'||claims[room.turn]?.ended||turnExpired()||room.drawer!==user.uid)return;e.preventDefault();drawing=true;points=[pos(e)];canvas.setPointerCapture(e.pointerId);show('canvas-placeholder',false);updateDrawingControls();});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=pos(e),previous=points[points.length-1];if(p[0]===previous[0]&&p[1]===previous[1])return;points.push(p);if(points.length>800)points=points.filter((_,i)=>i%2===0||i===points.length-1);paint({color,width:Number($('brush-size').value),points:JSON.stringify([previous,p])});});
function finishStroke(){if(!drawing)return;drawing=false;if(!room||room.phase!=='playing'||claims[room.turn]?.ended||turnExpired()||room.drawer!==user.uid){redraw();return;}const stroke={color,width:Number($('brush-size').value),points:JSON.stringify(points)};points=[];sendDrawingEvent(stroke).catch(()=>{redraw();});updateDrawingControls();}
canvas.addEventListener('pointerup',finishStroke);canvas.addEventListener('pointercancel',finishStroke);
$('undo').onclick=()=>{if(!room||!strokes.length)return;sendDrawingEvent({action:'undo'}).catch(()=>{});};
$('clear').onclick=()=>{if(!room||!strokes.length||!confirm('絵を全部消しますか？'))return;sendDrawingEvent({action:'clear'}).catch(()=>{});};
$('colors').onclick=e=>{const button=e.target.closest('button');if(!button)return;color=button.dataset.color;document.querySelectorAll('#colors button').forEach(b=>b.classList.toggle('selected',b===button));};
$('colors').firstElementChild.classList.add('selected');

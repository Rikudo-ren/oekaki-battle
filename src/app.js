import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, onValue, push, set, get, runTransaction, query, limitToLast, serverTimestamp } from 'firebase/database';
import { reduceDrawingEvents } from './drawing.mjs';
import { remainingMs, scoreForClaim } from './timing.mjs';
import { topics } from './topics.mjs';
import { createHint, hintCharacters } from './hints.mjs';
import { unlockAudio, playSound, soundEnabled, setSoundEnabled } from './audio.mjs';

const $ = id => document.getElementById(id);
let app, auth, db, user, code, room, claims={}, unsubscribe, unsubscribeClaims, unsubscribeDrawing, unsubscribeChat, activeTurn, wordKey, drawerWord='', color='#393632', drawing=false, points=[], strokes=[], pendingDraws=0, drawQueue=Promise.resolve(), serverOffset=0, timeoutPending='', timeoutWord='', timeoutWordKey='', timerHandle=null, hintKey='', hintValue=null, hintPending='', hintRetryAt=0, soundTurnKey='', soundResultKey='', soundHadRoomState=false;
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
      const result=await transaction(`rooms/${newCode}`,current=>current?undefined:{host:user.uid,phase:'lobby',gameId,players:{[user.uid]:{name:data.name,score:0}},createdAt:Date.now()});
      if(result.committed)return {code:newCode};
    }
    throw Error('部屋を作れませんでした。もう一度お試しください。');
  }
  if(name==='joinRoom'){
    const current=(await get(ref(db,`rooms/${data.code}`))).val();
    if(!current)throw Error('部屋が見つかりません。');
    if(current.players?.[user.uid])return {code:data.code};
    if(current.phase!=='lobby')throw Error('このゲームはすでに始まっています。');
    if(Object.keys(current.players||{}).length>=8)throw Error('部屋は満員です。');
    try { await set(ref(db,`rooms/${data.code}/players/${user.uid}`),{name:data.name,score:0}); }
    catch(e){if(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied'))throw Error('参加できませんでした。ゲームが始まった可能性があります。');throw e;}
    return {code:data.code};
  }
  if(name==='leaveRoom'){
    if(room.host!==user.uid){await set(ref(db,`rooms/${data.code}/players/${user.uid}`),null);return;}
    await transaction(`rooms/${data.code}`,current=>{
      if(!current || current.phase!=='lobby' || current.host!==user.uid)return;
      delete current.players[user.uid]; const remaining=Object.keys(current.players);
      if(!remaining.length)return null;
      current.host=remaining[0];return current;
    });return;
  }
  if(name==='startGame'){
    const rounds=data.rounds,timeLimit=data.timeLimit,hintSeconds=timeLimit ? data.hintSeconds : 0; if(!Number.isInteger(rounds)||rounds<1||rounds>5)throw Error('周回数は1〜5にしてください。');if(![0,30,60,90,120].includes(timeLimit))throw Error('制限時間を選んでください。');if(![0,5,10,15,20].includes(hintSeconds)||hintSeconds>=timeLimit&&hintSeconds!==0)throw Error('文字ヒントのタイミングを選んでください。');
    let reason='開始できませんでした。'; let order, gameId;
    const locked=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='lobby')return;
      order=shuffle(Object.keys(current.players||{}));
      if(order.length<2){reason='2人以上で始めてください。';return;}
      gameId=current.gameId;current.phase='starting';return current;
    });
    if(!locked.committed)throw Error(reason);
    const answers=shuffle(topics).slice(0,order.length*rounds);
    try{
      await Promise.all(answers.flatMap((answer,i)=>{const writes=[set(ref(db,`secrets/${data.code}/${gameId}/${i}`),answer)];if(hintSeconds)writes.push(set(ref(db,`hints/${data.code}/${gameId}/${i}`),createHint(answer,shuffle)));return writes;}));
      const started=await transaction(`rooms/${data.code}`,current=>{
        if(!current||current.host!==user.uid||current.phase!=='starting'||current.gameId!==gameId)return;
        return {...current,phase:'playing',rounds,timeLimit,hintSeconds,turnStartedAt:serverTimestamp(),order,turn:0,drawer:order[0],lengths:answers.map(answer=>Array.from(answer).length)};
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
    const turn=room.turn,gameId=room.gameId,startedAt=room.turnStartedAt,duration=room.timeLimit;
    if(duration>0&&remainingMs(startedAt,duration,Date.now()+serverOffset)===0)throw Error('時間切れです。結果を待ってね。');
    try{
      const result=await transaction(`claims/${data.code}/${gameId}/${turn}`,current=>current?undefined:{kind:'answer',uid:user.uid,answer,at:serverTimestamp(),startedAt,duration});
      return {correct:result.committed};
    }catch(e){if(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied'))return {correct:false};throw e;}
  }
  if(name==='timeout'){
    const {turn,gameId,startedAt,duration}=data;
    return transaction(`claims/${data.code}/${gameId}/${turn}`,current=>current?undefined:{kind:'timeout',uid:user.uid,at:serverTimestamp(),startedAt,duration});
  }
  if(name==='nextTurn'){
    const turn=room.turn, claim=claims[turn]; if(!claim)throw Error('まだ正解が出ていません。');
    const result=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='playing'||current.turn!==turn)return;
      const next=turn+1;if(next>=current.order.length*current.rounds)current.phase='finished';
      else {current.turn=next;current.drawer=current.order[next%current.order.length];current.turnStartedAt=serverTimestamp();}return current;
    });
    if(!result.committed)throw Error('すでに進行しています。');return;
  }
}
async function action(button, task){button.disabled=true; try{await task();}catch(e){toast(friendly(e));}finally{button.disabled=false;}}
function enterRoom(roomCode){
  code=roomCode; show('home',false);show('room',true);$('room-code').textContent=code;
  if(unsubscribe) unsubscribe();
  unsubscribe=onValue(ref(db,`rooms/${code}`), snap=>{room=snap.val();if(!room){toast('部屋が終了しました。');goHome();return;}if(!unsubscribeClaims){unsubscribeClaims=onValue(ref(db,`claims/${code}/${room.gameId}`),snap=>{claims=snap.val()||{};if(room)render();},e=>toast(friendly(e)));}if(!unsubscribeChat){unsubscribeChat=onValue(query(ref(db,`chats/${code}/${room.gameId}`),limitToLast(100)),snap=>renderChat(snap.val()),e=>toast(friendly(e)));}render();}, e=>toast(friendly(e)));
  if(timerHandle)clearInterval(timerHandle);timerHandle=setInterval(updateTimer,250);
  window.scrollTo(0,0);
}
function goHome(){if(unsubscribe)unsubscribe();if(unsubscribeDrawing)unsubscribeDrawing();if(unsubscribeClaims)unsubscribeClaims();if(unsubscribeChat)unsubscribeChat();unsubscribe=null;unsubscribeClaims=null;unsubscribeChat=null;unsubscribeDrawing=null;if(timerHandle)clearInterval(timerHandle);timerHandle=null;timeoutPending='';timeoutWord='';timeoutWordKey='';hintKey='';hintValue=null;hintPending='';hintRetryAt=0;soundTurnKey='';soundResultKey='';soundHadRoomState=false;claims={};strokes=[];drawing=false;activeTurn=undefined;wordKey=undefined;drawerWord='';room=null;code=null;delete $('chat-messages').dataset.loaded;renderChat(null);show('room',false);show('home',true);}
function refreshSoundButton(){const on=soundEnabled(),button=$('sound-toggle');button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',on?'効果音をオフにする':'効果音をオンにする');button.querySelector('span').textContent=on?'効果音 ON':'効果音 OFF';}
$('sound-toggle').onclick=()=>{setSoundEnabled(!soundEnabled());refreshSoundButton();if(soundEnabled())playSound('turn');};
document.addEventListener('pointerdown',unlockAudio,{passive:true});document.addEventListener('keydown',unlockAudio);
refreshSoundButton();
function updateHintSetting(){ $('hint-seconds').disabled=!room||room.host!==user?.uid||Number($('time-limit').value)===0; }
$('time-limit').addEventListener('change',updateHintSetting);
$('create').onclick=()=>action($('create'),async()=>{const name=$('create-name').value.trim();if(!name)throw Error('なまえを入力してね。');await connect();const result=await call('createRoom',{name});enterRoom(result.code);});
$('join').onclick=()=>action($('join'),async()=>{const name=$('join-name').value.trim(), roomCode=$('join-code').value.trim().toUpperCase();if(!name)throw Error('なまえを入力してね。');if(!/^[A-Z0-9]{6}$/.test(roomCode))throw Error('合言葉は半角英数字6文字で入力してね。');await connect();await call('joinRoom',{name,code:roomCode});enterRoom(roomCode);});
$('leave').onclick=()=>action($('leave'),async()=>{if(room?.phase==='lobby') await call('leaveRoom',{code});else if(!confirm('ホームに戻りますか？ 同じブラウザから合言葉で再参加できます。'))return;goHome();});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);toast('合言葉をコピーしました！');}catch{toast('合言葉を選択してコピーしてね。');}};
$('start').onclick=()=>action($('start'),async()=>{await call('startGame',{code,rounds:Number($('rounds').value),timeLimit:Number($('time-limit').value),hintSeconds:Number($('hint-seconds').value)});});
$('next').onclick=()=>action($('next'),async()=>{await call('nextTurn',{code});});
$('answer-form').onsubmit=e=>{e.preventDefault();action(e.submitter || e.currentTarget.querySelector('button[type=submit], button:not([type])'),async()=>{const answer=$('answer').value.trim();if(!answer)throw Error('答えを入力してね。');const result=await call('submitAnswer',{code,answer});$('answer').value='';if(!result.correct)toast(room?.timeLimit&&remainingMs(room.turnStartedAt,room.timeLimit,Date.now()+serverOffset)===0?'時間切れです。結果を待ってね。':'おしい！もう一度考えてみよう。');});};
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
  if(soundTurnKey!==key){soundTurnKey=key;if(!first&&!claim)playSound('turn');}
  if(claim&&soundResultKey!==key){soundResultKey=key;if(!first)playSound(claim.kind==='timeout'?'timeout':'correct');}
 }
 soundHadRoomState=true;
}

function render(){
 const host=room.host===user.uid, lobby=room.phase==='lobby'||room.phase==='starting', finished=room.phase==='finished', claim=claims[room.turn], revealed=room.phase==='playing'&&!!claim, playing=room.phase==='playing'&&!claim, drawer=room.drawer===user.uid;
 show('lobby',lobby);show('game',!lobby);show('players-panel',lobby);show('start',host&&room.phase==='lobby');show('start-hint',lobby&&(!host||room.phase==='starting'));$('start-hint').textContent=room.phase==='starting'?'ゲームを準備しています…':'ホストがゲームを開始するまで待ってね';$('rounds').disabled=!host;$('time-limit').disabled=!host;updateHintSetting();updateGameSounds();
 $('room-title').textContent=lobby?'みんなの部屋':finished?'ゲーム終了！':'おえかきバトル！';
 $('room-subtitle').textContent=lobby?'友だちが集まるまで、ちょっと待ってね。':finished?'みんなで遊んでくれてありがとう！':`合言葉 ${code}　・　みんなで楽しく遊ぼう`;
 const players=Object.entries(room.players||{}).map(([id,p])=>[id,{...p,score:Object.values(claims).filter(c=>c?.kind!=='timeout'&&c?.uid===id).reduce((sum,c)=>sum+scoreForClaim(c),0)}]); $('player-count').textContent=`${players.length}人`;
 const order=room.order||players.map(([id])=>id);players.sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
 $('players').replaceChildren(...players.map(([id,p],i)=>{const div=document.createElement('div');div.className='player';const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('div');name.className='player-name';name.textContent=p.name+(id===user.uid?'（あなた）':'');const meta=document.createElement('small');meta.textContent=id===room.host?'HOST':(!lobby&&id===room.drawer?'おえかき中':'');name.appendChild(meta);const score=document.createElement('b');score.textContent=lobby?'':`${p.score||0} pt`;div.append(avatar,name,score);return div;}));
 $('game-players').replaceChildren(...players.map(([id,p],i)=>{const chip=document.createElement('div');chip.className='game-player'+(id===room.drawer?' is-drawer':'');const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('span');name.className='game-player-name';name.textContent=p.name+(id===user.uid?'（自分）':'');const score=document.createElement('span');score.className='game-player-score';score.textContent=`${p.score||0} pt`;chip.append(avatar,name,score);if(id===room.drawer){const role=document.createElement('span');role.className='game-player-role';role.textContent='✎';chip.append(role);}return chip;}));
 if(lobby)return;
 const total=room.order.length*room.rounds;
 $('turn-label').textContent=finished?'GAME COMPLETE':`ROUND ${Math.floor(room.turn/room.order.length)+1} / ${room.rounds}　・　${room.turn+1} / ${total} ターン`;
 $('turn-badge').textContent=finished?'🏆':drawer?'🎨':'💡';
 show('tools',playing&&drawer);show('answer-form',playing&&!drawer);show('result',!playing);show('next',revealed&&host);
 if(finished){const max=Math.max(...players.map(([,p])=>p.score||0));const winners=players.filter(([,p])=>(p.score||0)===max).map(([,p])=>p.name).join('、');$('prompt').textContent='おつかれさま！';$('word-tiles').replaceChildren();$('game-hint').textContent='すべてのターンが終わりました。';$('result').textContent=`🏆 ${winners}　${max}ポイント！`;}
 else if(revealed){const timeout=claim.kind==='timeout';$('prompt').textContent=timeout?'時間切れ！':'正解！';$('game-hint').textContent=host?'次のターンに進もう！':'ホストが次へ進むのを待ってね。';if(timeout){const key=`${code}:${room.gameId}:${room.turn}`;if(timeoutWordKey!==key){timeoutWordKey=key;timeoutWord='';call('getWord',{code}).then(data=>{if(room?.turn===data.turn&&timeoutWordKey===key&&claims[room.turn]?.kind==='timeout'){timeoutWord=data.word;render();}}).catch(e=>{if(timeoutWordKey===key)timeoutWordKey='';toast(friendly(e));});}renderTiles(room.lengths[room.turn],timeoutWord);$('result').textContent=timeoutWord?`⌛ 時間切れ！ 答えは「${timeoutWord}」`:'⌛ 時間切れ！ 答えを確認中…';}else{renderTiles(Array.from(claim.answer).length,claim.answer);$('result').textContent=`🎉 ${room.players[claim.uid]?.name || 'だれか'} が正解！ 「${claim.answer}」 +${scoreForClaim(claim)}点`;}}
 else {const drawerName=room.players[room.drawer]?.name||'だれか';$('prompt').textContent=drawer?'お題を描こう！':'何を描いているかな？'; $('game-hint').textContent=drawer?'あなたの番！お題の絵を描こう。':`${drawerName} さんがおえかき中！答えはひらがなで入力してね。`;
 const length=room.lengths[room.turn],key=`${code}:${room.gameId}:${room.turn}`;
 if(!drawer&&room.timeLimit&&room.hintSeconds)$('game-hint').textContent+=hintKey===key?' 💡 文字ヒント公開！':` 残り${room.hintSeconds}秒で文字ヒント！`;
 if(drawer){if(wordKey!==key){wordKey=key;drawerWord='';call('getWord',{code}).then(data=>{if(room?.phase==='playing'&&!claims[room.turn]&&room.turn===data.turn&&room.drawer===user.uid&&wordKey===key){drawerWord=data.word;renderTiles(length,drawerWord);}}).catch(e=>{if(wordKey===key)wordKey=undefined;toast(friendly(e));});}renderTiles(length,drawerWord);}
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
 if(!room||room.phase!=='playing'||!room.timeLimit){show('timer',false);return;}
 const left=remainingMs(room.turnStartedAt,room.timeLimit,Date.now()+serverOffset);
 if(left===null){show('timer',false);return;}
 const claim=claims[room.turn];
 const frozen=claim?.at?remainingMs(room.turnStartedAt,room.timeLimit,claim.at):left;
 const seconds=Math.ceil(frozen/1000);$('timer').textContent=`${seconds}秒`;$('timer').classList.toggle('low',seconds<=10);show('timer',true);updateDrawingControls();
 if(!claim && left>0 && room.hintSeconds>0 && left<=room.hintSeconds*1000 && room.drawer!==user.uid) fetchHint();
 if(claim||left>0)return;
 const turn=room.turn,roomCode=code,gameId=room.gameId,startedAt=room.turnStartedAt,duration=room.timeLimit,key=`${roomCode}:${gameId}:${turn}`;
 if(timeoutPending===key)return;
 timeoutPending=key;
 call('timeout',{code:roomCode,turn,gameId,startedAt,duration}).catch(e=>{if(!(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied')))toast(friendly(e));}).finally(()=>{if(timeoutPending===key)setTimeout(()=>{if(timeoutPending===key)timeoutPending='';},1000);});
}
function fetchHint(){
 const roomCode=code,gameId=room.gameId,turn=room.turn,key=`${roomCode}:${gameId}:${turn}`;
 if(hintKey===key||hintPending===key||Date.now()<hintRetryAt)return;
 hintPending=key;
 get(ref(db,`hints/${roomCode}/${gameId}/${turn}`)).then(snapshot=>{
  if(code!==roomCode||!room||room.gameId!==gameId||room.turn!==turn||room.phase!=='playing'||claims[turn]||room.drawer===user.uid)return;
  const value=snapshot.val();if(!value){hintRetryAt=Date.now()+3000;return;}
  hintKey=key;hintValue=value;playSound('hint');render();
 }).catch(()=>{hintRetryAt=Date.now()+1000;}).finally(()=>{if(hintPending===key)hintPending='';});
}
// Drawing events are append-only, so undo and clear replay consistently for late joiners.
function paint(stroke){const pts=JSON.parse(stroke.points);if(!Array.isArray(pts)||!pts.length)return;ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);if(pts.length===1)ctx.lineTo(pts[0][0]+.01,pts[0][1]+.01);else for(const p of pts.slice(1))ctx.lineTo(p[0],p[1]);ctx.stroke();}
function redraw(){ctx.clearRect(0,0,canvas.width,canvas.height);for(const stroke of strokes){try{paint(stroke);}catch(e){console.error(e);}}if(drawing&&points.length)paint({color,width:Number($('brush-size').value),points:JSON.stringify(points)});show('canvas-placeholder',!strokes.length&&!drawing);updateDrawingControls();}
function turnExpired(){return !!(room?.timeLimit && remainingMs(room.turnStartedAt,room.timeLimit,Date.now()+serverOffset)===0);}
function updateDrawingControls(){const disabled=!room||room.phase!=='playing'||!!claims[room.turn]||turnExpired()||room.drawer!==user.uid||drawing||pendingDraws>0||!strokes.length;$('undo').disabled=disabled;$('clear').disabled=disabled;}
function sendDrawingEvent(event){
 const roomCode=code,gameId=room.gameId,turn=room.turn;pendingDraws++;updateDrawingControls();
 const task=drawQueue.catch(()=>{}).then(async()=>{
   if(code!==roomCode||!room||room.gameId!==gameId||room.turn!==turn||room.phase!=='playing'||claims[turn]||room.drawer!==user.uid)throw Error('ターンが終了したため、描画を保存できませんでした。');
   await set(push(ref(db,`drawings/${roomCode}/${gameId}/${turn}`)),event);
 });
 drawQueue=task;task.catch(e=>toast(friendly(e))).finally(()=>{pendingDraws--;updateDrawingControls();});return task;
}
function pos(e){const rect=canvas.getBoundingClientRect();return [Math.max(0,Math.min(canvas.width,Math.round((e.clientX-rect.left)*canvas.width/rect.width))),Math.max(0,Math.min(canvas.height,Math.round((e.clientY-rect.top)*canvas.height/rect.height)))];}
canvas.addEventListener('pointerdown',e=>{if(!room||room.phase!=='playing'||claims[room.turn]||turnExpired()||room.drawer!==user.uid)return;e.preventDefault();drawing=true;points=[pos(e)];canvas.setPointerCapture(e.pointerId);show('canvas-placeholder',false);updateDrawingControls();});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=pos(e),previous=points[points.length-1];if(p[0]===previous[0]&&p[1]===previous[1])return;points.push(p);if(points.length>800)points=points.filter((_,i)=>i%2===0||i===points.length-1);paint({color,width:Number($('brush-size').value),points:JSON.stringify([previous,p])});});
function finishStroke(){if(!drawing)return;drawing=false;if(!room||room.phase!=='playing'||claims[room.turn]||turnExpired()||room.drawer!==user.uid){redraw();return;}const stroke={color,width:Number($('brush-size').value),points:JSON.stringify(points)};points=[];sendDrawingEvent(stroke).catch(()=>{redraw();});updateDrawingControls();}
canvas.addEventListener('pointerup',finishStroke);canvas.addEventListener('pointercancel',finishStroke);
$('undo').onclick=()=>{if(!room||!strokes.length)return;sendDrawingEvent({action:'undo'}).catch(()=>{});};
$('clear').onclick=()=>{if(!room||!strokes.length||!confirm('絵を全部消しますか？'))return;sendDrawingEvent({action:'clear'}).catch(()=>{});};
$('colors').onclick=e=>{const button=e.target.closest('button');if(!button)return;color=button.dataset.color;document.querySelectorAll('#colors button').forEach(b=>b.classList.toggle('selected',b===button));};
$('colors').firstElementChild.classList.add('selected');

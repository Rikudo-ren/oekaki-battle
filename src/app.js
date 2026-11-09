import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { createMemoryDatabase, ref, onValue, push, set, get, runTransaction, query, limitToLast, serverTimestamp, update, onDisconnect } from './database.mjs';
import { soloDrawings, cpuWord } from './solo-drawings.mjs';
import { aiRequest, parseAiDrawing, parseAiGuess } from './ai.mjs';
import { reduceDrawingEvents, applyDrawingEvent, pointerToLogical, logicalToCanvasY } from './drawing.mjs';
import { remainingMs, awardForClaim, timeBand } from './timing.mjs';
import { scoreDeltas, scoresForRoom, ranking } from './scoring.mjs';
import { topics } from './topics.mjs';
import { createHint, hintCharacters } from './hints.mjs';
import { unlockAudio, playSound, playWhistle, soundEnabled, setSoundEnabled, musicEnabled, setMusicEnabled, setMusicScene } from './audio.mjs';
import { isOnline, onlinePlayers, isAbandoned, canSkipAbsentDrawer } from './room-management.mjs';
import { turnStart, countdownRemaining, resultReady, correctEntries, nextSlot, extendSchedule, nextOnlineScheduleIndex } from './rounds.mjs';
import { END_SCENE_MS, ANSWER_SCENE_MS, RESULT_SCENE_MS, SCORE_SCENE_MS, SCORE_BONUS_MS, SCORE_MOVE_MS, SCORE_SETTLED_MS, GO_SCENE_MS, resultScene, finalSceneVisible, scoreStage, animatedScore } from './presentation.mjs';

const $ = id => document.getElementById(id);
let drawingKeys=[], strokeId='', strokeColor='', strokeWidth=0, strokeTimer=null, strokeDirty=false, advancePending='', advanceRetryAt=0, roundPending='', roundRetryAt=0;
let app, auth, db, user, code, room, claims={}, unsubscribe, unsubscribeClaims, unsubscribeDrawing, unsubscribeChat, activeTurn, wordKey, drawerWord='', color='#393632', drawing=false, points=[], strokes=[], pendingDraws=0, serverOffset=0, timeoutPending='', timeoutWord='', timeoutWordKey='', timerHandle=null, hintKey='', hintValue=null, hintPending='', hintRetryAt=0, soundTurnKey='', soundResultKey='', soundHadRoomState=false;
let presenceSession=null, hostElectionPending=false, hostElectionRetryAt=0, skipPending='', skipRetryAt=0, prunePending=false, pruneRetryAt=0;
let countdownKey='', countdownValue=0, revealKey='', revealRetryAt=0, soundAnswerKey='', soundAnswerCount=0;
let chatMessages={}, chatRevealedWords={}, chatWordPending={}, chatSending=false, chatGuardKey='', claimsInitialized=false, leavingRoom='';
let passAdvancePending='', passRetryAt=0, lastRenderedPhase='', subscribedGameId='', scoreboardKey='', hintNoticeKey='', hintNoticeTimer=null;
let presentationKey='', endSceneKey='', answerSceneKey='', finalSceneKey='', correctNoticeTimer=null, soundFinalKey='';
let scoreboardAnimation=null, scoreboardFrame=null, answerSlotKey='';
const PUBLIC_ROOMS={'OPEN01':'わいわい部屋','OPEN02':'のんびり部屋','OPEN03':'おえかき部屋'};
const CPU_IDS=['cpu-1','cpu-2','cpu-3'];
let soloMode=false, savedUser=null, savedDb=null, botTurnKey='', botPlan=[], botDrawn=0, botWord='', botLoading=false, botWriting=false;
const AI_BOT='cpu-1';let soloAI=null, aiDraw=null, aiAbort=null, aiModelAbort=null;
const pointFields=[['answer-early','answerEarly'],['answer-middle','answerMiddle'],['answer-late','answerLate'],['drawer-early','drawerEarly'],['drawer-middle','drawerMiddle'],['drawer-late','drawerLate'],['flat-points','flatPoints'],['flat-drawer-points','flatDrawerPoints']];
const canvas=$('canvas'), ctx=canvas.getContext('2d');
const show=(id, visible)=>$(id).classList.toggle('hidden',!visible);
const setText=(id,text)=>{const node=$(id);if(node.textContent!==text)node.textContent=text;};
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
async function waitForWrites(writes){const results=await Promise.allSettled(writes);const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;}
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
    if(!['lobby','starting','playing'].includes(current.phase)&&!(PUBLIC_ROOMS[data.code]&&current.phase==='finished'))throw Error('このゲームは終了しています。');
    if(Object.keys(current.players||{}).length>=8)throw Error('部屋は満員です。');
    try { await set(ref(db,`rooms/${data.code}/players/${user.uid}`),{name:data.name,score:0}); }
    catch(e){if(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied'))throw Error('参加できませんでした。部屋が終了した可能性があります。');throw e;}
    rememberRoom(data.code);return {code:data.code};
  }
  if(name==='openPublicRoom'){
    const roomCode=data.code;if(!PUBLIC_ROOMS[roomCode])throw Error('部屋が見つかりません。');
    let current=(await get(ref(db,`rooms/${roomCode}`))).val();
    if(current&&isAbandoned(current,Date.now()+serverOffset)){await cleanupAbandoned(roomCode);current=(await get(ref(db,`rooms/${roomCode}`))).val();}
    if(!current){
      try{const result=await transaction(`rooms/${roomCode}`,existing=>existing?undefined:{host:user.uid,phase:'lobby',gameId:randomId(20),players:{[user.uid]:{name:data.name,score:0}},createdAt:serverTimestamp(),lastOnline:serverTimestamp()});if(result.committed){rememberRoom(roomCode);return {code:roomCode};}}
      catch(e){if(e.code!=='PERMISSION_DENIED'&&!e.message?.toLowerCase().includes('permission_denied'))throw e;}
    }
    await call('joinRoom',{code:roomCode,name:data.name});return {code:roomCode};
  }
  if(name==='leaveRoom'){
    // Lock the room before removing the GM's presence. Otherwise another
    // participant could elect a new GM in the gap and keep the room alive.
    if(room?.host===user.uid){
      const result=await transaction(`rooms/${data.code}`,current=>{
        if(!current||current.host!==user.uid||current.phase==='closing')return;
        current.phase='closing';current.cleanupBy=user.uid;current.closingAt=serverTimestamp();return current;
      });
      if(result.committed){
        try{await stopPresence();}catch(e){console.error('接続状態の解除に失敗しました',e);}
        await cleanupRoom(data.code,result.snapshot.val().gameId);forgetRoom(data.code);return;
      }
    }
    await stopPresence();
    const result=await transaction(`rooms/${data.code}`,current=>{
      if(!current)return;
      if(current.phase==='closing')return current.cleanupBy===user.uid?current:undefined;
      const online=onlinePlayers(current);
      if(!online.length&&current.players?.[user.uid]){current.phase='closing';current.cleanupBy=user.uid;current.closingAt=serverTimestamp();return current;}
      if(current.host!==user.uid||isOnline(current,user.uid))return;
      if(current.phase==='lobby')delete current.players[user.uid];
      if(online.length)current.host=online[0];
      if(current.phase==='starting'){if(current.startOrigin==='round'){delete current.extraToken;}else{current.phase=current.startOrigin==='finished'?'finished':'lobby';delete current.startOrigin;delete current.extraToken;}}
      return current;
    });
    const current=result.snapshot?.val() || (await get(ref(db,`rooms/${data.code}`))).val();
    if(current?.phase==='closing'&&current.cleanupBy===user.uid){await cleanupRoom(data.code,current.gameId);forgetRoom(data.code);return;}
    if(current?.phase==='lobby'&&current.players?.[user.uid]&&!isOnline(current,user.uid))await set(ref(db,`rooms/${data.code}/players/${user.uid}`),null);
    return;
  }
  if(name==='startGame'){
    const rounds=1,timeLimit=data.timeLimit,hintSeconds=timeLimit ? data.hintSeconds : 0,requestedMax=data.maxCorrect;const scoring=Object.fromEntries(pointFields.map(([,key])=>[key,data[key]])); if(!Number.isInteger(timeLimit)||(timeLimit!==0&&(timeLimit<10||timeLimit>600)))throw Error('制限時間は10〜600秒で設定してください。');if(!Number.isInteger(requestedMax)||requestedMax<0||requestedMax>7)throw Error('正解できる人数を選んでください。');if(!Object.values(scoring).every(n=>Number.isInteger(n)&&n>=0&&n<=100))throw Error('配点は0〜100点で設定してください。');if(![0,5,10,15,20].includes(hintSeconds)||hintSeconds>=timeLimit&&hintSeconds!==0)throw Error('文字ヒントのタイミングを選んでください。');
    let reason='開始できませんでした。'; let order, gameId;
    const locked=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='lobby'||!isOnline(current,user.uid))return;
      order=shuffle(onlinePlayers(current));
      if(order.length<2){reason='2人以上で始めてください。';return;}if(order.length>8){reason='参加人数が8人を超えています。8人以下にしてから始めてください。';return;}
      gameId=current.gameId;current.phase='starting';return current;
    });
    if(!locked.committed)throw Error(reason);
    if(locked.snapshot.val().hasPlayed){
      try {
        await clearGameData(data.code,gameId);
        const nextGame=randomId(20),oldGame=gameId;
        const rotated=await transaction(`rooms/${data.code}`,current=>{
          if(!current||current.phase!=='starting'||current.host!==user.uid||current.gameId!==oldGame)return;
          current.gameId=nextGame;return current;
        });
        if(!rotated.committed)throw Error('ゲームの準備をやり直してください。');
        gameId=nextGame;
      } catch(e){await transaction(`rooms/${data.code}`,current=>{if(current?.phase==='starting'&&current.host===user.uid)current.phase='lobby';return current;});if(e.code==='PERMISSION_DENIED'||e.message?.toLowerCase().includes('permission_denied'))throw Error('再スタートには最新のFirebaseルールの公開が必要です。');throw e;}
    }
    const schedule=Array.from({length:rounds},()=>order).flat();
    const answers=shuffle(topics).slice(0,8*rounds).map((word,i)=>soloMode&&!soloAI&&CPU_IDS.includes(schedule[i])?cpuWord(shuffle):word),matchId=randomId(20);
    try{
      await waitForWrites(answers.flatMap((answer,i)=>{const writes=[set(ref(db,`secrets/${data.code}/${gameId}/${i}`),answer)];if(hintSeconds)writes.push(set(ref(db,`hints/${data.code}/${gameId}/${i}`),createHint(answer,shuffle)));return writes;}));
      const started=await transaction(`rooms/${data.code}`,current=>{
        if(!current||current.host!==user.uid||current.phase!=='starting'||current.gameId!==gameId)return;
        Object.values(current.players||{}).forEach(player=>{player.score=0;});
        return {...current,finishAfterRound:false,matchId,hasPlayed:true,extraRounds:0,turnIds:null,scheduleIndex:0,nextTurnIndex:8*rounds,phase:'playing',rounds,timeLimit,hintSeconds,maxCorrect:requestedMax===0?order.length-1:Math.min(requestedMax,order.length-1),...scoring,scoreMode:'thirds',correctSetting:requestedMax,turnStartedAt:serverTimestamp(),order,schedule,turn:0,drawer:order[0],lengths:answers.map(answer=>Array.from(answer).length)};
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
      if(prior&&prior!==answer)return {correct:false,verified:false};
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
    return {correct:result.committed||correctEntries(state).some(entry=>entry.uid===user.uid),verified:true,ended:!!state?.ended};
  }
  if(name==='endTurn'){
    const {turn,gameId,reason}=data;
    return transaction(`claims/${data.code}/${gameId}/${turn}`,current=>{
      current=current||{};if(current.ended||(reason==='pass'&&correctEntries(current).length))return;
      current.ended={reason,at:serverTimestamp()};return current;
    });
  }
  if(name==='passTopic'){
    const roomCode=data.code,gameId=room.gameId,turn=room.turn;
    if(room.phase!=='playing'||room.drawer!==user.uid||claims[turn]?.ended||correctEntries(claims[turn]).length||turnExpired()||!drawerWord)throw Error('正解者が出る前にパスしてね。');
    const options=topics.filter(word=>word!==drawerWord),answer=options[randomInt(options.length)];
    await set(ref(db,`passCandidates/${roomCode}/${gameId}/${turn}`),answer);
    const result=await call('endTurn',{code:roomCode,gameId,turn,reason:'pass'});
    if(!result.committed)throw Error('すでに正解者が出たためパスできません。');
    return;
  }
  if(name==='forceEnd'){
    const roomCode=data.code,gameId=room.gameId,turn=room.turn;
    const saved=(await get(ref(db,`claims/${roomCode}/${gameId}`))).val()||{},now=Date.now()+serverOffset;
    const result=await transaction(`rooms/${roomCode}`,current=>{
      if(!current||current.host!==user.uid||current.gameId!==gameId||current.turn!==turn||!['playing','finished'].includes(current.phase))return;
      const scores=scoresForRoom(current,saved,now);
      for(const [uid,player] of Object.entries(current.players||{}))player.score=scores[uid];
      current.phase='lobby';return current;
    });
    if(!result.committed)throw Error('ゲームの状態が変わりました。');
    return;
  }
  if(name==='oneMoreRound'||name==='continueRound'){
    const roomCode=data.code,gameId=room.gameId,matchId=room.matchId,token=randomId(20);
    const locked=await transaction(`rooms/${roomCode}`,current=>{
      if(!current||current.host!==user.uid||current.gameId!==gameId||current.matchId!==matchId||!isOnline(current,user.uid)||(name==='oneMoreRound'?current.phase!=='finished':!(current.phase==='starting'&&current.startOrigin==='round')))return;
      if(!Number.isInteger(current.nextTurnIndex)||!Number.isInteger(current.rounds)||!Array.isArray(current.schedule))return;
      if(name==='continueRound'&&onlinePlayers(current).length<2){current.phase='finished';current.finishedAt=serverTimestamp();delete current.startOrigin;delete current.extraToken;return current;}
      current.phase='starting';current.startOrigin=name==='continueRound'?'round':'finished';current.extraToken=token;return current;
    });
    if(!locked.committed)throw Error('もう一周を開始できませんでした。');
    const state=locked.snapshot.val();if(state.phase==='finished')return;const base=state.nextTurnIndex;
    const plannedOrder=[...(state.order||[]).filter(uid=>state.players?.[uid]),...Object.keys(state.players||{}).filter(uid=>!(state.order||[]).includes(uid)).sort()];
    const words=shuffle(topics).slice(0,8).map((word,i)=>soloMode&&!soloAI&&CPU_IDS.includes(plannedOrder[i])?cpuWord(shuffle):word);
    try{
      await waitForWrites(words.flatMap((word,i)=>{
        const writes=[set(ref(db,`secrets/${roomCode}/${gameId}/${base+i}`),word)];
        if(state.hintSeconds)writes.push(set(ref(db,`hints/${roomCode}/${gameId}/${base+i}`),createHint(word,shuffle)));
        return writes;
      }));
      const started=await transaction(`rooms/${roomCode}`,current=>{
        if(!current||current.phase!=='starting'||current.startOrigin!==(name==='continueRound'?'round':'finished')||current.extraToken!==token||current.host!==user.uid||current.gameId!==gameId||current.nextTurnIndex!==base)return;
        const players=current.players||{},scheduled=new Set(current.order||[]);
        const order=[...(current.order||[]).filter(uid=>players[uid]),...Object.keys(players).filter(uid=>!scheduled.has(uid)).sort()];
        if(order.length<2||order.length>8||onlinePlayers(current).length<2)return;
        const schedule=[...current.schedule,...order],first=current.schedule.length,next=nextOnlineScheduleIndex(current,schedule,first),ids={...(current.turnIds||{})};
        current.lengths=Array.isArray(current.lengths)?current.lengths:Object.assign([],current.lengths);
        for(let i=0;i<8;i++){ids[first+i]=base+i;current.lengths[base+i]=Array.from(words[i]).length;}
        current.order=order;current.schedule=schedule;current.turnIds=ids;current.extraRounds=(current.extraRounds||0)+1;
        current.scheduleIndex=next;current.turn=ids[next]??next;current.drawer=schedule[next];current.nextTurnIndex=base+8;
        current.maxCorrect=Math.min(current.correctSetting||7,onlinePlayers(current).length-1,7);
        current.phase='playing';current.finishAfterRound=false;current.turnStartedAt=serverTimestamp();delete current.startOrigin;delete current.extraToken;
        return current;
      });
      if(!started.committed)throw Error('もう一周を開始できませんでした。');
    }catch(e){
      await transaction(`rooms/${roomCode}`,current=>{if(current?.phase==='starting'&&current.host===user.uid&&current.gameId===gameId&&current.extraToken===token){current.phase=name==='continueRound'?'starting':'finished';if(name!=='continueRound')delete current.startOrigin;delete current.extraToken;return current;}});
      throw e;
    }
    return;
  }
  if(name==='nextTurn'){
    const turn=room.turn,gameId=room.gameId,matchId=room.matchId, claim=claims[turn],skipped=claim?.ended?.reason==='skip'; if(!claim?.ended||!Number.isFinite(claim.ended.at)||(!skipped&&(!resultReady(claim,Date.now()+serverOffset)||Date.now()+serverOffset<claim.ended.at+RESULT_SCENE_MS||timeoutWordKey!==`${code}:${room.gameId}:${room.matchId}:${turn}`||!timeoutWord)))throw Error('結果発表を待ってね。');
    const result=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='playing'||current.gameId!==gameId||current.matchId!==matchId||current.turn!==turn)return;
      const schedule=extendSchedule(current.schedule,current.players,1);
      current.schedule=schedule;
      const next=nextOnlineScheduleIndex(current,schedule,(current.scheduleIndex??turn)+1);if(onlinePlayers(current).length<2||(next<0&&current.finishAfterRound)){current.phase='finished';current.finishedAt=serverTimestamp();}
      else if(next<0){current.phase='starting';current.startOrigin='round';}
      else {
        current.scheduleIndex=next;current.turn=current.turnIds?.[next]??next;current.drawer=schedule[next];current.turnStartedAt=serverTimestamp();
        current.maxCorrect=Math.min(current.correctSetting||7,onlinePlayers(current).length-1,7);
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
async function clearGameData(roomCode,gameId){
  await waitForWrites(['secrets','claims','drawings','chats','hints','verified','chatGuard','passCandidates'].map(root=>set(ref(db,`${root}/${roomCode}/${gameId}`),null)));
}
async function cleanupRoom(roomCode,gameId){
  // The room is locked in closing state first; nobody can join during cleanup.
  await clearGameData(roomCode,gameId);
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
 const session={roomCode,uid,connection,db,active:true,ready:Promise.resolve(),disconnect:null,online:false};presenceSession=session;
 session.unsubscribe=onValue(ref(db,'.info/connected'),snap=>{
  if(!snap.val()){session.online=false;return;}
  session.ready=session.ready.then(async()=>{
   if(!session.active)return;
   const disconnect=onDisconnect(ref(session.db,path));
   await disconnect.update({[`online/${uid}/${connection}`]:null,[`lastDisconnects/${uid}`]:serverTimestamp(),lastOnline:serverTimestamp()});
   if(!session.active){await disconnect.cancel();return;}
   await update(ref(session.db,path),{[`online/${uid}/${connection}`]:true,lastOnline:serverTimestamp()});
   session.disconnect=disconnect;session.online=true;
  }).catch(e=>{if(session.active)toast('接続状態を登録できません。Firebaseのルールを確認してください。');console.error(e);});
 });
}
async function stopPresence(){
 const session=presenceSession;if(!session)return;
 session.active=false;session.unsubscribe();await session.ready;
 if(session.online){
  const {roomCode,uid,connection}=session;
  await update(ref(session.db,`rooms/${roomCode}`),{[`online/${uid}/${connection}`]:null,[`lastDisconnects/${uid}`]:serverTimestamp(),lastOnline:serverTimestamp()});
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
   if(current?.host===user.uid&&current.phase==='starting'){if(current.startOrigin==='round'){delete current.extraToken;}else{current.phase=current.startOrigin==='finished'?'finished':'lobby';delete current.startOrigin;delete current.extraToken;}return current;}
  });
 }).catch(e=>console.error('ホスト交代を再試行します',e)).finally(()=>{hostElectionPending=false;hostElectionRetryAt=Date.now()+1000;});
}
async function action(button, task){const entry=button.closest('#home'),buttons=entry?[...entry.querySelectorAll('#create,#join,#solo-start,#ai-start,[data-public-room]')]:[button];if(buttons.some(item=>item.disabled))return;buttons.forEach(item=>item.disabled=true);try{await task();}catch(e){toast(friendly(e));}finally{buttons.forEach(item=>item.disabled=false);}}
function enterRoom(roomCode){
  $('time-limit').value=soloMode&&soloAI?'60':'30';
  code=roomCode; startPresence(roomCode);show('home',false);show('room',true);$('room-code').textContent=soloMode?(soloAI?'AI対戦':'CPU対戦'):(PUBLIC_ROOMS[code]||code);$('room-code-kicker').textContent=soloMode?'SOLO MODE':PUBLIC_ROOMS[code]?'PUBLIC ROOM':'ROOM CODE';$('room-code-icon').textContent=soloMode?'🤖':PUBLIC_ROOMS[code]?'🌐':'💌';show('copy',!soloMode&&!PUBLIC_ROOMS[code]);$('room-code-title').textContent=soloMode?(soloAI?'ひとりでAI対戦':'ひとりでCPU対戦'):PUBLIC_ROOMS[code]?'だれでも入れる公開部屋':'部屋の合言葉';$('room-code-description').textContent=soloMode?(soloAI?'AIと交互に描いて当てよう！':'CPUと交互に描いて当てよう！'):PUBLIC_ROOMS[code]?'誰でも途中から参加できます':'この合言葉を友だちに教えてね';
  if(unsubscribe) unsubscribe();
  unsubscribe=onValue(ref(db,`rooms/${code}`), snap=>{room=snap.val();if(!room){if(leavingRoom===roomCode)return;toast('部屋が終了しました。');goHome();return;}if(room.phase==='closing'){if(leavingRoom===roomCode)return;toast('GMが退出したため、部屋が終了しました。');goHome();return;}maybeTransferHost();if(subscribedGameId!==room.gameId){
   if(unsubscribeClaims)unsubscribeClaims();if(unsubscribeChat)unsubscribeChat();if(unsubscribeDrawing)unsubscribeDrawing();
   unsubscribeClaims=null;unsubscribeChat=null;unsubscribeDrawing=null;activeTurn=undefined;claims={};claimsInitialized=false;chatMessages={};chatRevealedWords={};chatWordPending={};chatGuardKey='';subscribedGameId=room.gameId;
  }if(!unsubscribeClaims){unsubscribeClaims=onValue(ref(db,`claims/${code}/${room.gameId}`),snap=>{const first=!claimsInitialized;claimsInitialized=true;claims=snap.val()||{};if(first&&room?.phase==='playing'){const key=`${code}:${room.gameId}:${room.matchId}:${room.turn}`;answerSlotKey='';soundAnswerKey=key;soundAnswerCount=correctEntries(claims[room.turn]).length;if(claims[room.turn]?.ended)soundResultKey=key;}if(room)render();},e=>toast(friendly(e)));}if(!unsubscribeChat){unsubscribeChat=onValue(query(ref(db,`chats/${code}/${room.gameId}`),limitToLast(100)),snap=>{chatMessages=snap.val()||{};renderChat(chatMessages);},e=>toast(friendly(e)));}render();}, e=>toast(friendly(e)));
  if(timerHandle)clearInterval(timerHandle);timerHandle=setInterval(()=>{updateTimer();maybeTransferHost();maybeSkipAbsentDrawer();maybePruneLobby();maybeAdvancePass();maybeAdvanceResult();maybeContinueRound();maybeRunSoloBots();},250);
  window.scrollTo(0,0);
}
function goHome(){document.body.classList.remove('screen-lobby','screen-game','is-typing','is-drawing-turn');setMusicScene('room');closeChat();const gm=$('gm-dialog');if(gm.open){if(typeof gm.close==='function')gm.close();else gm.removeAttribute('open');}const settings=$('settings-dialog');if(settings.open){if(typeof settings.close==='function')settings.close();else settings.removeAttribute('open');}if(presenceSession)void stopPresence().catch(e=>console.error(e));if(unsubscribe)unsubscribe();if(unsubscribeDrawing)unsubscribeDrawing();if(unsubscribeClaims)unsubscribeClaims();if(unsubscribeChat)unsubscribeChat();unsubscribe=null;unsubscribeClaims=null;unsubscribeChat=null;unsubscribeDrawing=null;if(timerHandle)clearInterval(timerHandle);timerHandle=null;timeoutPending='';timeoutWord='';timeoutWordKey='';countdownKey='';countdownValue=0;revealKey='';revealRetryAt=0;show('countdown',false);show('round-end',false);show('answer-scene',false);show('final-scene',false);show('correct-notice',false);clearTimeout(correctNoticeTimer);show('scoreboard',false);stopScoreboardAnimation();scoreboardKey='';presentationKey='';endSceneKey='';answerSceneKey='';finalSceneKey='';soundFinalKey='';answerSlotKey='';clearTimeout(hintNoticeTimer);hintNoticeKey='';show('hint-notice',false);hintKey='';hintValue=null;hintPending='';hintRetryAt=0;soundTurnKey='';soundResultKey='';soundHadRoomState=false;soundAnswerKey='';soundAnswerCount=0;claims={};claimsInitialized=false;chatMessages={};chatRevealedWords={};chatWordPending={};chatGuardKey='';passAdvancePending='';passRetryAt=0;lastRenderedPhase='';subscribedGameId='';strokes=[];drawing=false;clearInterval(strokeTimer);points=[];activeTurn=undefined;wordKey=undefined;drawerWord='';room=null;code=null;if(soloMode){soloMode=false;user=savedUser;db=savedDb;savedUser=null;savedDb=null;if(aiAbort)aiAbort.abort();aiAbort=null;aiDraw=null;soloAI=null;botTurnKey='';botWord='';botPlan=[];botLoading=false;botWriting=false;serverOffset=0;}delete $('chat-messages').dataset.loaded;renderChat(null);setAiStatus('');show('room',false);show('home',true);}
function refreshSoundButton(){const on=soundEnabled(),button=$('sound-toggle');button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',on?'効果音をオフにする':'効果音をオンにする');button.querySelector('span').textContent=on?'効果音 ON':'効果音 OFF';}
$('sound-toggle').onclick=()=>{setSoundEnabled(!soundEnabled());refreshSoundButton();if(soundEnabled())playSound('turn');};
document.addEventListener('pointerdown',unlockAudio,{passive:true});document.addEventListener('keydown',unlockAudio);
refreshSoundButton();
function refreshMusicButton(){const on=musicEnabled(),button=$('music-toggle');button.setAttribute('aria-pressed',String(on));button.setAttribute('aria-label',on?'BGMをオフにする':'BGMをオンにする');button.querySelector('span').textContent=on?'BGM ON':'BGM OFF';}
$('music-toggle').onclick=()=>{setMusicEnabled(!musicEnabled());refreshMusicButton();};
refreshMusicButton();
function setEntryTab(tab){
 const create=tab==='create';document.body.classList.toggle('join-mode',!create);
 $('tab-create').setAttribute('aria-selected',String(create));$('tab-join').setAttribute('aria-selected',String(!create));
}
$('tab-create').onclick=()=>setEntryTab('create');$('tab-join').onclick=()=>setEntryTab('join');
$('settings-open').onclick=()=>{const dialog=$('settings-dialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');};
$('settings-close').onclick=()=>{const dialog=$('settings-dialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');};
function closeChat(){document.body.classList.remove('chat-open');$('chat-expand').setAttribute('aria-expanded','false');$('chat-expand').textContent='ひらく ↗';}
// Let mobile browsers scroll focused fields into view when the software
// keyboard covers the viewport; return to the fixed game table after blur.
document.addEventListener('focusin',e=>{if(e.target.matches?.('input:not([type=range])')&&window.matchMedia?.('(max-width: 700px)').matches)document.body.classList.add('is-typing');});
document.addEventListener('focusout',()=>setTimeout(()=>{if(!document.activeElement?.matches?.('input:not([type=range])'))document.body.classList.remove('is-typing');},0));
$('chat-backdrop').onclick=closeChat;
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('chat-open'))closeChat();});
$('chat-expand').onclick=()=>{const open=!document.body.classList.contains('chat-open');document.body.classList.toggle('chat-open',open);$('chat-expand').setAttribute('aria-expanded',String(open));$('chat-expand').textContent=open?'とじる ✕':'ひらく ↗';if(open)$('chat-messages').scrollTop=$('chat-messages').scrollHeight;};
function selectedTimeLimit(){return $('time-limit').value==='custom'?($('custom-time').value.trim()?Number($('custom-time').value):NaN):Number($('time-limit').value);}
function updateHintSetting(){
 const host=room?.host===user?.uid,limit=selectedTimeLimit(),timed=limit>0,custom=$('time-limit').value==='custom';
 $('hint-seconds').disabled=!host||!timed;$('max-correct').disabled=!host;$('custom-time').disabled=!host;
 show('custom-time-wrap',custom);show('time-points',timed);show('flat-points-wrap',!timed);
 for(const [id] of pointFields)$(id).disabled=!host;
 for(const option of $('hint-seconds').options)option.disabled=Number(option.value)>0&&Number(option.value)>=limit;
 if(timed&&$('hint-seconds').selectedOptions[0]?.disabled)$('hint-seconds').value='0';
}
for(const id of ['time-limit','custom-time'])$(id).addEventListener('change',updateHintSetting);
$('create').onclick=()=>action($('create'),async()=>{const name=$('create-name').value.trim();if(!name)throw Error('なまえを入力してね。');await connect();const result=await call('createRoom',{name});enterRoom(result.code);void sweepKnownRooms();});
function resetAiModels(){
 $('solo-start').querySelector('strong').textContent=$('ai-key').value.trim()?'✨ ひとりでAI対戦':'✎ ひとりでCPU対戦';
 $('solo-start').querySelector('span').textContent=$('ai-key').value.trim()?'選択したAIと交互に描いて当てよう':'CPUと交互に描いて当てよう';
 if(aiModelAbort)aiModelAbort.abort();aiModelAbort=null;
 const select=$('ai-model');select.replaceChildren(new Option('モデルを選択',''),new Option('モデルIDを直接入力','__custom'));select.value='';show('ai-custom-wrap',false);
 setText('ai-model-status','キーを入力してモデル一覧を取得するか、モデルIDを直接入力してください。');$('ai-load-models').disabled=false;
}
$('ai-provider').addEventListener('change',resetAiModels);$('ai-key').addEventListener('input',resetAiModels);
$('ai-model').addEventListener('change',()=>{const value=$('ai-model').value;show('ai-custom-wrap',value==='__custom');if(value&&value!=='__custom')setText('ai-model-status','選択中: '+value+'（画像入力対応を確認してください）');});
$('ai-load-models').onclick=async()=>{
 const key=$('ai-key').value.trim(),provider=$('ai-provider').value;
 if(!key){setText('ai-model-status','先にAPIキーを入力してください。');return;}
 if(aiModelAbort)aiModelAbort.abort();const controller=new AbortController();aiModelAbort=controller;$('ai-load-models').disabled=true;setText('ai-model-status','利用できるモデルを取得しています…');
 try{
  const result=await aiRequest({key,provider,model:''},'models',{},controller.signal);
  if(aiModelAbort!==controller)return;
  if(!Array.isArray(result.models))throw Error('モデル一覧を取得できませんでした。');
  const select=$('ai-model');select.replaceChildren(new Option('モデルを選択',''));
  for(const item of result.models){if(!item||typeof item.id!=='string'||typeof item.label!=='string')continue;select.add(new Option(item.label===item.id?item.id:`${item.label}（${item.id}）`,item.id));}
  select.add(new Option('モデルIDを直接入力','__custom'));select.value='';show('ai-custom-wrap',false);
  setText('ai-model-status',result.models.length?'モデルを選んでください。画像入力とテキスト出力に対応したモデルが必要です。':'対象モデルが見つかりません。モデルIDを直接入力できます。');
 }catch(e){if(aiModelAbort===controller)setText('ai-model-status',`${e.message||'取得に失敗しました。'} モデルIDの直接入力もできます。`);}
 finally{if(aiModelAbort===controller){aiModelAbort=null;$('ai-load-models').disabled=false;}}
};
async function startSolo(){
 const name=$('quick-name').value.trim();if(!name)throw Error('なまえを入力してね。');
 const key=$('ai-key').value.trim(),model=$('ai-model').value==='__custom'?$('ai-custom-model').value.trim():$('ai-model').value;
 if(key&&!/^[a-zA-Z0-9._:-]{1,160}$/.test(model))throw Error('AIのモデルを選択するか、モデルIDを入力してね。');
 soloAI=key?{provider:$('ai-provider').value,key,model}:null;
 savedUser=user;savedDb=db;soloMode=true;user={uid:'solo-human'};db=createMemoryDatabase();serverOffset=0;
 const players={[user.uid]:{name,score:0}},online={};
 (soloAI?[AI_BOT]:CPU_IDS).forEach((uid,i)=>{players[uid]={name:soloAI?'あい AI':['もも','そら','まる'][i]+' CPU',score:0};online[uid]={local:true};});
 const roomCode='SOLO00';await set(ref(db,`rooms/${roomCode}`),{host:user.uid,phase:'lobby',gameId:randomId(20),players,online,createdAt:serverTimestamp(),lastOnline:serverTimestamp()});
 $('hint-seconds').value='10';enterRoom(roomCode);
}
$('solo-start').onclick=()=>action($('solo-start'),startSolo);
$('ai-start').onclick=()=>action($('ai-start'),async()=>{if(!$('ai-key').value.trim())throw Error('AI対戦にはAPIキーを入力してね。');await startSolo();});
document.querySelectorAll('[data-public-room]').forEach(button=>button.onclick=()=>action(button,async()=>{
 const name=$('quick-name').value.trim();if(!name)throw Error('なまえを入力してね。');await connect();const roomCode=button.dataset.publicRoom;await call('openPublicRoom',{name,code:roomCode});enterRoom(roomCode);void sweepKnownRooms();
}));
$('join').onclick=()=>action($('join'),async()=>{const name=$('join-name').value.trim(), roomCode=$('join-code').value.trim().toUpperCase();if(!name)throw Error('なまえを入力してね。');if(!/^[A-Z0-9]{6}$/.test(roomCode))throw Error('合言葉は半角英数字6文字で入力してね。');await connect();await call('joinRoom',{name,code:roomCode});enterRoom(roomCode);void sweepKnownRooms();});
$('leave').onclick=()=>action($('leave'),async()=>{
 const gm=room?.host===user?.uid,roomCode=code;
 if(gm&&!confirm('あなたはGMです。退出すると部屋が解散し、全員がホームに戻ります。退出しますか？'))return;
 if(!gm&&room?.phase!=='lobby'&&!confirm('部屋から退出しますか？ ほかの人が残っていれば、同じブラウザから再参加できます。'))return;
 leavingRoom=roomCode;
 try{await call('leaveRoom',{code:roomCode});}catch(e){if(!room||room.phase==='closing')goHome();throw e;}finally{leavingRoom='';}
 goHome();
});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);toast('合言葉をコピーしました！');}catch{toast('合言葉を選択してコピーしてね。');}};
$('start').onclick=()=>action($('start'),async()=>{await call('startGame',{code,rounds:1,timeLimit:selectedTimeLimit(),hintSeconds:Number($('hint-seconds').value),maxCorrect:Number($('max-correct').value),...Object.fromEntries(pointFields.map(([id,key])=>[key,Number($(id).value)]))});});
$('next').onclick=()=>action($('next'),async()=>{await call('nextTurn',{code});});
$('again').onclick=()=>action($('again'),async()=>{await call('oneMoreRound',{code});});
$('lobby-return').onclick=()=>action($('lobby-return'),async()=>{await call('forceEnd',{code});const dialog=$('settings-dialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');});
$('whistle').onclick=()=>action($('whistle'),async()=>{if(!confirm('このターンを終了して答えを発表しますか？'))return;await call('endTurn',{code,turn:room.turn,gameId:room.gameId,reason:'whistle'});closeGm();});
function closeGm(){const dialog=$('gm-dialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');}
$('gm-open').onclick=()=>{if(room?.host!==user?.uid||(claims[room.turn]?.ended?.reason==='pass'&&!resultReady(claims[room.turn],Date.now()+serverOffset)))return;const dialog=$('gm-dialog');if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');};
$('gm-close').onclick=closeGm;
$('finish-after-round').onclick=()=>action($('finish-after-round'),async()=>{const roomCode=code,gameId=room.gameId;const result=await transaction(`rooms/${roomCode}`,current=>{if(!current||current.gameId!==gameId||current.phase!=='playing'||current.host!==user.uid)return;current.finishAfterRound=!current.finishAfterRound;return current;});if(!result.committed)throw Error('ゲームの状態が変わりました。');closeGm();});
$('force-end').onclick=()=>action($('force-end'),async()=>{if(!confirm('試合を強制終了して設定に戻りますか？ 進行中のお題は破棄されますが、確定済みの得点と参加者は残ります。'))return;await call('forceEnd',{code});closeGm();});
$('pass-topic').onclick=()=>action($('pass-topic'),async()=>{if(!confirm('このお題をパスして、新しいお題にしますか？'))return;await call('passTopic',{code});});

// Correct guesses are stored as a marker, never as the secret itself. The
// answer is retrieved only after the server-timed reveal, even after rejoining.
function fetchChatWord(turn){
 const roomCode=code,gameId=room.gameId,key=`${roomCode}:${gameId}:${room?.matchId}:${turn}`;
 if(chatRevealedWords[key]||chatWordPending[key]||!resultReady(claims[turn],Date.now()+serverOffset))return;
 chatWordPending[key]=true;
 get(ref(db,`secrets/${roomCode}/${gameId}/${turn}`)).then(snapshot=>{
  const word=snapshot.val();if(code!==roomCode||room?.gameId!==gameId||typeof word!=='string')return;
  chatRevealedWords[key]=word;renderChat(chatMessages);
 }).catch(()=>{}).finally(()=>{delete chatWordPending[key];});
}
function renderChat(messages){
 const list=$('chat-messages'), wasAtBottom=list.scrollHeight-list.scrollTop-list.clientHeight<40;
 const entries=Object.entries(messages||{}).sort(([a],[b])=>a<b?-1:a>b?1:0);
 if(!entries.length){const empty=document.createElement('p');empty.className='chat-empty';empty.append('まだメッセージはありません。',document.createElement('br'),'最初のひとことを送ってみよう！');list.replaceChildren(empty);return;}
 list.replaceChildren(...entries.map(([,message])=>{
   const row=document.createElement('div');row.className='chat-message'+(message.uid===user?.uid?' mine':'')+(message.kind==='correct'?' is-correct':'');
   const meta=document.createElement('span');meta.className='chat-message-meta';
   const date=new Date(message.at);const time=Number.isFinite(date.getTime())?date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'';
   meta.textContent=`${message.name||'なまえなし'}${time?'　'+time:''}`;
   const text=document.createElement('span');text.className='chat-message-text';
   if(message.kind==='correct'&&Number.isInteger(message.turn)&&room){
    const key=`${code}:${room.gameId}:${room.matchId}:${message.turn}`;
    const messageClaim=claims[message.turn],messageNow=Date.now()+serverOffset;const revealed=messageClaim?.ended?.reason!=='skip'&&resultReady(messageClaim,messageNow)&&resultScene(messageClaim,messageNow)!=='end';
    const word=revealed?chatRevealedWords[key]:'';
    if(revealed&&!word)fetchChatWord(message.turn);
    text.textContent=word?`正解！ ${word}`:`正解！ ${'●'.repeat(room.lengths?.[message.turn]||3)}`;
   }else text.textContent=message.text||'';
   row.append(meta,text);return row;
 }));
 if(wasAtBottom||!list.dataset.loaded)list.scrollTop=list.scrollHeight;list.dataset.loaded='true';
}
function updateChatControls(){
 if(!room)return;
 const playing=room.phase==='playing',claim=claims[room.turn],now=Date.now()+serverOffset,countdown=countdownRemaining(room,now);
 const waiting=room.phase==='starting'||playing&&(countdown===null || countdown>0 || (claim?.ended&&(claim.ended.reason==='pass'||resultScene(claim,now)==='end')) || (!claim?.ended&&room.timeLimit>0&&remainingMs(turnStart(room),room.timeLimit,now)===0));
 const input=$('chat-input'),button=$('chat-form').querySelector('button[type=submit]');
 const wasDisabled=input.disabled;input.disabled=!!waiting;button.disabled=!!waiting||chatSending;
 // Desktop users can immediately type with an IME when a turn starts; do not
 // summon a software keyboard or steal focus from any existing control.
 if(wasDisabled&&!input.disabled&&playing&&document.body.classList.contains('screen-game')&&document.activeElement===document.body&&!document.querySelector('dialog[open]')&&window.matchMedia?.('(min-width: 701px) and (hover: hover) and (pointer: fine)').matches)input.focus({preventScroll:true});
 const answered=playing&&correctEntries(claim).some(entry=>entry.uid===user.uid),drawer=playing&&room.drawer===user.uid;
 input.placeholder=waiting?(claim?.ended?'結果発表を待ってね':'スタートを待ってね'):playing&&!claim?.ended&&!drawer?(answered?'正解済み・メッセージを入力':'答えはひらがなで入力'):'メッセージを入力';
 setText('chat-context',waiting?'まもなく再開':playing&&!claim?.ended?(drawer?'お題は送れません':answered?'正解済み・会話OK':'答えはひらがなで'):'メッセージを送れます');
}
// Typing anywhere on the play screen starts a chat message, without stealing
// shortcuts, form controls, dialog input, or the native IME composition.
document.addEventListener('keydown',e=>{
 const input=$('chat-input'),target=e.target;
 if(!room||!document.body.classList.contains('screen-game')||input.disabled||e.defaultPrevented||document.querySelector('dialog[open]'))return;
 if(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))return;
 if(e.metaKey||((e.ctrlKey||e.altKey)&&!e.getModifierState?.('AltGraph')))return;
 if(e.key===' '&&target?.closest?.('button,summary,a[href]'))return;
 const composition=e.isComposing||e.key==='Process'||e.key==='Dead'||e.keyCode===229;
 if(!composition&&Array.from(e.key).length!==1)return;
 input.focus({preventScroll:true});
 if(composition)return; // The browser/IME inserts its own composed text.
 e.preventDefault();
 const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
 if(input.value.length-(end-start)+e.key.length>input.maxLength)return;
 input.setRangeText(e.key,start,end,'end');
 input.dispatchEvent(new Event('input',{bubbles:true}));
});
$('chat-form').onsubmit=e=>{e.preventDefault();if(chatSending)return;chatSending=true;action(e.submitter || e.currentTarget.querySelector('button[type=submit]'),async()=>{
 const input=$('chat-input'),text=input.value.trim();if(!text)return;
 if(!room?.players?.[user.uid])throw Error('部屋に参加していません。');
 const roomCode=code,gameId=room.gameId,turn=room.turn,claim=claims[turn],now=Date.now()+serverOffset;
 const playing=room.phase==='playing'&&!claim?.ended;
 if(input.disabled || (room.phase==='playing'&&claim?.ended&&(claim.ended.reason==='pass'||resultScene(claim,now)==='end')))throw Error('発表まで待ってね。');
 let message={uid:user.uid,name:room.players[user.uid].name,text,at:serverTimestamp()};
 if(playing){
  if((countdownRemaining(room,now)??0)>0||turnExpired())throw Error('開始または結果発表まで待ってね。');
  // Fail closed against an older Firebase ruleset: without this per-turn
  // capability check, a denied answer verification could be mistaken for a
  // wrong guess and the raw correct answer could leak into an unguarded chat.
  const guardKey=`${roomCode}:${gameId}:${room?.matchId}:${turn}:${user.uid}`;
  if(chatGuardKey!==guardKey){
   try{await set(ref(db,`chatGuard/${roomCode}/${gameId}/${turn}/${user.uid}`),true);chatGuardKey=guardKey;}
   catch(e){if(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied'))throw Error('安全なチャットに必要なFirebaseルールを確認できません。');throw e;}
  }
  if(code!==roomCode||room?.gameId!==gameId||room.phase!=='playing'||room.turn!==turn||claims[turn]?.ended||turnExpired())throw Error('ターンが切り替わりました。もう一度送ってね。');
  const normalized=text.normalize('NFKC');
  if(room.drawer===user.uid){
   const key=`${roomCode}:${gameId}:${room?.matchId}:${turn}`;
   if(wordKey!==key||!drawerWord)throw Error('お題を確認中です。少し待ってね。');
   if(normalized===drawerWord)throw Error('描く人はお題をチャットに送れません。');
  }else if(/^[\u3041-\u3096ー]+$/.test(normalized)){
   const result=await call('submitAnswer',{code:roomCode,answer:normalized});
   if(result.verified){if(!result.correct)throw Error('ターンが終了しました。');message={...message,text:'●●●',kind:'correct',turn};toast('正解！発表まで答えは伏字になります。');}
   else if(result.ended)throw Error('ターンが終了しました。');
  }
 }
 // Do not publish a stale guess into a later turn during an asynchronous check.
 if(code!==roomCode||room?.gameId!==gameId||(playing&&(room.phase!=='playing'||room.turn!==turn)))throw Error('ターンが切り替わりました。もう一度送ってね。');
 await set(push(ref(db,`chats/${roomCode}/${gameId}`)),message);
 if(input.value.trim()===text)input.value='';$('chat-messages').scrollTop=$('chat-messages').scrollHeight;
}).finally(()=>{chatSending=false;updateChatControls();});};
function renderTiles(length,word,hint){
 const tiles=$('word-tiles'),chars=word?Array.from(word):hintCharacters(length,hint);
 const label=word?`お題 ${word}`:`お題 ${length}文字${hint?'、ヒント '+chars.map(c=>c||'空欄').join('、'):''}`;
 if(tiles.getAttribute('aria-label')===label&&tiles.childElementCount===length)return;
 tiles.setAttribute('aria-label',label);
 tiles.replaceChildren(...Array.from({length},(_,i)=>{const char=chars[i]||'',tile=document.createElement('span');tile.className='word-tile'+(!char?' empty':!word?' hint':'');tile.textContent=char||'？';tile.setAttribute('aria-hidden','true');return tile;}));
}
function updateGameSounds(){
 if(room.phase==='playing'){
  const key=`${code}:${room.gameId}:${room.matchId}:${room.turn}`,claim=claims[room.turn],first=!soundHadRoomState;
  if(soundTurnKey!==key)soundTurnKey=key;
  const count=correctEntries(claim).length;
  if(soundAnswerKey!==key){soundAnswerKey=key;soundAnswerCount=0;}
  if(count>soundAnswerCount&&!first&&!claim?.ended){playSound('correct');const latest=correctEntries(claim).at(-1),name=room.players?.[latest?.uid]?.name||'だれか';$('correct-notice-name').textContent=`${name}さん 正解！`;$('correct-notice-count').textContent=`${count} / ${room.maxCorrect}人が正解`;show('correct-notice',false);void $('correct-notice').offsetWidth;show('correct-notice',true);clearTimeout(correctNoticeTimer);correctNoticeTimer=setTimeout(()=>show('correct-notice',false),2400);}
  soundAnswerCount=count;
  if(claim?.ended&&soundResultKey!==key){show('correct-notice',false);clearTimeout(correctNoticeTimer);soundResultKey=key;if(!first&&claim.ended.reason!=='skip'&&!resultReady(claim,Date.now()+serverOffset)){if(claim.ended.reason==='pass')playSound('pass');else playWhistle();}}
 } else if(room.phase==='finished'&&Number.isFinite(room.finishedAt)){
  const key=`${code}:${room.gameId}:${room.matchId}:${room.finishedAt}`;
  if(soundFinalKey!==key){soundFinalKey=key;if(soundHadRoomState&&Date.now()+serverOffset-room.finishedAt<1200)playSound('correct');}
 }
 soundHadRoomState=true;
}

function restoreGameSettings(current){
 if(!current?.hasPlayed)return;

 const limit=current.timeLimit;
 if([0,30,60,90,120].includes(limit))$('time-limit').value=String(limit);
 else if(Number.isInteger(limit)){$('time-limit').value='custom';$('custom-time').value=String(limit);}
 for(const [id,value] of [['hint-seconds',current.hintSeconds],['max-correct',current.correctSetting],...pointFields.map(([id,key])=>[id,current[key]])])if(Number.isInteger(value))$(id).value=String(value);
}
function renderAnswerSlots(turnKey,count,max){
 const slots=$('answer-slots'),initial=answerSlotKey!==turnKey||slots.childElementCount!==max;
 if(initial){answerSlotKey=turnKey;slots.replaceChildren(document.createTextNode(''),...Array.from({length:max},()=>{const dot=document.createElement('span');dot.className='answer-slot';dot.setAttribute('aria-hidden','true');return dot;}));}
 const label=`正解 ${count} / ${max}人　`;if(slots.firstChild?.textContent!==label)slots.firstChild.textContent=label;
 [...slots.children].forEach((dot,i)=>{const filled=i<count;if(initial&&filled)dot.classList.add('no-pop');else if(!filled||!dot.classList.contains('filled'))dot.classList.remove('no-pop');dot.classList.toggle('filled',filled);});
}
function render(){
 if(!room||room.phase==='closing')return;
 if(room.phase==='lobby'&&lastRenderedPhase!=='lobby'&&room.hasPlayed)restoreGameSettings(room);
 const returningToLobby=(room.phase==='lobby'||room.phase==='starting')&&lastRenderedPhase&&lastRenderedPhase!=='lobby'&&lastRenderedPhase!=='starting';
 if(returningToLobby){
  if(unsubscribeDrawing)unsubscribeDrawing();unsubscribeDrawing=null;activeTurn=undefined;wordKey=undefined;drawerWord='';hintKey='';hintValue=null;hintPending='';timeoutWord='';timeoutWordKey='';revealKey='';countdownKey='';chatRevealedWords={};chatWordPending={};chatGuardKey='';soundTurnKey='';soundResultKey='';soundAnswerKey='';soundAnswerCount=0;soundHadRoomState=false;closeGm();
 }
 lastRenderedPhase=room.phase;
 const host=room.host===user.uid, lobby=room.phase==='lobby'||(room.phase==='starting'&&room.startOrigin!=='round'), finished=room.phase==='finished', claim=claims[room.turn], ended=room.phase==='playing'&&!!claim?.ended, revealed=ended&&resultReady(claim,Date.now()+serverOffset), playing=room.phase==='playing'&&!ended, drawer=room.drawer===user.uid, entries=correctEntries(claim);
 const passed=ended&&claim.ended.reason==='pass',skipped=ended&&claim.ended.reason==='skip',now=Date.now()+serverOffset,scene=ended&&!passed&&!skipped?resultScene(claim,now):null,sceneKey=`${code}:${room.gameId}:${room.matchId}:${room.turn}`;presentationKey=ended&&!passed&&!skipped?`${sceneKey}:${scene}`:'';const wordVisible=!lobby&&!finished&&!passed&&Number.isInteger(room.lengths?.[room.turn]);show('word-count',wordVisible);if(wordVisible)$('word-count').textContent=`${room.lengths[room.turn]}文字`;const currentHintKey=`${code}:${room.gameId}:${room.matchId}:${room.turn}`;show('hint-state',playing&&!drawer&&hintKey===currentHintKey);if(hintNoticeKey!==currentHintKey||!playing||drawer)show('hint-notice',false);const showEnd=ended&&!skipped&&(passed||scene==='end');show('round-end',showEnd);$('round-end').classList.toggle('is-pass',passed);$('round-end-title').textContent=passed?'パス！':'終了！';$('round-end-label').textContent=passed?'NEW TOPIC':'ROUND END';$('round-end-message').textContent=passed?'お題をチェンジ！':({full:'正解枠がすべて埋まりました！',time:'時間切れ！',skip:'出題者が離席しました',whistle:'GMがターンを終了しました'})[claim?.ended?.reason]||'おえかきストップ！';
 if(showEnd&&endSceneKey!==sceneKey){endSceneKey=sceneKey;$('round-end').style.setProperty('--scene-offset',`${-Math.max(0,now-claim.ended.at)}ms`);}if(!showEnd)endSceneKey='';
 const showAnswer=ended&&!passed&&!skipped&&scene==='answer';show('answer-scene',showAnswer);
 if(showAnswer){if(answerSceneKey!==sceneKey){answerSceneKey=sceneKey;$('answer-scene').style.setProperty('--scene-offset',`${-Math.max(0,now-claim.ended.at-END_SCENE_MS)}ms`);if(now-claim.ended.at-END_SCENE_MS<800&&claim.ended.reason!=='time')playSound('hint');}$('answer-scene-word').textContent=timeoutWordKey===sceneKey&&timeoutWord?timeoutWord:'確認中…';}else answerSceneKey='';
 const showFinal=finalSceneVisible(room,now);show('final-scene',showFinal);if(showFinal&&finalSceneKey!==`${sceneKey}:${room.finishedAt}`){finalSceneKey=`${sceneKey}:${room.finishedAt}`;$('final-scene').style.setProperty('--scene-offset',`${-Math.max(0,now-room.finishedAt)}ms`);}if(!showFinal)finalSceneKey='';document.body.classList.toggle('screen-lobby',lobby);document.body.classList.toggle('screen-game',!lobby);document.body.classList.toggle('is-drawing-turn',playing&&drawer);$('game').classList.toggle('is-ended',ended);$('game').classList.toggle('is-revealed',revealed);setMusicScene(lobby||finished?'room':'play');
 show('lobby',lobby);show('game',!lobby);show('players-panel',lobby);show('start',host&&room.phase==='lobby');show('settings-open',host&&room.phase==='lobby');$('settings-label').textContent=host?'⚙️ ルールをカスタマイズ':'⚙️ ルールはホストが設定します';show('start-hint',lobby&&(!host||room.phase==='starting'));$('start-hint').textContent=room.phase==='starting'?'ゲームを準備しています…':'ホストがゲームを開始するまで待ってね';$('time-limit').disabled=!host;updateHintSetting();updateGameSounds();
 $('room-title').textContent=lobby?'みんなの部屋':finished?'ゲーム終了！':'おえかきバトル！';
 $('room-subtitle').textContent=soloMode?(soloAI?'AIと1対1で対戦':'ひとりでCPUと対戦'):PUBLIC_ROOMS[code]?PUBLIC_ROOMS[code]:lobby?'友だちを招待しよう！':`合言葉 ${code}`;
 const scores=lobby?null:scoresForRoom(room,claims,Date.now()+serverOffset),finalRanks=finished?ranking(room,scores):[];
 const players=Object.entries(room.players||{}).map(([id,p])=>[id,{...p,score:lobby?(p.score||0):scores[id]}]); $('player-count').textContent=`${players.length}人`;
 const order=room.order||players.map(([id])=>id);players.sort((a,b)=>{const sequence=finished?finalRanks.map(item=>item.uid):order;const x=sequence.indexOf(a[0]),y=sequence.indexOf(b[0]);return (x<0?Infinity:x)-(y<0?Infinity:y)||a[0].localeCompare(b[0]);});
 $('players').replaceChildren(...players.map(([id,p],i)=>{const div=document.createElement('div');div.className='player';const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('div');name.className='player-name';name.textContent=p.name+(id===user.uid?'（あなた）':'');const meta=document.createElement('small');meta.textContent=!isOnline(room,id)?'離席中':id===room.host?'HOST':(!lobby&&id===room.drawer?'おえかき中':'');name.appendChild(meta);const score=document.createElement('b');score.textContent=lobby?(p.score?`${p.score} pt`:''):`${p.score||0} pt`;div.append(avatar,name,score);return div;}));
 $('game-players').dataset.heading=finished?'最終順位':'さんかメンバー';$('game-players').setAttribute('aria-label',finished?'最終順位と得点':'参加メンバーと得点');$('game-players').replaceChildren(...players.map(([id,p],i)=>{const isDrawing=room.phase==='playing'&&id===room.drawer,hasAnswered=room.phase==='playing'&&entries.some(entry=>entry.uid===id);const chip=document.createElement('div');chip.className='game-player'+(isDrawing?' is-drawer':'')+(hasAnswered?' has-answered':'')+(!isOnline(room,id)?' is-offline':'');chip.setAttribute('aria-label',`${p.name}、${isDrawing?'おえかき中、':''}${hasAnswered?'正解済み、':''}${p.score||0}ポイント${!isOnline(room,id)?'、離席中':''}`);const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('span');name.className='game-player-name';name.textContent=(finished?`${finalRanks.find(item=>item.uid===id)?.rank}位 `:'')+p.name+(id===user.uid?'（自分）':'')+(!isOnline(room,id)?'（離席中）':'');name.title=name.textContent;const score=document.createElement('span');score.className='game-player-score';score.textContent=`${p.score||0} pt`;chip.append(avatar,name,score);if(hasAnswered){const mark=document.createElement('span');mark.className='player-answered-mark';mark.textContent='✓';mark.setAttribute('aria-hidden','true');chip.append(mark);}if(isDrawing){const role=document.createElement('span');role.className='game-player-role';role.textContent=id===user.uid?'✎ あなたが描く番':`✎ ${p.name}がおえかき中`;chip.append(role);}return chip;}));
 updateChatControls();renderChat(chatMessages);
 if(lobby){show('scoreboard',false);show('correct-notice',false);clearTimeout(correctNoticeTimer);stopScoreboardAnimation();scoreboardKey='';return;}
  $('turn-label').textContent=finished?'GAME COMPLETE':`${(room.extraRounds||0)+1}周目`; $('turn-label').dataset.compact=finished?'終了':`${(room.extraRounds||0)+1}周目`;
 $('turn-badge').textContent=finished?'🏆':drawer?'🎨':'💡';
 show('answer-slots',!finished);show('final-controls',finished);show('final-host-actions',finished&&host);show('final-wait',finished&&!host);
 show('tools',playing&&drawer);show('gm-open',host&&!lobby);show('whistle',playing&&host);show('finish-after-round',host&&room.phase==='playing');$('finish-after-round').textContent=room.finishAfterRound?'周の終了後に終了を取り消す':'この周でゲーム終了';$('finish-after-round-note').textContent=room.finishAfterRound?'この周が終わると最終ランキングを発表します。':'この周が終わったら最終ランキングを発表します。';$('pass-topic').disabled=!playing||!drawer||entries.length>0||turnExpired()||!drawerWord;show('result',!playing&&!skipped);show('next',false);
 renderAnswerSlots(sceneKey,entries.length,room.maxCorrect||0);
 const viewing=playing&&!drawer,answered=entries.some(entry=>entry.uid===user.uid),guide=finished||(ended&&!skipped)||viewing;
 show('compact-role',playing);$('compact-role').classList.toggle('is-drawing',playing&&drawer);$('compact-role').classList.toggle('is-answered',viewing&&answered);setText('compact-role',drawer?'✎ あなたが描く':answered?'✓ 正解済み':'💡 答える番');show('turn-role',playing);$('turn-role').classList.toggle('is-drawing',playing&&drawer);$('turn-role').classList.toggle('is-answering',viewing);$('turn-role').classList.toggle('is-answered',viewing&&answered);$('game-stage').classList.toggle('is-my-turn',playing&&drawer);setText('turn-role-icon',drawer?'✎':answered?'✓':'💡');setText('turn-role-title',drawer?'あなたが描く番！':answered?'正解！待機中':'あなたは答える番');setText('turn-role-detail',drawer?'お題を絵で伝えよう':answered?'みんなの回答を待とう':'絵を見てひらがなで答えよう');
 show('turn-guide',guide);
 $('turn-guide').classList.toggle('is-finished',finished);$('turn-guide').classList.toggle('is-answered',viewing&&answered);
 $('guide-kicker').textContent=finished?'NEXT STEP':ended?'ROUND RESULT':'YOUR ROLE';
 $('guide-title').textContent=finished?'次はどうする？':ended?'答えを確認しよう':answered?'正解！':'絵を見て答えよう';
 $('guide-description').textContent=finished?'最終ランキングを確認しよう':ended?'答えを確認しよう！':answered?'ほかの人の回答を待とう。':'わかったら、チャットにひらがなで答えてね。';
 $('guide-note').textContent=finished?(host?'ロビー：ルールを変更して再開':'そのまま待ってね'):ended?'まもなく次のターンへ進みます':answered?'メッセージで会話もできます':'正解は発表まで伏字になります';

 canvas.setAttribute('aria-label',drawer&&playing?'お絵かきキャンバス：あなたが描く番です':'お絵かきキャンバス：描かれた絵');setText('canvas-placeholder',drawer&&playing?'ここに絵を描こう！ ✎':'ここに絵が描かれるよ ✎');
 show('final-ranking',finished);if(finished){$('final-ranking-list').replaceChildren(...finalRanks.map(item=>{const row=document.createElement('li'),name=document.createElement('span'),score=document.createElement('strong');name.textContent=`${item.rank}位　${room.players[item.uid]?.name||'だれか'}`;score.textContent=`${item.score} pt`;row.append(name,score);return row;}));const max=Math.max(...players.map(([,p])=>p.score||0));const winners=players.filter(([,p])=>(p.score||0)===max).map(([,p])=>p.name).join('、');$('prompt').textContent='おつかれさま！';$('word-tiles').replaceChildren();$('game-hint').textContent='すべてのターンが終わりました。';$('result').textContent=`🏆 ${winners}　${max}ポイント！`;$('final-winners').textContent=winners;$('final-points').textContent=`${max} pt`;}
 else if(skipped){$('prompt').textContent='次のターンへ';$('game-hint').textContent='準備しています…';$('result').textContent='';$('word-tiles').replaceChildren();}
 else if(passed){$('prompt').textContent='パス！';$('game-hint').textContent='新しいお題を準備しています…';$('result').textContent='新しいお題にチェンジ！';$('word-tiles').replaceChildren();}
 else if(ended){
   const key=`${code}:${room.gameId}:${room.matchId}:${room.turn}`;const reason=claim.ended.reason;
   $('prompt').textContent=revealed&&scene!=='end'?'答え発表！':'終了！';
   $('game-hint').textContent=revealed&&scene!=='end'?'まもなく次のターンへ進みます。':'答えを発表します…';
   if(!revealed||scene==='end'){renderTiles(room.lengths[room.turn],'');$('result').textContent=reason==='time'?'⌛ 時間切れ！':reason==='skip'?'出題者が離席したため終了！':'終了！';}
   else {
    if(timeoutWordKey!==key&&Date.now()>=revealRetryAt){timeoutWordKey=key;timeoutWord='';call('getWord',{code}).then(data=>{if(room?.turn===data.turn&&timeoutWordKey===key&&claims[room.turn]?.ended){timeoutWord=data.word;render();}}).catch(e=>{if(timeoutWordKey===key){timeoutWordKey='';revealRetryAt=Date.now()+1000;}console.error(e);});}
    renderTiles(room.lengths[room.turn],timeoutWord);
    const gains=scoreDeltas(room,room.turn,claim);const awards=Object.entries(gains).filter(([,points])=>points>0).map(([uid,points])=>`${room.players[uid]?.name||'だれか'} +${points}点`).join('、');
    $('result').textContent=timeoutWord?`答えは「${timeoutWord}」！ ${awards||(entries.length?'正解者がいました！':'正解者はいませんでした。')}`:'答えを確認中…';
   }
 }
 else {const drawerName=room.players[room.drawer]?.name||'だれか';$('prompt').textContent=drawer?'お題':'お題は？'; $('game-hint').textContent=drawer?'あなたの番！お題の絵を描こう。':`${drawerName} さんがおえかき中！答えはチャットにひらがなで入力してね。`;
 const length=room.lengths[room.turn],key=`${code}:${room.gameId}:${room.matchId}:${room.turn}`;
 if(!drawer&&room.timeLimit&&room.hintSeconds)$('game-hint').textContent+=hintKey===key?' 💡 文字ヒント公開！':` 残り${room.hintSeconds}秒で文字ヒント！`;
 if(!drawer&&Array.isArray(room.schedule)&&!room.schedule.includes(user.uid))$('game-hint').textContent+=' 途中参加！描く順番は後ろに追加されます。';
 if(drawer){if(wordKey!==key){wordKey=key;drawerWord='';call('getWord',{code}).then(data=>{if(room?.phase==='playing'&&!claims[room.turn]?.ended&&room.turn===data.turn&&room.drawer===user.uid&&wordKey===key){drawerWord=data.word;renderTiles(length,drawerWord);updateDrawingControls();}}).catch(e=>{if(wordKey===key)wordKey=undefined;toast(friendly(e));});}renderTiles(length,drawerWord);}
 else renderTiles(length,'',hintKey===key?hintValue:null);
 }
 if(activeTurn!==room.turn){
   activeTurn=room.turn;if(unsubscribeDrawing)unsubscribeDrawing();strokes=[];drawingKeys=[];drawing=false;points=[];clearInterval(strokeTimer);ctx.clearRect(0,0,canvas.width,canvas.height);show('canvas-placeholder',true);
   const drawingPath=`drawings/${code}/${room.gameId}/${room.turn}`;
   unsubscribeDrawing=onValue(ref(db,drawingPath),snap=>{
     const events=snap.val()||{},keys=Object.keys(events).sort();
     if(drawingKeys.some((key,i)=>keys[i]!==key)){strokes=reduceDrawingEvents(keys.map(key=>events[key]));drawingKeys=keys;redraw();return;}
     let needsRedraw=false;
     for(const key of keys.slice(drawingKeys.length)){const event=events[key];applyDrawingEvent(strokes,event);if(event?.action)needsRedraw=true;else if(event?.points)try{paint(event);}catch(e){console.error(e);}}
     drawingKeys=keys;if(needsRedraw)redraw();else{show('canvas-placeholder',!strokes.length&&!drawing);updateDrawingControls();}
   },e=>toast(friendly(e)));
 }
 renderScoreboard(claim,false);
 updateDrawingControls();updateTimer();
}

// Animate from the previous ranking to the new one. The revealed claim, not
// local UI state, is the source of truth on every client and after reconnect.
// Drive the counter from the shared end timestamp, never from local animation
// start. This keeps reconnects, tab suspensions and joins in the same moment.
function stopScoreboardAnimation(){
 if(scoreboardFrame!==null){cancelAnimationFrame(scoreboardFrame);scoreboardFrame=null;}
 scoreboardAnimation=null;
}
function animateScoreboard(){
 const state=scoreboardAnimation;
 if(!state||!room||$('scoreboard').classList.contains('hidden')){stopScoreboardAnimation();return;}
 const age=Math.max(0,Date.now()+serverOffset-state.startedAt), reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
 const stage=scoreStage(age),board=$('scoreboard');
 if(state.stage!==stage){
  state.stage=stage;board.dataset.stage=stage;
  $('scoreboard-phase').textContent=({ready:'ポイントを集計中…',bonus:'今回の獲得ポイント！',count:'合計ポイントに加算！',move:'順位が変わる…！',settled:'現在の順位はこちら！'})[stage];
  for(const step of board.querySelectorAll('[data-step]')){
   const order=['bonus','count','move'],current=stage==='settled'?'move':stage;
   step.classList.toggle('is-active',step.dataset.step===current);
   step.classList.toggle('is-done',order.indexOf(step.dataset.step)<order.indexOf(current));
  }
 }
 for(const entry of state.entries){
  const value=animatedScore(entry.before,entry.after,age,reduced);
  if(entry.lastValue!==value){entry.number.textContent=value.toLocaleString('ja-JP');entry.lastValue=value;}
  entry.row.classList.toggle('is-leader',reduced||age>=SCORE_SETTLED_MS?entry.rank===1:entry.previousRank===1);
 }
 // Only play transitions actually witnessed. Reconnects/background tabs never
 // replay missed sounds, and both sounds respect the existing mute control.
 if(state.lastAge!==null&&!document.hidden&&age-state.lastAge<500){
  if(state.hasGain&&state.lastAge<SCORE_BONUS_MS&&age>=SCORE_BONUS_MS)playSound('correct');
  if(state.hasMove&&state.lastAge<SCORE_MOVE_MS&&age>=SCORE_MOVE_MS)playSound('go');
 }
 state.lastAge=age;
 if(age<SCORE_SCENE_MS)scoreboardFrame=requestAnimationFrame(animateScoreboard);
 else scoreboardFrame=null;
}
function renderScoreboard(claim, visible){
 const now=Date.now()+serverOffset, key=`${code}:${room.gameId}:${room.matchId}:${room.turn}`;
 show('scoreboard',visible);
 if(!visible){stopScoreboardAnimation();scoreboardKey='';return;}
 const word=timeoutWordKey===key?timeoutWord:'';
 $('scoreboard-answer').textContent=word?`答えは「${word}」！`:'答えを確認中…';
 const before=scoresForRoom(room,claims,now,room.turn), after=scoresForRoom(room,claims,now), oldOrder=ranking(room,before), newOrder=ranking(room,after), gains=scoreDeltas(room,room.turn,claim);
 // A late join changes the rows. Rebuild at the current time without replaying
 // the show; rank and totals always come from the actual score calculation.
 const signature=JSON.stringify([key,claim.ended.at,newOrder.map(x=>[x.uid,x.rank,x.score,before[x.uid],gains[x.uid]||0,room.players[x.uid]?.name]),oldOrder.map(x=>[x.uid,x.rank])]);
 if(scoreboardKey===signature)return;
 const wasAnimating=!!scoreboardAnimation;stopScoreboardAnimation();scoreboardKey=signature;
 const start=claim.ended.at+END_SCENE_MS+ANSWER_SCENE_MS;
 if(!wasAnimating)$('scoreboard').style.setProperty('--scene-offset',`${-Math.max(0,now-start)}ms`);
 const entries=[];
 const nodes=newOrder.map((item,index)=>{
  const oldIndex=oldOrder.findIndex(x=>x.uid===item.uid),previousRank=oldOrder[oldIndex]?.rank,oldScore=before[item.uid]||0,delta=gains[item.uid]||0;
  const row=document.createElement('div');row.className='scoreboard-row'+(delta?' has-gain':' no-gain')+(oldIndex!==index?' has-move':'')+(oldIndex>index?' moves-up':'');row.style.setProperty('--move',oldIndex-index);row.style.setProperty('--scene-offset',`${-Math.max(0,now-start)}ms`);
  const playerName=room.players[item.uid]?.name||'だれか';row.setAttribute('aria-label',`${playerName}、${oldScore}点から${item.score}点、${item.rank}位`);
  const rank=document.createElement('b');rank.className='scoreboard-rank';rank.setAttribute('aria-hidden','true');const oldRank=document.createElement('span');oldRank.className='rank-before';oldRank.textContent=`${previousRank}位`;const newRank=document.createElement('span');newRank.className='rank-after';newRank.textContent=`${item.rank}位`;rank.append(oldRank,newRank);
  const name=document.createElement('span');name.className='scoreboard-name';name.textContent=playerName;name.title=playerName;
  const change=document.createElement('span');change.className='rank-change '+(previousRank>item.rank?'rank-up':previousRank<item.rank?'rank-down':'rank-same');change.textContent=previousRank>item.rank?`▲${previousRank-item.rank}`:previousRank<item.rank?`▼${item.rank-previousRank}`:'−';change.setAttribute('aria-hidden','true');
  const gain=document.createElement('span');gain.className='scoreboard-gain';gain.textContent=delta?`${delta>0?'+':''}${delta}`:'±0';gain.setAttribute('aria-hidden','true');
  const points=document.createElement('span');points.className='scoreboard-points';points.setAttribute('aria-hidden','true');const number=document.createElement('strong');number.className='scoreboard-number';points.append(number,document.createTextNode(' pt'));
  row.append(rank,name,change,gain,points);entries.push({row,number,before:oldScore,after:item.score,rank:item.rank,previousRank,lastValue:null});return row;
 });
 $('scoreboard-list').replaceChildren(...nodes);
 scoreboardAnimation={startedAt:start,entries,lastAge:null,stage:'',hasGain:entries.some(e=>e.before!==e.after),hasMove:entries.some(e=>e.rank!==e.previousRank)};
 animateScoreboard();
}
function updateScoreGauge(start,duration,left){
 if(room.scoreMode!=='thirds'){show('score-gauge',false);return;}
 const elapsed=Math.max(0,Math.min(duration*1000,duration*1000-left)),band=timeBand(start,duration,start+elapsed);
 const track=$('score-gauge').querySelector('.gauge-track');
 track.style.setProperty('--elapsed',`${elapsed/(duration*1000)*100}%`);
 track.setAttribute('aria-valuenow',String(Math.round(elapsed/(duration*1000)*100)));
 for(const [i,node] of [...track.querySelectorAll('.gauge-band')].entries()){
  const sample={startedAt:0,duration:3,at:i*1000};
  const answer=awardForClaim(sample,room),drawer=awardForClaim(sample,room,'drawer');
  node.textContent=`${answer} / ${drawer}点`;node.classList.toggle('is-current',i===band);
  if(i===band)track.setAttribute('aria-valuetext',`残り${Math.ceil(left/1000)}秒、答える人${answer}点、描く人${drawer}点`);
 }
 show('score-gauge',true);
}
function updateTimer(){
 if(room)updateChatControls();
 if(!room||room.phase!=='playing'){show('timer',false);show('score-gauge',false);show('countdown',false);if(room?.phase==='finished'&&!$('final-scene').classList.contains('hidden')&&!finalSceneVisible(room,Date.now()+serverOffset))render();return;}
 const now=Date.now()+serverOffset,turn=room.turn,roomCode=code,gameId=room.gameId,key=`${roomCode}:${gameId}:${room?.matchId}:${turn}`,claim=claims[turn],remaining=countdownRemaining(room,now);
 if(!claim?.ended&&remaining!==null&&remaining>0){
  const value=Math.ceil(remaining/1000),drawerName=room.players?.[room.drawer]?.name||'だれか';
  setText('countdown-role',room.drawer===user.uid?'あなたが描く番！':`${drawerName}さんが描くよ。ひらがなで答えよう！`);
  if(countdownKey!==key||countdownValue!==value){countdownKey=key;countdownValue=value;$('countdown-number').textContent=value;$('countdown-number').classList.remove('pulse');void $('countdown-number').offsetWidth;$('countdown-number').classList.add('pulse');playSound('tick');}
  show('countdown',true);
  $('countdown').classList.remove('is-go');
 }else{
  const start=turnStart(room),go=!claim?.ended&&Number.isFinite(start)&&now>=start&&now<start+GO_SCENE_MS;
  if(go&&countdownValue!==0){countdownValue=0;$('countdown-number').textContent='スタート！';$('countdown').style.setProperty('--go-offset',`${-Math.max(0,now-start)}ms`);$('countdown').classList.add('is-go');playSound('go');}
  if(go&&countdownKey!==key){countdownKey=key;countdownValue=0;$('countdown-number').textContent='スタート！';$('countdown').style.setProperty('--go-offset',`${-Math.max(0,now-start)}ms`);$('countdown').classList.add('is-go');}
  show('countdown',go);
 }
 if(claim?.ended&&claim.ended.reason!=='pass'&&claim.ended.reason!=='skip'&&presentationKey!==`${key}:${resultScene(claim,now)}`){render();return;}
 if(claim?.ended&&claim.ended.reason!=='pass'&&claim.ended.reason!=='skip'&&resultScene(claim,now)!=='end'&&resultReady(claim,now)&&(revealKey!==key||(!timeoutWord&&Date.now()>=revealRetryAt&&timeoutWordKey!==key))){if(revealKey!==key&&claim.ended.reason==='time')playSound('timeout');revealKey=key;render();return;}
 updateDrawingControls();
 if(!room.timeLimit){show('timer',false);show('score-gauge',false);return;}
 const start=turnStart(room),left=remainingMs(start,room.timeLimit,now);
 if(left===null){show('timer',false);show('score-gauge',false);return;}
 const frozen=claim?.ended?.at&&claim.ended.reason!=='pass'?remainingMs(start,room.timeLimit,claim.ended.at):left;
 const seconds=Math.ceil(Math.min(room.timeLimit*1000,frozen)/1000);$('timer').textContent=`${seconds}秒`;$('timer').classList.toggle('low',seconds<=10);show('timer',true);
 updateScoreGauge(start,room.timeLimit,frozen);
 if(!claim?.ended&&remaining===0&&left>0&&room.hintSeconds>0&&left<=room.hintSeconds*1000&&room.drawer!==user.uid)fetchHint();
 if(claim?.ended||remaining>0||left>0||timeoutPending===key)return;
 timeoutPending=key;
 call('endTurn',{code:roomCode,turn,gameId,reason:'time'}).catch(e=>{if(!(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied')))toast(friendly(e));}).finally(()=>{if(timeoutPending===key)setTimeout(()=>{if(timeoutPending===key)timeoutPending='';},1000);});
}
// Advance automatically once the answer has had time to be shown.
function maybeAdvanceResult(){
 if(!room||room.host!==user?.uid||room.phase!=='playing')return;
 const claim=claims[room.turn],now=Date.now()+serverOffset;
 if(!claim?.ended||['pass','skip'].includes(claim.ended.reason)||now<claim.ended.at+RESULT_SCENE_MS)return;
 const key=`${code}:${room.gameId}:${room.matchId}:${room.turn}`;
 if(timeoutWordKey!==key||!timeoutWord||advancePending===key||Date.now()<advanceRetryAt)return;
 advancePending=key;call('nextTurn',{code}).catch(e=>console.error('次のターンを再試行します',e)).finally(()=>{if(advancePending===key)advancePending='';advanceRetryAt=Date.now()+1000;});
}
function maybeContinueRound(){
 if(!room||room.host!==user?.uid||room.phase!=='starting'||room.startOrigin!=='round'||roundPending||Date.now()<roundRetryAt)return;
 const key=`${code}:${room.gameId}:${room.matchId}`;roundPending=key;
 call('continueRound',{code}).catch(e=>console.error('次の周の準備を再試行します',e)).finally(()=>{if(roundPending===key)roundPending='';roundRetryAt=Date.now()+1000;});
}
// The persisted pass candidate lets a newly elected GM resume the turn.
function maybeAdvancePass(){
 if(!room||room.phase!=='playing'||room.host!==user?.uid)return;
 const turn=room.turn,claim=claims[turn],now=Date.now()+serverOffset;
 if(claim?.ended?.reason!=='pass'||!resultReady(claim,now)||passAdvancePending||Date.now()<passRetryAt)return;
 const roomCode=code,gameId=room.gameId,next=room.nextTurnIndex,key=`${roomCode}:${gameId}:${room?.matchId}:${turn}`;
 if(!Number.isInteger(next))return;
 passAdvancePending=key;
 (async()=>{
  const word=(await get(ref(db,`passCandidates/${roomCode}/${gameId}/${turn}`))).val();
  if(typeof word!=='string')throw Error('新しいお題を準備できませんでした。');
  await set(ref(db,`secrets/${roomCode}/${gameId}/${next}`),word);
  if(room?.hintSeconds)await set(ref(db,`hints/${roomCode}/${gameId}/${next}`),createHint(word,shuffle));
  await transaction(`rooms/${roomCode}`,current=>{
    if(!current||current.host!==user.uid||current.phase!=='playing'||current.gameId!==gameId||current.turn!==turn||current.nextTurnIndex!==next)return;
    current.lengths[next]=Array.from(word).length;current.turn=next;current.nextTurnIndex=next+1;current.turnIds={...(current.turnIds||{}),[current.scheduleIndex??turn]:next};return current;
  });
 })().catch(e=>{console.error('パス後のお題を再試行します',e);}).finally(()=>{if(passAdvancePending===key)passAdvancePending='';passRetryAt=Date.now()+1000;});
}

// In AI mode the only opponent is the AI. It receives a canvas image, never the answer.
function setAiStatus(message){setText('ai-game-status',message);show('ai-game-status',!!message);}
function aiError(error){return error?.name==='AbortError'?'通信がタイムアウトしました。':error instanceof TypeError?'サイトのAI中継に接続できませんでした。':error?.message||'通信に失敗しました。';}
function soloTurnIsCurrent(key){return soloMode&&!!room&&room.phase==='playing'&&botTurnKey===key&&!claims[room.turn]?.ended;}
function aiCanvasImage(){
 const snapshot=document.createElement('canvas');snapshot.width=384;snapshot.height=384;const context=snapshot.getContext('2d');
 context.fillStyle='#fff';context.fillRect(0,0,384,384);context.drawImage(canvas,0,0,384,384);return snapshot.toDataURL('image/png');
}
async function recordBotCorrect(bot,key,roomCode,gameId,turn,start,duration,limit,currentDb){
 if(!soloTurnIsCurrent(key)||db!==currentDb||turnExpired())return;
 const result=await transaction(`claims/${roomCode}/${gameId}/${turn}`,current=>{
  if(!soloTurnIsCurrent(key)||db!==currentDb||turnExpired())return;
  current=current||{};if(current.ended||correctEntries(current).some(entry=>entry.uid===bot.uid))return;
  const slot=nextSlot(current,limit);if(!slot)return;
  current.slots={...(current.slots||{}),[slot]:{uid:bot.uid,at:serverTimestamp(),startedAt:start,duration}};
  if(correctEntries(current).length===limit)current.ended={reason:'full',at:serverTimestamp()};return current;
 });
 if(!result.committed||!soloMode||db!==currentDb||botTurnKey!==key)return;
 await set(push(ref(currentDb,`chats/${roomCode}/${gameId}`)),{uid:bot.uid,name:room.players[bot.uid]?.name||'CPU',text:'●●●',kind:'correct',turn,at:serverTimestamp()});
}
async function aiGuess(bot,key,roomCode,gameId,turn,start,duration,limit,currentDb){
 bot.busy=true;bot.attempts++;const controller=new AbortController();aiAbort=controller;
 try{
  const length=room.lengths[turn],image=aiCanvasImage();
  const result=await aiRequest(soloAI,'guess',{length,image},controller.signal);
  if(!soloTurnIsCurrent(key)||db!==currentDb||turnExpired())return;
  setAiStatus('AIが回答しました。');
  const guess=parseAiGuess(result.text,length);
  if(guess){
   const answer=(await get(ref(currentDb,`secrets/${roomCode}/${gameId}/${turn}`))).val();
   if(!soloTurnIsCurrent(key)||db!==currentDb||turnExpired())return;
   if(guess===answer){bot.done=true;await recordBotCorrect(bot,key,roomCode,gameId,turn,start,duration,limit,currentDb);return;}
   if(guess!==bot.lastGuess){bot.lastGuess=guess;await set(push(ref(currentDb,`chats/${roomCode}/${gameId}`)),{uid:bot.uid,name:room.players[bot.uid]?.name||'AI',text:guess,at:serverTimestamp()});}
  }
  if(bot.attempts>=2)bot.done=true;else bot.at=Date.now()+serverOffset-start+7000;
 }catch(e){
  if(soloTurnIsCurrent(key)&&db===currentDb&&!turnExpired()&&!controller.signal.aborted){bot.done=true;setAiStatus(`AIの回答に失敗しました：${aiError(e)}（CPUの代行はありません）`);}
 }finally{bot.busy=false;if(aiAbort===controller)aiAbort=null;}
}
function maybeRunSoloBots(){
 if(!soloMode||!room||room.phase!=='playing'){if(aiAbort)aiAbort.abort();aiAbort=null;setAiStatus('');return;}
 const {turn,gameId}=room,roomCode=code,key=`${roomCode}:${gameId}:${room.matchId}:${turn}`,now=Date.now()+serverOffset,start=turnStart(room),claim=claims[turn];
 if(botTurnKey!==key){
  if(aiAbort)aiAbort.abort();aiAbort=null;aiDraw=null;botTurnKey=key;botWord='';botDrawn=0;botLoading=false;botWriting=false;setAiStatus('');
  botPlan=(soloAI?[AI_BOT]:CPU_IDS).filter(uid=>uid!==room.drawer).map((uid,i)=>({uid,at:(room.timeLimit?room.timeLimit*1000:40000)*(.22+i*.20+randomInt(10)/100),done:false,busy:false,attempts:0}));
 }
 if(claim?.ended||!Number.isFinite(start)||room.timeLimit&&now>=start+room.timeLimit*1000){if(aiAbort)aiAbort.abort();aiAbort=null;if(claim?.ended){if(claim.ended.reason==='time'&&aiDraw?.pending)setAiStatus('AIの絵を待っている間に時間切れになりました。制限時間を長くしてお試しください。');else setAiStatus('');}return;}
 // Begin fetching the AI line drawing during the countdown to reduce latency.
 if(CPU_IDS.includes(room.drawer)&&!botWord&&!botLoading){botLoading=true;get(ref(db,`secrets/${roomCode}/${gameId}/${turn}`)).then(snap=>{if(soloTurnIsCurrent(key))botWord=snap.val()||'';}).finally(()=>{if(botTurnKey===key)botLoading=false;});}
 if(room.drawer===AI_BOT&&soloAI&&botWord&&!aiDraw){
  const controller=new AbortController(),state={pending:true,drawing:null,controller};aiDraw=state;aiAbort=controller;setAiStatus('AIに絵の生成を依頼しています…');
  aiRequest(soloAI,'draw',{word:botWord},controller.signal).then(result=>{
   if(!soloTurnIsCurrent(key)||aiDraw!==state||!state.pending||controller.signal.aborted)return;
   const drawing=parseAiDrawing(result.text);if(!drawing)throw Error('描画データの形式が不正でした。');state.drawing=drawing;state.pending=false;setAiStatus('選択したAIが生成した絵です。');
  }).catch(e=>{if(soloTurnIsCurrent(key)&&aiDraw===state&&!controller.signal.aborted){state.pending=false;setAiStatus(`AIの描画に失敗しました：${aiError(e)} CPUの絵は使いません。GMからターンを終了できます。`);}}).finally(()=>{if(aiAbort===controller)aiAbort=null;});
 }
 if(now<start)return;
 const elapsed=now-start;
 if(CPU_IDS.includes(room.drawer)){
  const drawing=soloAI?aiDraw?.drawing:soloDrawings[botWord];
  if(drawing&&!botWriting&&botDrawn<drawing.length){
   const step=Math.min(600,Math.max(180,(room.timeLimit||40)*650/drawing.length));
   if(elapsed>=botDrawn*step){const stroke=drawing[botDrawn++];botWriting=true;const target=ref(db,`drawings/${roomCode}/${gameId}/${turn}`);set(push(target),{color:stroke.color,width:stroke.width,points:JSON.stringify(stroke.points)}).catch(console.error).finally(()=>{if(botTurnKey===key)botWriting=false;});}
  }
 }
 for(const bot of botPlan){
  if(bot.done||bot.busy||elapsed<bot.at)continue;
  const currentDb=db,duration=room.timeLimit,limit=room.maxCorrect;
  if(soloAI&&bot.uid===AI_BOT){
   if(!strokes.length)continue;
   setAiStatus('AIが絵を見て回答を考えています…');void aiGuess(bot,key,roomCode,gameId,turn,start,duration,limit,currentDb);continue;
  }
  bot.done=true;void recordBotCorrect(bot,key,roomCode,gameId,turn,start,duration,limit,currentDb).catch(console.error);
 }
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
 if(!room||room.host!==user?.uid||room.phase!=='playing')return;
 const {turn,gameId}=room,roomCode=code,key=`${roomCode}:${gameId}:${room?.matchId}:${turn}`,claim=claims[turn];
 if(claim?.ended&&claim.ended.reason!=='skip')return;
 if(!claim?.ended&&!canSkipAbsentDrawer(room,Date.now()+serverOffset))return;
 if(skipPending===key||Date.now()<skipRetryAt)return;
 skipPending=key;
 // The claim transaction wins or loses against any last-moment correct answer.
 // A later host can resume from the persisted skip if this tab disconnects.
 (async()=>{
  if(!claim?.ended)await call('endTurn',{code:roomCode,turn,gameId,reason:'skip'});
  if(code!==roomCode||room?.gameId!==gameId||room?.turn!==turn||room?.host!==user?.uid)return;
  const saved=(await get(ref(db,`claims/${roomCode}/${gameId}/${turn}`))).val();
  if(saved?.ended?.reason!=='skip')return;
  claims[turn]=saved;await call('nextTurn',{code:roomCode});
 })().catch(e=>{skipRetryAt=Date.now()+1000;if(!(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied')))console.error(e);}).finally(()=>{if(skipPending===key)skipPending='';});
}
function fetchHint(){
 const roomCode=code,gameId=room.gameId,turn=room.turn,key=`${roomCode}:${gameId}:${room?.matchId}:${turn}`;
 if(hintKey===key||hintPending===key||Date.now()<hintRetryAt)return;
 hintPending=key;
 get(ref(db,`hints/${roomCode}/${gameId}/${turn}`)).then(snapshot=>{
  if(code!==roomCode||!room||room.gameId!==gameId||room.turn!==turn||room.phase!=='playing'||claims[turn]?.ended||room.drawer===user.uid)return;
  const value=snapshot.val();if(!value){hintRetryAt=Date.now()+3000;return;}
  hintKey=key;hintValue=value;hintNoticeKey=key;clearTimeout(hintNoticeTimer);show('hint-notice',true);hintNoticeTimer=setTimeout(()=>{if(hintNoticeKey===key)show('hint-notice',false);},3000);playSound('hint');render();
 }).catch(()=>{hintRetryAt=Date.now()+1000;}).finally(()=>{if(hintPending===key)hintPending='';});
}
// Drawing events are append-only, so undo and clear replay consistently for late joiners.
// Keep the original 900×540 coordinate space for saved strokes, even though
// the new canvas is square. Legacy saved stroke events remain readable.
function paint(stroke){if(stroke.segments){for(const segment of stroke.segments)paint(segment);return;}const pts=JSON.parse(stroke.points);if(!Array.isArray(pts)||!pts.length)return;const y=value=>logicalToCanvasY(value,canvas.height);ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(pts[0][0],y(pts[0][1]));if(pts.length===1)ctx.lineTo(pts[0][0]+.01,y(pts[0][1])+.01);else for(const p of pts.slice(1))ctx.lineTo(p[0],y(p[1]));ctx.stroke();}
function redraw(){ctx.clearRect(0,0,canvas.width,canvas.height);for(const stroke of strokes){try{paint(stroke);}catch(e){console.error(e);}}if(drawing&&points.length)paint({color:strokeColor,width:strokeWidth,points:JSON.stringify(points)});show('canvas-placeholder',!strokes.length&&!drawing);updateDrawingControls();}
function turnExpired(){return countdownRemaining(room,Date.now()+serverOffset)>0||!!(room?.timeLimit && remainingMs(turnStart(room),room.timeLimit,Date.now()+serverOffset)===0);}
function updateDrawingControls(){if(room)$('whistle').disabled=room.phase!=='playing'||room.host!==user.uid||!!claims[room.turn]?.ended||turnExpired();if(room)$('pass-topic').disabled=room.phase!=='playing'||room.drawer!==user.uid||!!claims[room.turn]?.ended||correctEntries(claims[room.turn]).length>0||turnExpired()||!drawerWord;const disabled=!room||room.phase!=='playing'||!!claims[room.turn]?.ended||turnExpired()||room.drawer!==user.uid||drawing||pendingDraws>0||!strokes.length;$('undo').disabled=disabled;$('clear').disabled=disabled;}
function sendDrawingEvent(event){
 const roomCode=code,gameId=room.gameId,turn=room.turn;pendingDraws++;updateDrawingControls();
 // Allocate and send immediately rather than waiting for each server ACK.
 // Firebase preserves write order; undo/clear are disabled until all ACKs arrive.
 const task=set(push(ref(db,`drawings/${roomCode}/${gameId}/${turn}`)),event);
 task.catch(e=>toast(friendly(e))).finally(()=>{pendingDraws--;updateDrawingControls();});return task;
}
function pos(e){return pointerToLogical(e.clientX,e.clientY,canvas.getBoundingClientRect());}
function flushStroke(){
 if(!drawing||!strokeDirty||!points.length)return;
 if(!room||room.phase!=='playing'||claims[room.turn]?.ended||turnExpired()||room.drawer!==user.uid)return;
 const chunk=points;points=[chunk[chunk.length-1]];strokeDirty=false;
 sendDrawingEvent({color:strokeColor,width:strokeWidth,strokeId,points:JSON.stringify(chunk)}).catch(()=>redraw());
}
canvas.addEventListener('pointerdown',e=>{if(!room||room.phase!=='playing'||claims[room.turn]?.ended||turnExpired()||room.drawer!==user.uid)return;e.preventDefault();drawing=true;strokeId=randomId(20);strokeColor=color;strokeWidth=Number($('brush-size').value);points=[pos(e)];strokeDirty=true;canvas.setPointerCapture(e.pointerId);show('canvas-placeholder',false);paint({color:strokeColor,width:strokeWidth,points:JSON.stringify(points)});flushStroke();clearInterval(strokeTimer);strokeTimer=setInterval(flushStroke,100);updateDrawingControls();});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=pos(e),previous=points[points.length-1];if(p[0]===previous[0]&&p[1]===previous[1])return;points.push(p);strokeDirty=true;if(points.length>400)points=points.filter((_,i)=>i%2===0||i===points.length-1);paint({color:strokeColor,width:strokeWidth,points:JSON.stringify([previous,p])});});
function finishStroke(){if(!drawing)return;clearInterval(strokeTimer);flushStroke();drawing=false;points=[];strokeDirty=false;updateDrawingControls();}
canvas.addEventListener('pointerup',finishStroke);canvas.addEventListener('pointercancel',finishStroke);
$('undo').onclick=()=>{if(!room||!strokes.length)return;sendDrawingEvent({action:'undo'}).catch(()=>{});};
$('clear').onclick=()=>{if(!room||!strokes.length||!confirm('絵を全部消しますか？'))return;sendDrawingEvent({action:'clear'}).catch(()=>{});};
$('colors').onclick=e=>{const button=e.target.closest('button');if(!button)return;color=button.dataset.color;document.querySelectorAll('#colors button').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});};
$('colors').querySelectorAll('button').forEach((button,i)=>{button.classList.toggle('selected',i===0);button.setAttribute('aria-pressed',String(i===0));});

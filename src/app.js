import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, onValue, onChildAdded, push, set, get, runTransaction } from 'firebase/database';

const $ = id => document.getElementById(id);
let app, auth, db, user, code, room, claims={}, unsubscribe, unsubscribeClaims, unsubscribeDrawing, activeTurn, wordKey, color='#393632', drawing=false, points=[];
const canvas=$('canvas'), ctx=canvas.getContext('2d');
const show=(id, visible)=>$(id).classList.toggle('hidden',!visible);
function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('visible'),3500); }
function friendly(error){console.error(error); return error?.message?.replace(/^Firebase: /,'') || 'エラーが発生しました。もう一度お試しください。';}
async function connect(){
  if(user) return;
  const config=window.FIREBASE_CONFIG;
  if(!config?.apiKey || !config?.databaseURL || !config?.projectId || !config?.appId) throw new Error('Firebaseの設定が必要です。READMEの手順をご確認ください。');
  if(!app){app=initializeApp(config);auth=getAuth(app);db=getDatabase(app);}
  user=(await signInAnonymously(auth)).user;
}
const topics = ['ねこ','いぬ','うさぎ','ぞう','きりん','ぱんだ','らいおん','ぺんぎん','りんご','ばなな','いちご','すいか','おにぎり','らーめん','ぷりん','けーき','ひこうき','じてんしゃ','でんしゃ','くるま','かさ','めがね','とけい','はなび','ゆきだるま','たいよう','おばけ','さかな','たこ','かめ','かえる','ちょうちょ','ひまわり','さくら','やま','ろけっと','ぎたー','ぴあの','ぼうし','くつ'];
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
    const rounds=data.rounds; if(!Number.isInteger(rounds)||rounds<1||rounds>5)throw Error('周回数は1〜5にしてください。');
    let reason='開始できませんでした。'; let order, gameId;
    const locked=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='lobby')return;
      order=shuffle(Object.keys(current.players||{}));
      if(order.length<2){reason='2人以上で始めてください。';return;}
      gameId=current.gameId;current.phase='starting';return current;
    });
    if(!locked.committed)throw Error(reason);
    const answers=Array.from({length:order.length*rounds},()=>topics[randomInt(topics.length)]);
    try{
      await Promise.all(answers.map((answer,i)=>set(ref(db,`secrets/${data.code}/${gameId}/${i}`),answer)));
      const started=await transaction(`rooms/${data.code}`,current=>{
        if(!current||current.host!==user.uid||current.phase!=='starting'||current.gameId!==gameId)return;
        return {...current,phase:'playing',rounds,order,turn:0,drawer:order[0],lengths:answers.map(answer=>Array.from(answer).length)};
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
    const turn=room.turn, gameId=room.gameId;
    try{
      const result=await transaction(`claims/${data.code}/${gameId}/${turn}`,current=>current?undefined:{uid:user.uid,answer});
      return {correct:result.committed};
    }catch(e){if(e.code==='PERMISSION_DENIED'||e.message?.includes('permission_denied'))return {correct:false};throw e;}
  }
  if(name==='nextTurn'){
    const turn=room.turn, claim=claims[turn]; if(!claim)throw Error('まだ正解が出ていません。');
    const result=await transaction(`rooms/${data.code}`,current=>{
      if(!current||current.host!==user.uid||current.phase!=='playing'||current.turn!==turn)return;
      const next=turn+1;if(next>=current.order.length*current.rounds)current.phase='finished';
      else {current.turn=next;current.drawer=current.order[next%current.order.length];}return current;
    });
    if(!result.committed)throw Error('すでに進行しています。');return;
  }
}
async function action(button, task){button.disabled=true; try{await task();}catch(e){toast(friendly(e));}finally{button.disabled=false;}}
function enterRoom(roomCode){
  code=roomCode; show('home',false);show('room',true);$('room-code').textContent=code;
  if(unsubscribe) unsubscribe();
  unsubscribe=onValue(ref(db,`rooms/${code}`), snap=>{room=snap.val();if(!room){toast('部屋が終了しました。');goHome();return;}if(!unsubscribeClaims){unsubscribeClaims=onValue(ref(db,`claims/${code}/${room.gameId}`),snap=>{claims=snap.val()||{};if(room)render();},e=>toast(friendly(e)));}render();}, e=>toast(friendly(e)));
  window.scrollTo(0,0);
}
function goHome(){if(unsubscribe)unsubscribe();if(unsubscribeDrawing)unsubscribeDrawing();if(unsubscribeClaims)unsubscribeClaims();unsubscribe=null;unsubscribeClaims=null;unsubscribeDrawing=null;claims={};activeTurn=undefined;wordKey=undefined;room=null;code=null;show('room',false);show('home',true);}
$('create').onclick=()=>action($('create'),async()=>{const name=$('create-name').value.trim();if(!name)throw Error('なまえを入力してね。');await connect();const result=await call('createRoom',{name});enterRoom(result.code);});
$('join').onclick=()=>action($('join'),async()=>{const name=$('join-name').value.trim(), roomCode=$('join-code').value.trim().toUpperCase();if(!name)throw Error('なまえを入力してね。');if(!/^[A-Z0-9]{6}$/.test(roomCode))throw Error('合言葉は半角英数字6文字で入力してね。');await connect();await call('joinRoom',{name,code:roomCode});enterRoom(roomCode);});
$('leave').onclick=()=>action($('leave'),async()=>{if(room?.phase==='lobby') await call('leaveRoom',{code});else if(!confirm('ホームに戻りますか？ 同じブラウザから合言葉で再参加できます。'))return;goHome();});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);toast('合言葉をコピーしました！');}catch{toast('合言葉を選択してコピーしてね。');}};
$('start').onclick=()=>action($('start'),async()=>{await call('startGame',{code,rounds:Number($('rounds').value)});});
$('next').onclick=()=>action($('next'),async()=>{await call('nextTurn',{code});});
$('answer-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const answer=$('answer').value.trim();if(!answer)throw Error('答えを入力してね。');const result=await call('submitAnswer',{code,answer});$('answer').value='';if(!result.correct)toast('おしい！もう一度考えてみよう。');});};
function render(){
 const host=room.host===user.uid, lobby=room.phase==='lobby'||room.phase==='starting', finished=room.phase==='finished', claim=claims[room.turn], revealed=room.phase==='playing'&&!!claim, playing=room.phase==='playing'&&!claim, drawer=room.drawer===user.uid;
 show('lobby',lobby);show('game',!lobby);show('start',host&&room.phase==='lobby');show('start-hint',lobby&&(!host||room.phase==='starting'));$('start-hint').textContent=room.phase==='starting'?'ゲームを準備しています…':'ホストがゲームを開始するまで待ってね';$('rounds').disabled=!host;
 $('room-title').textContent=lobby?'みんなの部屋':finished?'ゲーム終了！':'おえかきバトル！';
 $('room-subtitle').textContent=lobby?'友だちが集まるまで、ちょっと待ってね。':finished?'みんなで遊んでくれてありがとう！':`合言葉 ${code}　・　みんなで楽しく遊ぼう`;
 const players=Object.entries(room.players||{}).map(([id,p])=>[id,{...p,score:Object.values(claims).filter(c=>c?.uid===id).length}]); $('player-count').textContent=`${players.length}人`;
 const order=room.order||players.map(([id])=>id);players.sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
 $('players').replaceChildren(...players.map(([id,p],i)=>{const div=document.createElement('div');div.className='player';const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('div');name.className='player-name';name.textContent=p.name+(id===user.uid?'（あなた）':'');const meta=document.createElement('small');meta.textContent=id===room.host?'HOST':(!lobby&&id===room.drawer?'おえかき中':'');name.appendChild(meta);const score=document.createElement('b');score.textContent=lobby?'':`${p.score||0} pt`;div.append(avatar,name,score);return div;}));
 if(lobby)return;
 const total=room.order.length*room.rounds;
 $('turn-label').textContent=finished?'GAME COMPLETE':`ROUND ${Math.floor(room.turn/room.order.length)+1} / ${room.rounds}　・　${room.turn+1} / ${total} ターン`;
 $('turn-badge').textContent=finished?'🏆':drawer?'🎨':'💡';
 show('tools',playing&&drawer);show('answer-form',playing&&!drawer);show('result',!playing);show('next',revealed&&host);
 if(finished){const max=Math.max(...players.map(([,p])=>p.score||0));const winners=players.filter(([,p])=>(p.score||0)===max).map(([,p])=>p.name).join('、');$('prompt').textContent='おつかれさま！';$('game-hint').textContent='すべてのターンが終わりました。';$('result').textContent=`🏆 ${winners}　${max}ポイント！`;}
 else if(revealed){$('prompt').textContent='正解！';$('game-hint').textContent=host?'次のターンに進もう！':'ホストが次へ進むのを待ってね。';$('result').textContent=`🎉 ${room.players[claim.uid]?.name || 'だれか'} が正解！ 答えは「${claim.answer}」`;}
 else {const drawerName=room.players[room.drawer]?.name||'だれか';$('prompt').textContent=drawer?'お題を読み込み中…':`${room.lengths[room.turn]}文字のお題`; $('game-hint').textContent=drawer?'あなたの番！お題の絵を描こう。':`${drawerName} さんがおえかき中！何を描いているかな？`;
 if(drawer){const key=`${code}:${room.turn}`;if(wordKey!==key){wordKey=key;call('getWord',{code}).then(data=>{if(room?.phase==='playing'&&!claims[room.turn]&&room.turn===data.turn&&room.drawer===user.uid){$('prompt').textContent=`お題：${data.word}`;$('prompt').dataset.wordKey=key;$('prompt').dataset.word=`お題：${data.word}`;}}).catch(e=>{wordKey=undefined;toast(friendly(e));});}else if($('prompt').dataset.wordKey===key){$('prompt').textContent=$('prompt').dataset.word;} }
 }
 // The turn's drawing is append-only; each completed stroke is sent to everyone.
 if(activeTurn!==room.turn){activeTurn=room.turn; if(unsubscribeDrawing)unsubscribeDrawing();ctx.clearRect(0,0,canvas.width,canvas.height);show('canvas-placeholder',true);unsubscribeDrawing=onChildAdded(ref(db,`drawings/${code}/${room.gameId}/${room.turn}`),snap=>{const stroke=snap.val();try{paint(stroke);show('canvas-placeholder',false);}catch(e){console.error(e);}});}
}
// drawing coordinates are normalized to the canvas dimensions
function paint(stroke){const pts=JSON.parse(stroke.points);if(!pts.length)return;ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);if(pts.length===1)ctx.lineTo(pts[0][0]+.01,pts[0][1]+.01);else for(const p of pts.slice(1))ctx.lineTo(p[0],p[1]);ctx.stroke();}
function pos(e){const rect=canvas.getBoundingClientRect();return [Math.round((e.clientX-rect.left)*canvas.width/rect.width),Math.round((e.clientY-rect.top)*canvas.height/rect.height)];}
canvas.addEventListener('pointerdown',e=>{if(!room||room.phase!=='playing'||claims[room.turn]||room.drawer!==user.uid)return;e.preventDefault();drawing=true;points=[pos(e)];canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=pos(e), previous=points[points.length-1];if(p[0]===previous[0]&&p[1]===previous[1])return;points.push(p);paint({color,width:Number($('brush-size').value),points:JSON.stringify([previous,p])});show('canvas-placeholder',false);});
async function finishStroke(){if(!drawing)return;drawing=false;if(!room||room.phase!=='playing'||claims[room.turn]||room.drawer!==user.uid)return;const stroke={color,width:Number($('brush-size').value),points:JSON.stringify(points)};try{await set(push(ref(db,`drawings/${code}/${room.gameId}/${room.turn}`)),stroke);}catch(e){toast(friendly(e));}}
canvas.addEventListener('pointerup',finishStroke);canvas.addEventListener('pointercancel',finishStroke);
$('colors').onclick=e=>{const button=e.target.closest('button');if(!button)return;color=button.dataset.color;document.querySelectorAll('#colors button').forEach(b=>b.classList.toggle('selected',b===button));};
$('colors').firstElementChild.classList.add('selected');

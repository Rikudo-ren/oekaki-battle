import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getDatabase, ref, onValue, onChildAdded, push, set } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';

const $ = id => document.getElementById(id);
let app, auth, db, fn, user, code, room, unsubscribe, unsubscribeDrawing, activeTurn, wordKey, color='#393632', drawing=false, points=[];
const canvas=$('canvas'), ctx=canvas.getContext('2d');
const show=(id, visible)=>$(id).classList.toggle('hidden',!visible);
function toast(message){ const el=$('toast'); el.textContent=message; el.classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('visible'),3500); }
function friendly(error){console.error(error); return error?.message?.replace(/^Firebase: /,'') || 'エラーが発生しました。もう一度お試しください。';}
async function connect(){
  if(user) return;
  const config=window.FIREBASE_CONFIG;
  if(!config?.apiKey || !config?.databaseURL || !config?.projectId || !config?.appId) throw new Error('Firebaseの設定が必要です。READMEの手順をご確認ください。');
  if(!app){app=initializeApp(config);auth=getAuth(app);db=getDatabase(app);fn=getFunctions(app,'asia-northeast1');}
  user=(await signInAnonymously(auth)).user;
}
async function call(name,data){ return (await httpsCallable(fn,name)(data)).data; }
async function action(button, task){button.disabled=true; try{await task();}catch(e){toast(friendly(e));}finally{button.disabled=false;}}
function enterRoom(roomCode){
  code=roomCode; show('home',false);show('room',true);$('room-code').textContent=code;
  if(unsubscribe) unsubscribe();
  unsubscribe=onValue(ref(db,`rooms/${code}`), snap=>{room=snap.val();if(!room){toast('部屋が終了しました。');goHome();return;}render();}, e=>toast(friendly(e)));
  window.scrollTo(0,0);
}
function goHome(){if(unsubscribe)unsubscribe();if(unsubscribeDrawing)unsubscribeDrawing();unsubscribe=null;unsubscribeDrawing=null;activeTurn=undefined;wordKey=undefined;room=null;code=null;show('room',false);show('home',true);}
$('create').onclick=()=>action($('create'),async()=>{const name=$('create-name').value.trim();if(!name)throw Error('なまえを入力してね。');await connect();const result=await call('createRoom',{name});enterRoom(result.code);});
$('join').onclick=()=>action($('join'),async()=>{const name=$('join-name').value.trim(), roomCode=$('join-code').value.trim().toUpperCase();if(!name)throw Error('なまえを入力してね。');if(!/^[A-Z0-9]{6}$/.test(roomCode))throw Error('合言葉は半角英数字6文字で入力してね。');await connect();await call('joinRoom',{name,code:roomCode});enterRoom(roomCode);});
$('leave').onclick=()=>action($('leave'),async()=>{if(room?.phase==='lobby') await call('leaveRoom',{code});else if(!confirm('ホームに戻りますか？ 同じブラウザから合言葉で再参加できます。'))return;goHome();});
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(code);toast('合言葉をコピーしました！');}catch{toast('合言葉を選択してコピーしてね。');}};
$('start').onclick=()=>action($('start'),async()=>{await call('startGame',{code,rounds:Number($('rounds').value)});});
$('next').onclick=()=>action($('next'),async()=>{await call('nextTurn',{code});});
$('answer-form').onsubmit=e=>{e.preventDefault();action(e.submitter,async()=>{const answer=$('answer').value.trim();if(!answer)throw Error('答えを入力してね。');const result=await call('submitAnswer',{code,answer});$('answer').value='';if(!result.correct)toast('おしい！もう一度考えてみよう。');});};
function render(){
 const host=room.host===user.uid, lobby=room.phase==='lobby'||room.phase==='starting', finished=room.phase==='finished', playing=room.phase==='playing', drawer=room.drawer===user.uid;
 show('lobby',lobby);show('game',!lobby);show('start',host&&room.phase==='lobby');show('start-hint',lobby&&(!host||room.phase==='starting'));$('start-hint').textContent=room.phase==='starting'?'ゲームを準備しています…':'ホストがゲームを開始するまで待ってね';$('rounds').disabled=!host;
 $('room-title').textContent=lobby?'みんなの部屋':finished?'ゲーム終了！':'おえかきバトル！';
 $('room-subtitle').textContent=lobby?'友だちが集まるまで、ちょっと待ってね。':finished?'みんなで遊んでくれてありがとう！':`合言葉 ${code}　・　みんなで楽しく遊ぼう`;
 const players=Object.entries(room.players||{}); $('player-count').textContent=`${players.length}人`;
 const order=room.order||players.map(([id])=>id);players.sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
 $('players').replaceChildren(...players.map(([id,p],i)=>{const div=document.createElement('div');div.className='player';const avatar=document.createElement('span');avatar.className=`avatar avatar-${i%4}`;avatar.textContent=['☺','✿','★','☻'][i%4];const name=document.createElement('div');name.className='player-name';name.textContent=p.name+(id===user.uid?'（あなた）':'');const meta=document.createElement('small');meta.textContent=id===room.host?'HOST':(!lobby&&id===room.drawer?'おえかき中':'');name.appendChild(meta);const score=document.createElement('b');score.textContent=lobby?'':`${p.score||0} pt`;div.append(avatar,name,score);return div;}));
 if(lobby)return;
 const total=room.order.length*room.rounds;
 $('turn-label').textContent=finished?'GAME COMPLETE':`ROUND ${Math.floor(room.turn/room.order.length)+1} / ${room.rounds}　・　${room.turn+1} / ${total} ターン`;
 $('turn-badge').textContent=finished?'🏆':drawer?'🎨':'💡';
 show('tools',playing&&drawer);show('answer-form',playing&&!drawer);show('result',!playing);show('next',room.phase==='revealed'&&host);
 if(finished){const max=Math.max(...players.map(([,p])=>p.score||0));const winners=players.filter(([,p])=>(p.score||0)===max).map(([,p])=>p.name).join('、');$('prompt').textContent='おつかれさま！';$('game-hint').textContent='すべてのターンが終わりました。';$('result').textContent=`🏆 ${winners}　${max}ポイント！`;}
 else if(room.phase==='revealed'){$('prompt').textContent='正解！';$('game-hint').textContent=host?'次のターンに進もう！':'ホストが次へ進むのを待ってね。';$('result').textContent=`🎉 ${room.players[room.winner]?.name || 'だれか'} が正解！ 答えは「${room.answer}」`;}
 else {const drawerName=room.players[room.drawer]?.name||'だれか';$('prompt').textContent=drawer?'お題を読み込み中…':`${room.wordLength}文字のお題`; $('game-hint').textContent=drawer?'あなたの番！お題の絵を描こう。':`${drawerName} さんがおえかき中！何を描いているかな？`;
 if(drawer){const key=`${code}:${room.turn}`;if(wordKey!==key){wordKey=key;call('getWord',{code}).then(data=>{if(room?.phase==='playing'&&room.turn===data.turn&&room.drawer===user.uid){$('prompt').textContent=`お題：${data.word}`;$('prompt').dataset.wordKey=key;$('prompt').dataset.word=`お題：${data.word}`;}}).catch(e=>{wordKey=undefined;toast(friendly(e));});}else if($('prompt').dataset.wordKey===key){$('prompt').textContent=$('prompt').dataset.word;} }
 }
 // The turn's drawing is append-only; each completed stroke is sent to everyone.
 if(activeTurn!==room.turn){activeTurn=room.turn; if(unsubscribeDrawing)unsubscribeDrawing();ctx.clearRect(0,0,canvas.width,canvas.height);show('canvas-placeholder',true);unsubscribeDrawing=onChildAdded(ref(db,`drawings/${code}/${room.turn}`),snap=>{const stroke=snap.val();try{paint(stroke);show('canvas-placeholder',false);}catch(e){console.error(e);}});}
}
// drawing coordinates are normalized to the canvas dimensions
function paint(stroke){const pts=JSON.parse(stroke.points);if(!pts.length)return;ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);if(pts.length===1)ctx.lineTo(pts[0][0]+.01,pts[0][1]+.01);else for(const p of pts.slice(1))ctx.lineTo(p[0],p[1]);ctx.stroke();}
function pos(e){const rect=canvas.getBoundingClientRect();return [Math.round((e.clientX-rect.left)*canvas.width/rect.width),Math.round((e.clientY-rect.top)*canvas.height/rect.height)];}
canvas.addEventListener('pointerdown',e=>{if(!room||room.phase!=='playing'||room.drawer!==user.uid)return;e.preventDefault();drawing=true;points=[pos(e)];canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=pos(e), previous=points[points.length-1];if(p[0]===previous[0]&&p[1]===previous[1])return;points.push(p);paint({color,width:Number($('brush-size').value),points:JSON.stringify([previous,p])});show('canvas-placeholder',false);});
async function finishStroke(){if(!drawing)return;drawing=false;if(!room||room.phase!=='playing'||room.drawer!==user.uid)return;const stroke={color,width:Number($('brush-size').value),points:JSON.stringify(points)};try{await set(push(ref(db,`drawings/${code}/${room.turn}`)),stroke);}catch(e){toast(friendly(e));}}
canvas.addEventListener('pointerup',finishStroke);canvas.addEventListener('pointercancel',finishStroke);
$('colors').onclick=e=>{const button=e.target.closest('button');if(!button)return;color=button.dataset.color;document.querySelectorAll('#colors button').forEach(b=>b.classList.toggle('selected',b===button));};
$('colors').firstElementChild.classList.add('selected');

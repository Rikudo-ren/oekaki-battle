// The credential lives only in the active page, never localStorage or Firebase.
export async function aiRequest(config,action,extra={},signal){
 const controller=new AbortController(),cancel=()=>controller.abort();
 if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',cancel,{once:true});
 const timeout=setTimeout(cancel,29000);
 try{
  const response=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',body:JSON.stringify({provider:config.provider,key:config.key,model:config.model,action,...extra}),signal:controller.signal});
  let body;try{body=await response.json();}catch{const status=Number.isInteger(response.status)?`（HTTP ${response.status}）`:'';throw new Error(`サイトのAI中継から応答を読み取れませんでした${status}。`);}
  if(!response.ok)throw new Error(typeof body.error==='string'?body.error:'AIサービスに接続できませんでした。');
  return body;
 }finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
}
const allowedColors=new Set(['#393632','#ef806d','#efc35e','#79aa91','#80a6c8']);
export function parseAiDrawing(text){
 if(typeof text!=='string'||text.length>30000)return null;
 let value;try{const cleaned=text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');value=JSON.parse(cleaned);}catch{return null;}
 const strokes=Array.isArray(value)?value:value?.strokes;
 if(!Array.isArray(strokes)||strokes.length<2||strokes.length>25)return null;
 const drawing=[];
 for(const stroke of strokes){
  if(!stroke||!Array.isArray(stroke.points)||stroke.points.length<2||stroke.points.length>50||!allowedColors.has(stroke.color)||!Number.isFinite(stroke.width)||stroke.width<2||stroke.width>24)return null;
  if(stroke.points.some(point=>!Array.isArray(point)||point.length!==2||!point.every(Number.isFinite)||point[0]<0||point[0]>900||point[1]<0||point[1]>540))return null;
  drawing.push({color:stroke.color,width:stroke.width,points:stroke.points.map(([x,y])=>[Math.round(x),Math.round(y)])});
 }
 return drawing;
}
export function parseAiGuess(text,length){
 if(typeof text!=='string')return null;
 const guess=text.trim().normalize('NFKC');
 return /^[\u3041-\u3096ー]+$/.test(guess)&&Array.from(guess).length===length&&guess!=='わからない'?guess:null;
}

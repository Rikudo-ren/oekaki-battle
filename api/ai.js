// A deliberately narrow, stateless proxy. Keys are supplied per request and
// are never persisted, logged, included in URLs, or sent to arbitrary hosts.
const providers={
 openai:{base:'https://api.openai.com/v1',headers:key=>({Authorization:`Bearer ${key}`})},
 gemini:{base:'https://generativelanguage.googleapis.com/v1beta',headers:key=>({'x-goog-api-key':key})},
 anthropic:{base:'https://api.anthropic.com/v1',headers:key=>({'x-api-key':key,'anthropic-version':'2023-06-01'})},
};
const err=(status,message)=>Object.assign(new Error(message),{status});
const errorForStatus=status=>status===400?'モデルや画像入力の対応状況を確認してください。':status===401||status===403?'APIキーまたは利用権限を確認してください。':status===404?'指定したモデルが見つかりません。':status===429?'利用制限または料金枠を確認してください。':'AIサービスに接続できませんでした。';
async function upstream(url,headers,body){
 let response;
 try{response=await fetch(url,{method:body?'POST':'GET',headers:{...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(18000),redirect:'error'});}catch{throw err(502,'AIサービスに接続できませんでした。');}
 if(!response.ok)throw err(response.status===429?429:response.status===401||response.status===403?401:response.status===404?404:502,errorForStatus(response.status));
 try{return await response.json();}catch{throw err(502,'AIサービスの応答を読み取れませんでした。');}
}
function usableModel(provider,id,model){
 if(typeof id!=='string'||id.length>160||!/^[a-zA-Z0-9._:-]+$/.test(id))return false;
 if(provider==='gemini')return /^gemini-/i.test(id)&&model.supportedGenerationMethods?.includes('generateContent')&&!/(tts|audio|live|image|embedding|robotics)/i.test(id);
 if(provider==='anthropic')return /^claude-/i.test(id);
 return /^(gpt-|o[134](?:-|$))/i.test(id)&&!/(audio|realtime|transcribe|search|instruct|embedding|image|moderation)/i.test(id);
}
async function listModels(provider,config,key){
 const found=[],headers=config.headers(key);let cursor='';
 for(let page=0;page<5;page++){
  const path=provider==='openai'?'/models':provider==='gemini'?`/models?pageSize=100${cursor?'&pageToken='+encodeURIComponent(cursor):''}`:`/models?limit=100${cursor?'&after_id='+encodeURIComponent(cursor):''}`;
  const json=await upstream(config.base+path,headers);const models=provider==='gemini'?json.models:json.data;
  if(!Array.isArray(models))throw err(502,'モデル一覧を取得できませんでした。');
  for(const item of models){const id=provider==='gemini'?item.name?.replace(/^models\//,''):item.id;if(usableModel(provider,id,item))found.push({id,label:String(item.display_name||item.displayName||id).slice(0,160)});}
  cursor=provider==='gemini'?json.nextPageToken:provider==='anthropic'&&json.has_more?json.last_id:null;
  if(!cursor)break;
 }
 return [...new Map(found.map(item=>[item.id,item])).values()].sort((a,b)=>a.id.localeCompare(b.id)).slice(0,300);
}
async function generate(provider,config,key,model,prompt,image,draw){
 const headers=config.headers(key);let url,payload;
 const maxTokens=draw?4096:1024;
 if(provider==='openai'){
  url=config.base+'/chat/completions';const content=[{type:'text',text:prompt}];if(image)content.push({type:'image_url',image_url:{url:image}});
  payload={model,max_completion_tokens:maxTokens,messages:[{role:'user',content}]};
 }else if(provider==='gemini'){
  url=`${config.base}/models/${encodeURIComponent(model)}:generateContent`;const parts=[{text:prompt}];if(image)parts.push({inlineData:{mimeType:'image/png',data:image.slice('data:image/png;base64,'.length)}});
  payload={contents:[{role:'user',parts}],generationConfig:{maxOutputTokens:maxTokens}};
 }else{
  url=config.base+'/messages';const content=[{type:'text',text:prompt}];if(image)content.push({type:'image',source:{type:'base64',media_type:'image/png',data:image.slice('data:image/png;base64,'.length)}});
  payload={model,max_tokens:maxTokens,messages:[{role:'user',content}]};
 }
 const json=await upstream(url,headers,payload);
 const text=provider==='openai'?json.choices?.[0]?.message?.content:provider==='gemini'?json.candidates?.[0]?.content?.parts?.filter(p=>typeof p.text==='string').map(p=>p.text).join(''):json.content?.filter(p=>p.type==='text').map(p=>p.text).join('');
 if(typeof text!=='string'||!text.trim()||text.length>30000)throw err(502,'AIの応答が空か、長すぎました。');
 return text;
}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='POST')return res.status(405).json({error:'POSTのみ対応しています。'});
 try{
  const body=req.body;if(!body||typeof body!=='object'||Array.isArray(body))throw err(400,'リクエストが不正です。');
  const {provider,key,action,model,image,length,word}=body,config=Object.hasOwn(providers,provider)?providers[provider]:null;
  if(!config||typeof key!=='string'||key.length<1||key.length>512||!/^[\x21-\x7e]+$/.test(key))throw err(400,'サービスとAPIキーを確認してください。');
  if(action==='models')return res.status(200).json({models:await listModels(provider,config,key)});
  if(!['guess','draw'].includes(action)||typeof model!=='string'||model.length>160||!/^[a-zA-Z0-9._:-]+$/.test(model))throw err(400,'モデルを選択してください。');
  let prompt;
  if(action==='guess'){
   if(!Number.isInteger(length)||length<2||length>6||typeof image!=='string'||image.length>1000000||!/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(image))throw err(400,'絵または文字数が不正です。');
   prompt=`あなたはお絵かき当てゲームの回答者です。画像の絵を見て何かを推測してください。答えはひらがなで${length}文字（長音ーを含む）です。正解は知らされていません。推測を1つだけ、ひらがなのみで返してください。わからなければ「わからない」と返してください。説明や句読点は不要です。`;
  }else{
   if(typeof word!=='string'||!/^[\u3041-\u3096ー]{2,6}$/.test(word))throw err(400,'お題が不正です。');
   prompt=`お絵かき当てゲームのため「${word}」を簡単な線画で描いてください。文字・数字を描かず、誰でも分かる特徴を大きく描きます。キャンバスは幅900、高さ540です。JSONのみを出力: {"strokes":[{"color":"#393632","width":7,"points":[[x,y],[x,y]]}]}。座標はx=0〜900、y=0〜540の整数。色は #393632 #ef806d #efc35e #79aa91 #80a6c8 のいずれか。2〜25本の線、各線2〜50点。線は順番に描画します。説明は不要。`;
  }
  return res.status(200).json({text:await generate(provider,config,key,model,prompt,action==='guess'?image:null,action==='draw')});
 }catch(e){return res.status(e.status||500).json({error:e.status?e.message:'AIの処理に失敗しました。'});}
};

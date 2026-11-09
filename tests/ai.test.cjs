const {test}=require('node:test');
const assert=require('node:assert/strict');
const handler=require('../api/ai.js');
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
async function call(body,method='POST'){const res=response();await handler({method,body},res);return res;}
const ok=body=>({ok:true,status:200,json:async()=>body});
test('AIの描画と回答は形式と範囲を厳しく検証する',async()=>{
 const {parseAiDrawing,parseAiGuess}=await import('../src/ai.mjs');
 const drawing={strokes:[{color:'#393632',width:7,points:[[1,2],[800,500]]},{color:'#ef806d',width:5,points:[[4,5],[6,7]]}]};
 assert.equal(parseAiDrawing('```json\n'+JSON.stringify(drawing)+'\n```').length,2);
 assert.equal(parseAiDrawing('{}'),null);assert.equal(parseAiDrawing('not json'),null);
 assert.equal(parseAiDrawing(JSON.stringify({...drawing,strokes:[{...drawing.strokes[0],points:[[0,0],[901,0]]},drawing.strokes[1]]})),null);
 assert.equal(parseAiDrawing(JSON.stringify({...drawing,strokes:[{...drawing.strokes[0],color:'url(evil)'},drawing.strokes[1]]})),null);
 assert.equal(parseAiGuess(' ねこ ',2),'ねこ');assert.equal(parseAiGuess('ねこです',2),null);assert.equal(parseAiGuess('わからない',5),null);assert.equal(parseAiGuess('ねこ！',2),null);
});
test('モデル一覧はサービスごとに取得し、ページをまたいで対象モデルを選別する',async()=>{
 const old=global.fetch;const calls=[];
 try{
  global.fetch=async(url,options)=>{calls.push({url,options});if(url.includes('openai'))return ok({data:[{id:'gpt-4o'},{id:'gpt-4o-audio'},{id:'text-embedding-3-small'}]});if(url.includes('anthropic'))return ok({data:[{id:'claude-test',display_name:'Claude Test'}],has_more:false});if(url.includes('pageToken=next'))return ok({models:[{name:'models/gemini-2',supportedGenerationMethods:['generateContent']}]});return ok({models:[{name:'models/gemini-1',supportedGenerationMethods:['generateContent']},{name:'models/text-embedding',supportedGenerationMethods:['embedContent']}],nextPageToken:'next'});};
  for(const [provider,ids] of [['openai',['gpt-4o']],['gemini',['gemini-1','gemini-2']],['anthropic',['claude-test']]]){const res=await call({action:'models',provider,key:'secret-test'});assert.equal(res.statusCode,200);assert.deepEqual(res.body.models.map(m=>m.id),ids);assert.equal(res.headers['Cache-Control'],'no-store');}
  assert.ok(calls.every(c=>!c.url.includes('secret-test')));assert.ok(calls.every(c=>c.options.redirect==='error'));
 }finally{global.fetch=old;}
});
test('3サービスへ画像付き推測と線画の要求を送り、秘密とエラーを漏らさない',async()=>{
 const old=global.fetch,calls=[];
 try{
  global.fetch=async(url,options)=>{calls.push({url,options});if(url.includes('openai'))return ok({choices:[{message:{content:'ねこ'}}]});if(url.includes('googleapis'))return ok({candidates:[{content:{parts:[{text:'ねこ'}]}}]});return ok({content:[{type:'text',text:'ねこ'}]});};
  const image='data:image/png;base64,aGVsbG8=';
  for(const provider of ['openai','gemini','anthropic']){
   const res=await call({provider,key:'secret-test',action:'guess',model:provider==='openai'?'gpt-4o':provider==='gemini'?'gemini-1':'claude-test',image,length:2});assert.equal(res.statusCode,200);assert.equal(res.body.text,'ねこ');
   const sent=JSON.stringify(JSON.parse(calls.at(-1).options.body));assert.ok(sent.includes('aGVsbG8='));assert.ok(!sent.includes('secret-test'));assert.ok(!sent.includes('正解はねこ'));
   const draw=await call({provider,key:'secret-test',action:'draw',model:'test-model',word:'ねこ'});assert.equal(draw.statusCode,200);assert.ok(calls.at(-1).options.body.includes('ねこ'));
  }
  global.fetch=async()=>({ok:false,status:401,json:async()=>({error:'secret-test'})});const failed=await call({provider:'openai',key:'secret-test',action:'models'});assert.equal(failed.statusCode,401);assert.ok(!JSON.stringify(failed.body).includes('secret-test'));
  for(const body of [{provider:'__proto__',key:'a',action:'models'},{provider:'openai',key:'a',action:'guess',model:'../../evil',image,length:2},{provider:'openai',key:'a',action:'guess',model:'gpt-4o',image:'http://bad',length:2}])assert.equal((await call(body)).statusCode,400);
  assert.equal((await call({},'GET')).statusCode,405);
 }finally{global.fetch=old;}
});
test('AIへのリクエストは中止でき、キーはURLや永続領域に書かない',async()=>{
 const {aiRequest}=await import('../src/ai.mjs');const old=global.fetch;let seen;
 try{
  global.fetch=(url,options)=>{seen={url,options};return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));};
  const controller=new AbortController(),pending=aiRequest({provider:'openai',key:'secret-test',model:'gpt-test'},'guess',{image:'data:image/png;base64,YQ==',length:2},controller.signal);controller.abort();await assert.rejects(pending,/aborted/);assert.equal(seen.url,'/api/ai');assert.ok(!seen.url.includes('secret-test'));assert.equal(seen.options.cache,'no-store');
 }finally{global.fetch=old;}
});

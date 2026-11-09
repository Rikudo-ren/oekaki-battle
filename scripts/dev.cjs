// Minimal local server for the static site and the same stateless AI function
// used on Vercel. API request bodies and credentials are never logged.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const api=require('../api/ai.js'),root=path.resolve(__dirname,'../public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.wav':'audio/wav','.mp3':'audio/mpeg'};
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');
 if(url.pathname==='/api/ai'){
  let size=0,chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>1200000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
  try{req.body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{req.body=null;}
  res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));};
  await api(req,res);return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
 let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{res.writeHead(400).end();return;}
 const filename=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.stat(filename,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream'});if(req.method==='HEAD')res.end();else fs.createReadStream(filename).pipe(res);});
});
const port=Number(process.env.PORT||4174);server.listen(port,'0.0.0.0',()=>console.log(`Local game server listening on ${port}`));

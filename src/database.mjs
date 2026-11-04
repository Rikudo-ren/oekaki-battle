// The regular rooms use Firebase unchanged. The single-player room uses this
// small in-memory adapter so it works offline and never writes bot identities
// or private drawings into a public database.
import * as firebase from 'firebase/database';

export function createMemoryDatabase() { return {local:true, data:{}, listeners:new Set(), sequence:0}; }
const clone = value => value == null ? null : JSON.parse(JSON.stringify(value));
const parts = path => path.split('/').filter(Boolean);
function read(db,path) { return parts(path).reduce((obj,key)=>obj?.[key],db.data) ?? null; }
function resolved(value, now=Date.now()) {
  if (value && typeof value === 'object' && value['.sv'] === 'timestamp') return now;
  if (Array.isArray(value)) return value.map(v=>resolved(v,now));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolved(v,now)]));
  return value;
}
function write(db,path,value) {
  const keys=parts(path);if(!keys.length){db.data=resolved(value)||{};return;}
  const stack=[];let node=db.data;
  for(const key of keys.slice(0,-1)){stack.push([node,key]);node=node[key]??={};}
  if(value===null)delete node[keys.at(-1)];else node[keys.at(-1)]=resolved(value);
  for(const [parent,key] of stack.reverse()){const child=parent[key];if(child&&typeof child==='object'&&!Object.keys(child).length)delete parent[key];else break;}
}
function notify(db,paths){for(const listener of db.listeners)if(paths.some(p=>p===listener.path||p.startsWith(listener.path+'/')||listener.path.startsWith(p+'/')))queueMicrotask(()=>{if(db.listeners.has(listener))listener.callback(snapshot(read(db,listener.path)));});}
const snapshot = value => ({val:()=>clone(value)});
const local = reference => !!reference?.db?.local;
export const ref = (db,path) => db?.local?{db,path}:firebase.ref(db,path);
export const serverTimestamp = () => firebase.serverTimestamp();
export const limitToLast = n => firebase.limitToLast(n);
export const query = (r,...constraints) => local(r)?r:firebase.query(r,...constraints);
export const get = r => local(r)?Promise.resolve(snapshot(read(r.db,r.path))):firebase.get(r);
export function set(r,value){if(!local(r))return firebase.set(r,value);const keys=parts(r.path);if(keys[0]==='verified'&&keys.length===5&&value!==null&&read(r.db,`secrets/${keys[1]}/${keys[2]}/${keys[3]}`)!==value){const e=Error('permission_denied');e.code='PERMISSION_DENIED';return Promise.reject(e);}write(r.db,r.path,value);notify(r.db,[r.path]);return Promise.resolve();}
export function update(r,values){if(!local(r))return firebase.update(r,values);const paths=[];for(const [key,value] of Object.entries(values)){const path=`${r.path}/${key}`;write(r.db,path,value);paths.push(path);}notify(r.db,paths);return Promise.resolve();}
export function runTransaction(r,updater,options){
 if(!local(r))return firebase.runTransaction(r,updater,options);
 const result=updater(clone(read(r.db,r.path)));if(result===undefined)return Promise.resolve({committed:false,snapshot:snapshot(read(r.db,r.path))});
 write(r.db,r.path,result);notify(r.db,[r.path]);return Promise.resolve({committed:true,snapshot:snapshot(read(r.db,r.path))});
}
export function onValue(r,callback,onError){
 if(!local(r))return firebase.onValue(r,callback,onError);
 if(r.path==='.info/connected'||r.path==='.info/serverTimeOffset'){queueMicrotask(()=>callback(snapshot(r.path==='.info/connected'?true:0)));return ()=>{};}
 const listener={path:r.path,callback};r.db.listeners.add(listener);queueMicrotask(()=>{if(r.db.listeners.has(listener))callback(snapshot(read(r.db,r.path)));});return ()=>r.db.listeners.delete(listener);
}
export function push(r){if(!local(r))return firebase.push(r);return {db:r.db,path:`${r.path}/${String(++r.db.sequence).padStart(12,'0')}`};}
export function onDisconnect(r){if(!local(r))return firebase.onDisconnect(r);return {update:async()=>{},cancel:async()=>{}};}

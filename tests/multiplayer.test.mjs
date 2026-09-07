import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
const root=resolve(import.meta.dirname,'..');
test('three real websocket clients share state; guest cannot control; late join catches up',async()=>{
 const dir=await mkdtemp(resolve(root,'.test-'));await mkdir(resolve(dir,'.data'));const db=new DatabaseSync(resolve(dir,'.data/local.sqlite'));db.exec('CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)');const id='012345abcdef',token='test-host-token';
 db.prepare('INSERT INTO kv VALUES(?,?)').run('room:'+id,JSON.stringify({id,name:'Test room',hostHash:createHash('sha256').update(token).digest('hex'),revision:0,queue:[{id:'track1',status:'ready',provider:'audius',duration:180,title:'Test'}],requests:[],playback:{trackId:'track1',position:0,playing:false,startedAt:Date.now()}}));db.close();
 const port=19321,origin=`http://localhost:${port}`,proc=spawn(process.execPath,[resolve(root,'server/index.mjs')],{cwd:dir,env:{...process.env,PORT:String(port),PUBLIC_ORIGIN:origin,REDIS_URL:'',NODE_ENV:'test'}});let output='';proc.stdout.on('data',c=>output+=c);proc.stderr.on('data',c=>output+=c);const clients=[];
 try{
  await new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(output.includes('listening room on')){clearInterval(timer);resolve();}else if(Date.now()-start>6000){clearInterval(timer);reject(Error(output));}},40);});
  async function join(token=''){const ws=new WebSocket(`ws://localhost:${port}/ws`,{origin});clients.push(ws);const inbox=[];ws.on('message',raw=>inbox.push(JSON.parse(raw)));await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j)});ws.send(JSON.stringify({type:'join',room:id,name:token?'Host':'Guest',color:'#abcdef',token}));const wait=async predicate=>{const start=Date.now();while(Date.now()-start<4000){const i=inbox.findIndex(predicate);if(i>=0)return inbox.splice(i,1)[0];await new Promise(r=>setTimeout(r,20));}throw Error('Missing websocket event: '+JSON.stringify(inbox));};await wait(m=>m.type==='welcome');return {ws,wait,inbox};}
  const host=await join(token),guest=await join();await guest.wait(m=>m.type==='state');
  guest.ws.send(JSON.stringify({type:'control',action:'play'}));assert.match((await guest.wait(m=>m.type==='error')).message,/anfitrião/);
  host.ws.send(JSON.stringify({type:'control',action:'seek',value:42}));const seek=await guest.wait(m=>m.type==='state'&&m.room.revision===1);assert.equal(seek.room.playback.position,42);
  host.ws.send(JSON.stringify({type:'control',action:'play'}));await guest.wait(m=>m.type==='state'&&m.room.revision===2);const late=await join();const state=await late.wait(m=>m.type==='state');assert.equal(state.room.playback.playing,true);assert.equal(state.room.playback.position,42);assert.equal(state.room.members.length,3);assert.equal('hostHash' in state.room,false);
  host.ws.send(JSON.stringify({type:'control',action:'pause'}));assert.equal((await guest.wait(m=>m.type==='state'&&m.room.revision===3)).room.playback.playing,false);
  guest.ws.send(JSON.stringify({type:'move',x:999,z:-999}));const moved=await host.wait(m=>m.type==='move');assert.equal(moved.x,5);assert.equal(moved.z,-3);
 }finally{for(const ws of clients)ws.terminate();proc.kill();await new Promise(r=>proc.once('exit',r));await rm(dir,{recursive:true,force:true});}
});

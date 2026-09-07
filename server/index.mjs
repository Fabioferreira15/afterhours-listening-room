import http from 'node:http';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {WebSocketServer} from 'ws';
import {storage} from './storage.mjs';
import {catalog} from './catalog.mjs';
import {control,position} from './clock.mjs';
const db=await storage(),sources=catalog(db),rooms=new Map(),locks=new Map();
const port=Number(process.env.PORT||3210),origin=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||`http://localhost:${port}`,dev=process.argv.includes('--dev');
const secret=()=>randomBytes(32).toString('hex'),hash=s=>createHash('sha256').update(String(s)).digest('hex');
const send=(ws,data)=>{if(ws.readyState===1)ws.send(JSON.stringify(data));};
const clean=(s,n=40)=>String(s||'').replace(/[\u0000-\u001f]/g,'').trim().slice(0,n);
const publicRoom=r=>({id:r.id,name:r.name,revision:r.revision,playback:r.playback,queue:r.queue,requests:r.requests,members:[...r.clients.values()].map(c=>({id:c.id,name:c.name,color:c.color,x:c.x,z:c.z,host:c.host})),serverTime:Date.now()});
const broadcast=r=>{const data={type:'state',room:publicRoom(r)};for(const ws of r.clients.keys())send(ws,data);};
const persist=r=>db.set('room:'+r.id,{...r,clients:undefined});
async function getRoom(id){
 if(!/^[a-f\d]{12}$/.test(id))throw Error('Sala inválida.');
 return serial('load:'+id,async()=>{
  if(rooms.has(id))return rooms.get(id);
  const r=await db.get('room:'+id);if(!r)throw Error('Sala não encontrada.');
  r.clients=new Map();for(const t of r.queue)if(t.status==='matching'){t.status='unavailable';t.reason='Importação interrompida. Volta a importar a playlist.';}
  rooms.set(id,r);return r;
 });
}
function serial(id,fn){const next=(locks.get(id)||Promise.resolve()).catch(()=>{}).then(fn);locks.set(id,next);next.finally(()=>{if(locks.get(id)===next)locks.delete(id)}).catch(()=>{});return next;}
const adminSessions=new Map(),oauthStates=new Map();
function isAdmin(req){const cookie=req.headers.cookie?.match(/(?:^|; )ah_admin=([a-f\d]+)/)?.[1];return cookie&&adminSessions.get(hash(cookie))>Date.now();}
async function body(req){let b='';for await(const c of req){b+=c;if(b.length>16000)throw Error('Pedido demasiado grande.');}return JSON.parse(b||'{}');}
const response=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
const rate=new Map();function allowed(key,limit,period){const now=Date.now(),entry=rate.get(key);if(!entry||now-entry.at>period){rate.set(key,{at:now,count:1});return true;}return ++entry.count<=limit;}
setInterval(()=>{const now=Date.now();for(const [k,v] of rate)if(now-v.at>120000)rate.delete(k);for(const [k,v] of adminSessions)if(v<now)adminSessions.delete(k);for(const [k,v]of oauthStates)if(v.at<now-600000)oauthStates.delete(k);},60000).unref();
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,origin);
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(req.method==='POST'&&req.headers.origin!==origin)return response(res,403,{error:'Origem inválida.'});
  if(url.pathname==='/api/health')return response(res,200,{ok:true,spotifyConfigured:sources.configured(),spotifyConnected:await sources.connected()});
  if(url.pathname==='/api/rooms'&&req.method==='POST'){
   if(!allowed(req.socket.remoteAddress+':create',10,60000))return response(res,429,{error:'Espera um minuto antes de criar outra sala.'});
   const b=await body(req),token=secret(),id=randomBytes(6).toString('hex');const r={id,name:clean(b.name)||'A nossa listening room',hostHash:hash(token),revision:0,playback:{trackId:null,position:0,startedAt:Date.now(),playing:false},queue:[],requests:[],clients:new Map()};await persist(r);rooms.set(id,r);return response(res,201,{id,hostToken:token});
  }
  if(url.pathname==='/api/admin/login'&&req.method==='POST'){
   if(!allowed(req.socket.remoteAddress+':admin',6,60000))return response(res,429,{error:'Demasiadas tentativas.'});const b=await body(req);
   if(!process.env.ADMIN_KEY||!timingSafeEqual(Buffer.from(hash(b.key)),Buffer.from(hash(process.env.ADMIN_KEY))))return response(res,403,{error:'Chave de administrador inválida.'});
   const token=secret();adminSessions.set(hash(token),Date.now()+3600000);res.setHeader('set-cookie',`ah_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600${origin.startsWith('https:')?'; Secure':''}`);return response(res,200,{ok:true});
  }
  if(url.pathname==='/api/spotify/connect'&&req.method==='POST'){
   if(!isAdmin(req))return response(res,403,{error:'Entra como administrador.'});if(!sources.configured())return response(res,503,{error:'Configura as credenciais Spotify no servidor.'});
   const input=await body(req),returnTo=/^[a-f\d]{12}$/.test(input.room||'')?'/?room='+input.room:'/';const state=secret();oauthStates.set(state,{cookie:req.headers.cookie,at:Date.now(),returnTo});const q=new URLSearchParams({client_id:process.env.SPOTIFY_CLIENT_ID,response_type:'code',redirect_uri:origin+'/api/spotify/callback',scope:'playlist-read-private playlist-read-collaborative',state});return response(res,200,{url:'https://accounts.spotify.com/authorize?'+q});
  }
  if(url.pathname==='/api/spotify/callback'){
   const state=url.searchParams.get('state'),entry=oauthStates.get(state);oauthStates.delete(state);
   if(!entry||entry.cookie!==req.headers.cookie||!isAdmin(req)||Date.now()-entry.at>600000)throw Error('Autorização expirada. Repete a ligação.');
   if(!url.searchParams.get('code'))throw Error('Autorização Spotify cancelada.');await sources.exchange(url.searchParams.get('code'),origin+'/api/spotify/callback');res.writeHead(302,{location:entry.returnTo});return res.end();
  }
  if(url.pathname.startsWith('/api/'))return response(res,404,{error:'Rota não encontrada.'});
  if(dev)return vite.middlewares(req,res);
  const root=resolve('dist'),file=resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+'/')){if(url.pathname!=='/')return response(res,403,{error:'Caminho inválido.'});}
  let data;try{data=await readFile(file);}catch{if(extname(url.pathname))return response(res,404,{error:'Ficheiro não encontrado.'});data=await readFile(resolve(root,'index.html'));}
  res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'text/html');res.end(data);
 }catch(e){response(res,400,{error:e.message});}
});
let vite;if(dev){const {createServer}=await import('vite');vite=await createServer({configFile:resolve('vite.config.mjs'),server:{middlewareMode:true,hmr:{server}},appType:'spa'});}
const wss=new WebSocketServer({noServer:true,maxPayload:16384});
server.on('upgrade',(req,socket,head)=>{if(req.url!=='/ws'||req.headers.origin!==origin){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
wss.on('connection',(ws,req)=>{
 let room,member,chain=Promise.resolve(),busy=false;const joinDeadline=setTimeout(()=>{if(!room)ws.close(1008,'Join required');},10000);ws.alive=true;ws.on('pong',()=>ws.alive=true);
 ws.on('message',raw=>{chain=chain.catch(()=>{}).then(async()=>{
  if(!allowed(req.socket.remoteAddress+':ws',1500,10000))throw Error('Demasiados pedidos.');let m=JSON.parse(raw);
  if(m.type==='ping')return send(ws,{type:'pong',t:m.t,serverTime:Date.now()});
  if(!room){if(m.type!=='join')throw Error('Entra numa sala primeiro.');const candidate=await getRoom(m.room);if(candidate.clients.size>=30)throw Error('A sala está cheia.');room=candidate;clearTimeout(joinDeadline);member={id:randomBytes(8).toString('hex'),host:hash(m.token||'')===room.hostHash,name:clean(m.name,24)||'Convidado',color:/^#[a-f\d]{6}$/i.test(m.color)?m.color:'#d79964',x:0,z:3};room.clients.set(ws,member);send(ws,{type:'welcome',id:member.id,host:member.host});broadcast(room);return;}
  if(m.type==='move'){if(Number.isFinite(m.x)&&Number.isFinite(m.z)){member.x=Math.max(-5,Math.min(5,m.x));member.z=Math.max(-3,Math.min(4,m.z));for(const client of room.clients.keys())if(client!==ws)send(client,{type:'move',id:member.id,x:member.x,z:member.z});}return;}
  if(m.type==='search'){if(!allowed(member.id+':search',10,60000))throw Error('Espera um pouco antes de pesquisar novamente.');send(ws,{type:'results',tracks:await sources.search(clean(m.query,150))});return;}
  if(m.type==='request'){
   if(!allowed(member.id+':request',8,60000))throw Error('Já enviaste vários pedidos.');if(room.requests.length>=100)throw Error('A lista de pedidos está cheia.');const link=String(m.url||'');if(link.length>500)throw Error('Link demasiado longo.');
   const u=new URL(link);if(u.protocol!=='https:'||!['open.spotify.com','soundcloud.com','www.soundcloud.com','youtube.com','www.youtube.com','youtu.be'].includes(u.hostname))throw Error('Envia um link Spotify, SoundCloud ou YouTube.');
   return serial(room.id,async()=>{room.requests.push({id:randomBytes(8).toString('hex'),url:link,by:member.name});room.revision++;await persist(room);broadcast(room);});
  }
  if(!member.host)throw Error('Só o anfitrião controla a reprodução e a fila.');
  if(m.type==='import'||m.type==='add'){
   if(busy)throw Error('Aguarda a importação atual.');if(room.queue.length>=200)throw Error('A fila atingiu o limite de 200 faixas.');busy=true;
   (async()=>{try{
    if(m.type==='import'){
     if(!isAdmin(req))throw Error('Só o administrador autenticado pode usar a conta Spotify ligada.');
     const imported=await sources.playlist(m.url);let tracks=imported.tracks.slice(0,200-room.queue.length);
     await serial(room.id,async()=>{room.queue.push(...tracks);room.revision++;await persist(room);broadcast(room);});
     send(ws,{type:'notice',message:`${tracks.length} faixas importadas${imported.truncated?' (limite MVP: 100 por playlist)':''}. A procurar correspondências…`});
     // Bounded, sequential matching respects provider rate limits and permits cancellation on process restart.
     for(const track of tracks){let result;try{result=await sources.match(track);}catch(e){result={...track,status:'unavailable',reason:e.message};}await serial(room.id,async()=>{const i=room.queue.findIndex(t=>t.id===track.id);if(i>=0){room.queue[i]=result;room.revision++;await persist(room);broadcast(room);}});}
    }else{
     let track;if(m.audiusId){const candidates=await sources.search(clean(m.query,150));track=candidates.find(t=>t.sourceId===m.audiusId);if(!track)throw Error('Faixa já não disponível.');}else track=await sources.direct(m.url);
     await serial(room.id,async()=>{room.queue.push(track);room.revision++;await persist(room);broadcast(room);});
    }
   }finally{busy=false;}})().catch(e=>send(ws,{type:'error',message:e.message}));return;
  }
  return serial(room.id,async()=>{
   if(m.type==='control'){if(m.action==='ended'){if(m.trackId!==room.playback.trackId)return;control(room,'next');}else control(room,m.action,m.value);}
   else if(m.type==='approve'){const t=room.queue.find(t=>t.id===m.id),c=t?.candidates?.[m.index];if(!c)throw Error('Correspondência inválida.');Object.assign(t,c,{id:t.id,duration:c.duration||0,status:'ready',candidates:undefined});room.revision++;}
   else if(m.type==='dismiss'){room.requests=room.requests.filter(r=>r.id!==m.id);room.revision++;}
   else throw Error('Pedido desconhecido.');
   await persist(room);broadcast(room);
  });
 }).catch(e=>send(ws,{type:'error',message:e.message}));});
 ws.on('close',()=>{clearTimeout(joinDeadline);if(room){room.clients.delete(ws);broadcast(room);}});
 ws.on('error',()=>{});
});
setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}},15000).unref();
setInterval(()=>{for(const r of rooms.values()){const t=r.queue.find(t=>t.id===r.playback.trackId);if(r.playback.playing&&t?.duration&&position(r.playback)>t.duration+.5)serial(r.id,async()=>{control(r,'next');await persist(r);broadcast(r);}).catch(()=>{});}},1000).unref();
server.listen(port,'0.0.0.0',()=>console.log(`Afterhours listening room on ${origin} (${process.env.REDIS_URL?'Redis':'local SQLite'})`));

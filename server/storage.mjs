import {mkdir} from 'node:fs/promises';
export async function storage(){
 if(process.env.REDIS_URL){
  const {createClient}=await import('redis');const db=createClient({url:process.env.REDIS_URL});db.on('error',()=>console.error('Redis indisponível'));await db.connect();
  // One authoritative Node process; fail startup if another instance owns the room engine.
  const owner=crypto.randomUUID();if(!await db.set('afterhours:engine',owner,{NX:true,EX:30}))throw Error('Já existe um servidor autoritativo. Executar apenas uma réplica.');
  const renew=setInterval(async()=>{try{const ok=await db.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('EXPIRE',KEYS[1],30) else return 0 end",{keys:['afterhours:engine'],arguments:[owner]});if(!ok)process.exit(1);}catch{process.exit(1)}},10000);renew.unref();
  return {get:async k=>JSON.parse(await db.get('afterhours:'+k)||'null'),set:async(k,v)=>{await db.set('afterhours:'+k,JSON.stringify(v));}};
 }
 if(process.env.NODE_ENV==='production'&&process.env.ALLOW_EPHEMERAL!=='true')throw Error('REDIS_URL é obrigatório em produção, exceto no MVP gratuito com ALLOW_EPHEMERAL=true.');
 await mkdir('.data',{recursive:true});const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync('.data/local.sqlite');db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 return {get:async k=>JSON.parse(db.prepare('SELECT value FROM kv WHERE key=?').get(k)?.value||'null'),set:async(k,v)=>db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v))};
}

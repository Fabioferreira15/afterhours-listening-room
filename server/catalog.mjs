import {randomUUID,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export async function json(url,options={}){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error(`Fonte indisponível (${r.status})${r.status===429?': limite de pedidos; tenta mais tarde.':''}`);
 return r.json();
}
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function scoreMatch(a,b){
 const exactISRC=a.isrc&&b.isrc&&normalize(a.isrc)===normalize(b.isrc);
 if(exactISRC)return 1;
 if(normalize(a.title)!==normalize(b.title))return 0;
 const artist=normalize(a.artist),other=normalize(b.artist);
 if(!artist||artist!==other)return .45;
 return a.duration&&b.duration&&Math.abs(a.duration-b.duration)>5?.65:.96;
}
export function inviteSource(input){
 const url=new URL(input);
 if(url.protocol!=='https:')throw Error('Usa um link HTTPS.');
 if(['youtube.com','www.youtube.com','youtu.be','m.youtube.com'].includes(url.hostname)){
  const id=url.hostname==='youtu.be'?url.pathname.slice(1):url.searchParams.get('v');
  if(!/^[\w-]{11}$/.test(id||''))throw Error('Usa o link de um vídeo YouTube.');return {provider:'youtube',id,url:`https://www.youtube.com/watch?v=${id}`};
 }
 if(['soundcloud.com','www.soundcloud.com'].includes(url.hostname)&&/^\/[^/]+\/[^/]+\/?$/.test(url.pathname))return {provider:'soundcloud',id:url.pathname,url:url.href};
 throw Error('Usa um link direto de uma faixa SoundCloud ou vídeo YouTube.');
}
export function catalog(store){
 const api=process.env.AUDIUS_API_URL||'https://api.audius.co/v1';
 const key=process.env.TOKEN_ENCRYPTION_KEY;
 function encrypt(data){if(!/^[a-f\d]{64}$/i.test(key||''))throw Error('Configura TOKEN_ENCRYPTION_KEY (32 bytes em hexadecimal).');const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const body=Buffer.concat([c.update(JSON.stringify(data)),c.final()]);return {iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex'),data:body.toString('hex')};}
 function decrypt(v){const d=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(v.iv,'hex'));d.setAuthTag(Buffer.from(v.tag,'hex'));return JSON.parse(Buffer.concat([d.update(Buffer.from(v.data,'hex')),d.final()]).toString());}
 async function tokenRequest(body){return json('https://accounts.spotify.com/api/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')},body:new URLSearchParams(body)});}
 async function saveToken(t,previous){await store.set('spotify',encrypt({...t,refresh_token:t.refresh_token||previous,expiresAt:Date.now()+t.expires_in*1000}));}
 async function token(){const encrypted=await store.get('spotify');if(!encrypted)throw Error('O administrador precisa de ligar o Spotify primeiro.');let t=decrypt(encrypted);if(t.expiresAt<Date.now()+60000){const fresh=await tokenRequest({grant_type:'refresh_token',refresh_token:t.refresh_token});await saveToken(fresh,t.refresh_token);t=fresh;}return t.access_token;}
 const audiusTrack=t=>({id:randomUUID(),provider:'audius',sourceId:t.id,title:t.title,artist:t.user?.name||'',duration:t.duration||0,isrc:t.isrc||'',cover:t.artwork?.['480x480']||'',url:t.permalink||`https://audius.co${t.user?.handle?'/'+t.user.handle:''}`,stream:`${api}/tracks/${encodeURIComponent(t.id)}/stream?app_name=Afterhours`,status:'ready'});
 return {
  configured:()=>Boolean(process.env.SPOTIFY_CLIENT_ID&&process.env.SPOTIFY_CLIENT_SECRET&&key),
  connected:async()=>!!await store.get('spotify'),
  exchange:async(code,redirect)=>saveToken(await tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirect})),
  async search(query){const result=await json(`${api}/tracks/search?query=${encodeURIComponent(query.slice(0,150))}&limit=12&app_name=Afterhours`,{headers:process.env.AUDIUS_API_KEY?{'x-api-key':process.env.AUDIUS_API_KEY}:{}});return (result.data||[]).filter(t=>!t.is_stream_gated&&!t.is_unlisted&&!t.is_delete).map(audiusTrack);},
  async match(track){
   let candidates=[];try{candidates=await this.search(`${track.artist} ${track.title}`);}catch{/* Continue to the alternative providers when Audius is unavailable. */}const ranked=candidates.map(t=>({...t,score:scoreMatch(track,t)})).sort((a,b)=>b.score-a.score);
   if(ranked[0]?.score>=.95)return {...track,...ranked[0],id:track.id,spotifyUrl:track.spotifyUrl,matchScore:ranked[0].score};
   // SoundCloud search requires an approved API client; only embeddable streams are eligible.
   if(process.env.SOUNDCLOUD_ACCESS_TOKEN){try{const r=await json(`https://api.soundcloud.com/tracks?q=${encodeURIComponent(track.artist+' '+track.title)}&limit=8`,{headers:{authorization:`OAuth ${process.env.SOUNDCLOUD_ACCESS_TOKEN}`}});for(const t of Array.isArray(r)?r:r.collection||[]){const candidate={title:t.title,artist:t.user?.username,duration:t.duration/1000,isrc:t.publisher_metadata?.isrc};if(t.streamable&&t.embeddable_by!=='none'&&scoreMatch(track,candidate)>=.95)return {...track,provider:'soundcloud',sourceId:String(t.id),url:t.permalink_url,cover:t.artwork_url||'',status:'ready'};}}catch{/* Source failure is recorded below, never invent a match. */}}
   if(process.env.YOUTUBE_API_KEY){try{const r=await json(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=3&q=${encodeURIComponent(track.artist+' '+track.title)}&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`);return {...track,status:'review',candidates:(r.items||[]).map(t=>({provider:'youtube',sourceId:t.id.videoId,url:`https://www.youtube.com/watch?v=${t.id.videoId}`,title:t.snippet.title,artist:t.snippet.channelTitle,cover:t.snippet.thumbnails?.medium?.url||''}))};}catch{}}
   return {...track,status:ranked.length?'review':'unavailable',candidates:ranked.slice(0,3)};
  },
  async playlist(link){
   const url=new URL(link);if(url.hostname!=='open.spotify.com')throw Error('Usa um link open.spotify.com/playlist/…');
   const id=url.pathname.match(/\/playlist\/([a-zA-Z0-9]{22})/)?.[1];if(!id)throw Error('Link de playlist inválido.');const auth={authorization:`Bearer ${await token()}`};
   const meta=await json(`https://api.spotify.com/v1/playlists/${id}`,{headers:auth});if(!meta.items&&!meta.tracks)throw Error('O Spotify não disponibiliza as faixas desta playlist. No modo de desenvolvimento, usa uma playlist tua ou em que sejas colaborador.');let next=`https://api.spotify.com/v1/playlists/${id}/items?limit=50`,tracks=[];
   while(next&&tracks.length<100){const result=await json(next,{headers:auth});for(const item of result.items||[]){const t=item.item||item.track;if(t?.type==='track')tracks.push({id:randomUUID(),title:t.name,artist:t.artists?.map(a=>a.name).join(', ')||'',duration:t.duration_ms/1000,isrc:t.external_ids?.isrc||'',spotifyUrl:t.external_urls?.spotify||`https://open.spotify.com/track/${t.id}`,status:'matching'});}next=result.next;if(next&&!next.startsWith('https://api.spotify.com/v1/'))throw Error('Paginação inválida.');}
   return {name:meta.name,tracks:tracks.slice(0,100),truncated:!!next};
  },
  async direct(link){const source=inviteSource(link);const endpoint=source.provider==='youtube'?`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(source.url)}`:`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(source.url)}`;const data=await json(endpoint);return {id:randomUUID(),provider:source.provider,sourceId:source.id,url:source.url,title:data.title,artist:data.author_name||'',cover:data.thumbnail_url||'',duration:0,status:'ready'};}
 };
}

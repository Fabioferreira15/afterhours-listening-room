export function position(playback, now=Date.now()) {
 return Math.max(0,playback.position+(playback.playing?Math.max(0,now-playback.startedAt)/1000:0));
}
export function control(room,action,value,now=Date.now()) {
 const p=room.playback,track=room.queue.find(t=>t.id===p.trackId);
 if(action==='pause'){p.position=position(p,now);p.playing=false;}
 else if(action==='play'){if(!track)throw Error('Escolhe uma faixa primeiro.');p.position=position(p,now);p.startedAt=now+250;p.playing=true;}
 else if(action==='seek'){if(!track||!Number.isFinite(value))throw Error('Posição inválida.');p.position=Math.max(0,Math.min(track.duration||86400,value));p.startedAt=now+250;}
 else if(action==='select'||action==='next'){
  const index=room.queue.findIndex(t=>t.id===p.trackId);
  const next=action==='select'?room.queue.find(t=>t.id===value):room.queue.slice(index+1).find(t=>t.status==='ready');
  if(next&&next.status!=='ready')throw Error('Esta faixa ainda não está disponível.');
  Object.assign(p,{trackId:next?.id||null,position:0,startedAt:now+350,playing:!!next});
 }else throw Error('Comando desconhecido.');
 room.revision++;
}
export function driftAction(error,rateSupported=true){
 if(Math.abs(error)>.75)return {seek:true,rate:1};
 return {seek:false,rate:rateSupported&&Math.abs(error)>.12?(error>0?1.025:.975):1};
}

import React,{useEffect,useRef,useState} from 'react';
import {driftAction,position} from '../server/clock.mjs';
const scripts=new Map();function script(src){if(!scripts.has(src))scripts.set(src,new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(Error('Não foi possível carregar o player.'));document.head.appendChild(el);}));return scripts.get(src);}
export default function Player({track,playback,serverNow,onEnded,onStatus,enabled}){
 const container=useRef(),adapter=useRef(),latest=useRef(),generation=useRef(0);latest.current={track,playback,serverNow,onEnded,onStatus,enabled};const [error,setError]=useState('');
 useEffect(()=>{
  const version=++generation.current;let destroyed=false,cleanup=()=>{};setError('');adapter.current=null;container.current.replaceChildren();
  if(!track)return;
  const active=()=>!destroyed&&generation.current===version;
  const fail=()=>{if(active()){setError('Esta fonte não conseguiu reproduzir a faixa. O anfitrião pode saltar para a próxima.');onStatus('Reprodução indisponível');}};
  async function setup(){
   if(track.provider==='audius'){
    const audio=document.createElement('audio');audio.preload='auto';audio.src=track.stream;container.current.appendChild(audio);audio.addEventListener('error',fail);audio.addEventListener('ended',()=>latest.current.onEnded(track.id));
    audio.addEventListener('loadedmetadata',()=>{if(active())adapter.current={play:()=>audio.play(),pause:()=>audio.pause(),get:async()=>audio.currentTime,seek:t=>audio.currentTime=t,rate:r=>audio.playbackRate=r,duration:()=>audio.duration};});cleanup=()=>{audio.pause();audio.removeAttribute('src');audio.load();};
   }else if(track.provider==='youtube'){
    await script('https://www.youtube.com/iframe_api');await new Promise((resolve,reject)=>{const start=Date.now();const check=()=>{if(window.YT?.Player)return resolve();if(Date.now()-start>15000)return reject(Error('Player indisponível'));setTimeout(check,100);};check();});if(!active())return;
    const node=document.createElement('div');container.current.appendChild(node);const player=new window.YT.Player(node,{width:'100%',height:220,videoId:track.sourceId,playerVars:{playsinline:1,origin:location.origin},events:{onReady:()=>{if(active())adapter.current={play:()=>player.playVideo(),pause:()=>player.pauseVideo(),get:async()=>player.getCurrentTime(),seek:t=>player.seekTo(t,true),duration:()=>player.getDuration()};},onStateChange:e=>{if(e.data===0&&active())latest.current.onEnded(track.id);},onAutoplayBlocked:()=>latest.current.onStatus('Carrega em Ativar som ou no player.'),onError:fail}});cleanup=()=>player.destroy();
   }else if(track.provider==='soundcloud'){
    await script('https://w.soundcloud.com/player/api.js');if(!active())return;const frame=document.createElement('iframe');frame.width='100%';frame.height='220';frame.allow='autoplay';frame.title='Player oficial SoundCloud';frame.src='https://w.soundcloud.com/player/?url='+encodeURIComponent(track.url)+'&auto_play=false';container.current.appendChild(frame);
    const widget=window.SC.Widget(frame);widget.bind(window.SC.Widget.Events.READY,()=>{if(active())adapter.current={play:()=>widget.play(),pause:()=>widget.pause(),get:()=>new Promise(resolve=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;resolve(NaN)}},500);widget.getPosition(ms=>{if(!done){done=true;clearTimeout(timer);resolve(ms/1000)}});}),seek:t=>widget.seekTo(t*1000)};});widget.bind(window.SC.Widget.Events.FINISH,()=>latest.current.onEnded(track.id));widget.bind(window.SC.Widget.Events.ERROR,fail);cleanup=()=>{widget.pause();widget.unbind(window.SC.Widget.Events.READY);widget.unbind(window.SC.Widget.Events.FINISH);widget.unbind(window.SC.Widget.Events.ERROR);};
   }
  }setup().catch(fail);return()=>{destroyed=true;adapter.current=null;cleanup();};
 },[track?.id,track?.sourceId]);
 useEffect(()=>{const activate=e=>{const a=adapter.current;if(a){if(e.detail){try{Promise.resolve(a.play()).catch(()=>latest.current.onStatus('Carrega no player para ativar o som.'));}catch{}}else a.pause();}};window.addEventListener('afterhours-audio',activate);return()=>window.removeEventListener('afterhours-audio',activate);},[]);
 useEffect(()=>{let busy=false;const timer=setInterval(async()=>{const a=adapter.current,l=latest.current;if(!a||!l.playback||busy)return;busy=true;try{
  if(!l.enabled){a.pause();return;}const now=l.serverNow(),expected=position(l.playback,now),actual=await a.get();if(a!==adapter.current||!Number.isFinite(actual))return;
  const delta=expected-actual,action=driftAction(delta,!!a.rate);if(action.seek)a.seek(expected);a.rate?.(action.rate);
  if(l.playback.playing&&now>=l.playback.startedAt){await a.play();l.onStatus(`Desvio estimado ${Math.round(Math.abs(delta)*1000)} ms`);}else{a.pause();if(Math.abs(delta)>.12)a.seek(expected);l.onStatus('Em pausa');}
 }catch{latest.current.onStatus('Carrega em Ativar som ou no player.');}finally{busy=false;}},700);return()=>clearInterval(timer);},[]);
 return <div className={`provider-player ${track?.provider==='audius'?'audio-only':''}`}><div ref={container}/>{error&&<p role="alert">{error}</p>}{track&&<a href={track.url} target="_blank" rel="noreferrer">Ouvir em {track.provider} ↗</a>}</div>;
}

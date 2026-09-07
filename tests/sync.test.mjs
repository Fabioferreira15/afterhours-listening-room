import {test} from 'node:test';
import assert from 'node:assert/strict';
import {position,control,driftAction} from '../server/clock.mjs';
import {scoreMatch,inviteSource} from '../server/catalog.mjs';
test('central clock freezes while paused and schedules a future start',()=>{
 const r={revision:0,queue:[{id:'one',status:'ready',duration:120}],playback:{trackId:'one',position:12,startedAt:1000,playing:true}};
 assert.equal(position(r.playback,6000),17);control(r,'pause',null,6000);assert.equal(position(r.playback,9000),17);
 control(r,'play',null,9000);assert.equal(position(r.playback,9100),17);assert.equal(position(r.playback,10250),18);
 control(r,'seek',500,11000);assert.equal(r.playback.position,120);
});
test('next skips unavailable and unconfirmed tracks',()=>{
 const r={revision:0,queue:[{id:'one',status:'ready'},{id:'bad',status:'unavailable'},{id:'review',status:'review'},{id:'two',status:'ready'}],playback:{trackId:'one',position:0,playing:false}};
 control(r,'next',null,1000);assert.equal(r.playback.trackId,'two');assert.throws(()=>control(r,'select','review'),/disponível/);
});
test('drift deadband, small correction, hard resync',()=>{
 assert.deepEqual(driftAction(.03),{seek:false,rate:1});assert.equal(driftAction(.3).rate,1.025);assert.equal(driftAction(-.3).rate,.975);assert.equal(driftAction(2).seek,true);assert.equal(driftAction(.3,false).rate,1);
});
test('matching rejects cover/remix and supports ISRC',()=>{
 const t={title:'One Song',artist:'Original Artist',duration:200,isrc:'GB1234567890'};
 assert.equal(scoreMatch(t,{...t,title:'One Song (remix)',isrc:''}),0);
 assert.ok(scoreMatch(t,{...t,artist:'Someone Else',isrc:''})<.95);
 assert.equal(scoreMatch(t,{...t,title:'Other spelling'}),1);
});
test('official-player URLs are allowlisted',()=>{
 assert.equal(inviteSource('https://youtu.be/abcdefghijk').provider,'youtube');assert.throws(()=>inviteSource('https://youtube.com.evil.example/watch?v=abcdefghijk'));assert.throws(()=>inviteSource('javascript:alert(1)'));assert.throws(()=>inviteSource('http://127.0.0.1/'));
});

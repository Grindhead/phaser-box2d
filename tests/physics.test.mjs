import assert from 'node:assert/strict';
import test from 'node:test';
import {CreateWorld,CreateCircle,SpriteToCircle,CreateChain,WorldStep,SetWorldScale} from '../src/physics.js';
import {b2DefaultWorldDef,b2BodyType} from '../src/include/types_h.js';
import {b2Vec2} from '../src/include/math_functions_h.js';
import {b2DestroyWorld} from '../src/include/world_h.js';
import {b2Body_GetPosition,b2Body_SetLinearVelocity} from '../src/include/body_h.js';
import {worldStepState} from '../src/world-step-state.js';
function world(){const worldDef=b2DefaultWorldDef();worldDef.gravity=new b2Vec2(0,0);const {worldId}=CreateWorld({worldDef});const body=CreateCircle({worldId,type:b2BodyType.b2_dynamicBody,radius:1,density:1});b2Body_SetLinearVelocity(body.bodyId,new b2Vec2(1,0));return {worldId,body};}
test('independent worlds each accumulate alternating 120Hz calls',()=>{
 const a=world(),b=world();try{
  for(let count=0;count<6;count++){WorldStep({worldId:a.worldId,deltaTime:1/120});WorldStep({worldId:b.worldId,deltaTime:1/120});}
  assert.ok(Math.abs(b2Body_GetPosition(a.body.bodyId).x-0.05)<1e-6);assert.ok(Math.abs(b2Body_GetPosition(b.body.bodyId).x-0.05)<1e-6);
 }finally{b2DestroyWorld(a.worldId);b2DestroyWorld(b.worldId);}
});
test('30, 60 and 120Hz advance one second of physics consistently',()=>{
 for(const hz of [30,60,120]){const w=world();try{for(let count=0;count<hz;count++)WorldStep({worldId:w.worldId,deltaTime:1/hz});assert.ok(Math.abs(b2Body_GetPosition(w.body.bodyId).x-1)<1e-6,`Hz ${hz}`);}finally{b2DestroyWorld(w.worldId);}}
});
test('long frames have bounded catch-up and disposal removes timing state',()=>{
 const w=world();WorldStep({worldId:w.worldId,deltaTime:10});assert.ok(b2Body_GetPosition(w.body.bodyId).x<=4/60+1e-6);assert.ok(worldStepState.has(w.worldId.index1));b2DestroyWorld(w.worldId);assert.equal(worldStepState.has(w.worldId.index1),false);
 const fresh=world();try{WorldStep({worldId:fresh.worldId,deltaTime:1/120});assert.equal(b2Body_GetPosition(fresh.body.bodyId).x,0);}finally{b2DestroyWorld(fresh.worldId);}
});
test('sprite circles have a real scaled radius and preserve overrides',()=>{
 SetWorldScale(30);const w=world();try{
  const sprite={width:60,height:90,x:0,y:0,rotation:0,scaleX:1,scaleY:1};
  assert.equal(SpriteToCircle(w.worldId,sprite).object.radius,1);
  assert.equal(SpriteToCircle(w.worldId,{...sprite,scaleX:-2,scaleY:2}).object.radius,2);
  assert.equal(SpriteToCircle(w.worldId,sprite,{radius:3}).object.radius,3);
 }finally{b2DestroyWorld(w.worldId);}
});
test('chain defaults create finite endpoints and reject impossible dimensions',()=>{
 const w=world();try{
  const settings={worldId:w.worldId,firstLinkPosition:new b2Vec2(0,0),lastLinkPosition:new b2Vec2(4,0),chainLinks:2,linkLength:2,fixEnds:false};
  for(const link of CreateChain(settings)){assert.equal(link.object.radius,0.5);assert.ok(Number.isFinite(link.object.center1.x));assert.ok(Number.isFinite(link.object.center2.x));}
  assert.throws(()=>CreateChain({...settings,linkLength:0.5}),RangeError);
 }finally{b2DestroyWorld(w.worldId);}
});

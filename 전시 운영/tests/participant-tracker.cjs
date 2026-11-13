const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../skateboardword/participant-tracker.js'),'utf8'),context);
const Tracker=vm.runInContext('ParticipantTracker',context),tracker=new Tracker();
const blue=[.1,.2,.8,.1,.1,.2],red=[.8,.1,.1,.6,.1,.1];
function person(x,color,index=0,height=.7){return {index,x,y:.45,height,appearance:color.slice(),points:[]}}
let result=tracker.select([person(.4,blue),person(.8,red,1)],0);assert.equal(result.index,0);const id=result.id;
// Detection array order is not an identity. Keep the original even when someone gets closer.
result=tracker.select([person(.52,red,0),person(.41,blue,1)],100);assert.equal(result.index,1);assert.equal(result.id,id);
// Both people overlap; clothing similarity prevents jumping to the other track.
result=tracker.select([person(.42,red,0),person(.42,blue,1)],200);assert.equal(result.index,1);
result=tracker.select([person(.43,blue,0),person(.35,red,1)],300);assert.equal(result.index,0);
// One missing result or a short occlusion must not hand control to a bystander.
result=tracker.select([person(.44,red)],700);assert.equal(result.index,null);assert.equal(result.locked,true);assert.equal(result.missing,true);
result=tracker.select([person(.45,blue,1),person(.46,red,0)],900);assert.equal(result.index,1);assert.equal(result.id,id);
result=tracker.select([person(.47,red)],2000);assert.equal(result.index,null);assert.equal(result.id,id);
result=tracker.select([person(.48,red)],2400);assert.equal(result.index,0);assert.ok(result.id>id);assert.equal(result.missing,false);
// An empty frame releases the old track after the same grace period.
result=tracker.select([],4100);assert.equal(result.locked,false);assert.equal(result.index,null);
result=tracker.select([person(.2,blue)],4200);assert.equal(result.index,0);
const points=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));
for(const [i,x,y]of [[0,.5,.15],[11,.45,.3],[12,.55,.3],[23,.46,.5],[24,.54,.5],[27,.45,.9],[28,.55,.9]])points[i]={x,y,visibility:1};
assert.ok(tracker.candidate(points,0));assert.equal(tracker.candidate([],0),null);
console.log('PASS: lock survives reordered detections, closer bystanders, overlap and brief loss; replacement after 1.5 seconds');

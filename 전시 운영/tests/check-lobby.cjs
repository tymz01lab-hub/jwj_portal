const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.resolve(__dirname, '../../skateboardword/index.html'), 'utf8');
const code = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)[1];
const resetCode = html.match(/<script id="exhibition-reset">([\s\S]*?)<\/script>/)[1];
let resetHandler, reloads=0, prevented=0;
vm.runInNewContext(resetCode,{window:{addEventListener(type,handler,capture){assert.equal(type,'keydown');assert.equal(capture,true);resetHandler=handler},location:{reload(){reloads++}}}});
const resetEvent={code:'KeyR',preventDefault(){prevented++}};
resetHandler(resetEvent);assert.equal(reloads,1);assert.equal(prevented,1);
for(const extra of [{code:'Space'},{repeat:true},{ctrlKey:true},{altKey:true},{metaKey:true},{target:{closest(){return {}}}}])resetHandler({...resetEvent,...extra});
assert.equal(reloads,1,'R is isolated from repeat, browser shortcuts and text editing');
assert.ok(html.indexOf('id="exhibition-reset"')<html.indexOf('id="app-script"'),'Reset survives main-app initialization failure');
const calls = [];
function element(id = '') {
  const drawing = new Proxy({}, {
    get(target, key) { if(key==='createLinearGradient')return ()=>({addColorStop(){}});return target[key] ?? ((...args) => calls.push({ id, key, args })); },
    set(target, key, value) { calls.push({ id, key, value }); target[key] = value; return true; }
  });
  return {
    id, hidden: false, disabled: false, style: {}, children: [], attributes: {}, width: 1280, height: 720,
    clientWidth: 1280, clientHeight: 720, textContent: '', videoWidth: 640, videoHeight: 480,
    getContext: () => drawing, append(child) { this.children.push(child); },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; }, focus() {}, play: async () => {},
    toBlob(callback) { callback({png:true}); },
    get firstChild() { return this.children[0]; }
  };
}
const elements = {};
for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
  elements[match[1]] = element(match[1]);
  elements[match[1]].hidden = /\bhidden\b/.test(match[0]);
}
const events = {};
const timers=new Map();let timerId=0;
let requests = 0,uploads=0;
const context = vm.createContext({
  ...elements, console, now: 1000,
  performance: { now: () => context.now },
  window: { devicePixelRatio: 1 },
  document: {
    hidden: false, querySelector: selector => selector==='.lobby-heading'?heading:elements[selector.slice(1)],
    createElement: type => element(type), addEventListener: (type, callback) => { events[type] = callback; }
  },
  navigator: { mediaDevices: { getUserMedia: async () => { requests++; throw Object.assign(new Error('test denial'), { name: 'NotAllowedError' }); } } },
  fetch: async () => {uploads++;return {ok:true,json:async()=>({url:'/__exhibition/photos/test',expiresAt:Date.now()+3600000})}},
  requestAnimationFrame() {}, addEventListener() {}, ResizeObserver: class { observe() {} },
  setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,delay});return id},clearTimeout(id){timers.delete(id)},
  Image: class { constructor() { this.naturalWidth = 0; } },
  Path2D: class { moveTo() {} lineTo() {} closePath() {} },
  AudioContext: class { get currentTime() { return 0; } resume() { return Promise.resolve(); } }
});
const run = source => vm.runInContext(source, context);
const heading=element('heading');
const fresh = time => {
  context.now = time;
  run('updateFinishPerson({poseLandmarks:points,segmentationMask:{mask:true},image:{frame:true}})');
  run('drawSelection(now)');
};
(async () => {
  vm.runInContext(code, context);
  run("var qaJumpCount=0,qaOriginalJump=jump,qaOriginalEnter=enter; jump=function(){const grounded=!!rider?.line;qaOriginalJump();if(grounded&&!rider.line)qaJumpCount++};enter=function(t){qaJumpCount=0;qaOriginalEnter(t)}");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 1, 'Camera requested from initial screen');
  assert.match(run('lobbyStatus'), /카메라 사용을 허용/);
  assert.equal(elements.choiceCamera.disabled, false, 'Retry available after permission denial');
  assert.equal(elements.cards.children.length, 3);
  assert.equal(elements.menu.hidden, false);
  run('drawSelection(now)');
  assert.equal(run('selectedTheme'), null);
  assert.equal(run('lobbyLayout(1280,720).point({x:0,y:0}).x > lobbyLayout(1280,720).point({x:1,y:0}).x'), true, 'Mirrored coordinates');
  run(`var points=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));
    points[0]={x:.5,y:.16,visibility:1};
    points[11]={x:.6,y:.35,visibility:1};points[12]={x:.4,y:.35,visibility:1};
    points[13]={x:.72,y:.3,visibility:1};
    var layout=lobbyLayout(1280,720),target=rackBoards(1280,720)[0];
    points[15]={x:(layout.ox-target.x)/(layout.iw*layout.ratio),y:.16,visibility:1};
    points[19]={...points[15]};`);
  fresh(1000);
  assert.equal(run('!!lobbyPerson'), true, 'Upper body works without feet');
  assert.equal(run('finishPerson'), null, 'Game finish keeps full-body requirement');
  fresh(1549);
  assert.equal(run('selectedTheme'), null, 'Brief pass does not select');
  fresh(1550);
  assert.equal(run('selectedTheme.word'), '해');
  assert.equal(run('heldWrist'), 15);
  assert.equal(elements.countdownNumber.textContent, '5');
  assert.equal(elements.countdownPanel.hidden, false);
  assert.equal(run('previewStartedAt'), 1550);
  run('updateCountdown(2550,true);chooseBoard(themes[0]);');
  assert.equal(elements.countdownNumber.textContent, '4');
  assert.equal(run('previewStartedAt'), 1550, 'Same board does not restart timer');
  run(`var target=rackBoards(1280,720)[1];points[15].x=(layout.ox-target.x)/(layout.iw*layout.ratio);points[19].x=points[15].x`);
  fresh(3500);fresh(4050);
  assert.equal(run('selectedTheme.word'), '달', 'Other board can be selected in preview');
  assert.equal(run('previewStartedAt'), 4050);
  assert.equal(elements.countdownNumber.textContent, '5');
  run('updateCountdown(9049,true)');
  assert.equal(run('active'), false, 'No premature start');
  assert.equal(elements.countdownNumber.textContent, '1');
  run('updateCountdown(9050,true)');
  assert.equal(run('active'), false, 'Selection leads to learning before park');
  assert.equal(elements.menu.hidden, true);
  assert.equal(elements.lesson.hidden, false);
  assert.equal(run('stage'),2);
  run(`var tutorialPose=Array.from({length:33},()=>({x:.5,y:.3,visibility:0}));tutorialPose[0]={x:.5,y:.2,visibility:1};
    for(const [i,x,y]of [[11,.65,.3],[12,.35,.3],[23,.45,.5],[24,.55,.5],[25,.45,.7],[26,.55,.7],[27,.45,.88],[28,.55,.88],[29,.44,.9],[30,.54,.9],[31,.48,.92],[32,.58,.92]])tutorialPose[i]={x,y,visibility:1};resetMotion();`);
  for(let time=10000;time<=10700;time+=50){context.now=time;run('measure(tutorialPose)')}
  context.now=10750;run('for(const i of [27,28,29,30,31,32])tutorialPose[i].y-=.07;tutorialPose[23].y=tutorialPose[24].y=.45;measure(tutorialPose)');
  context.now=10800;run('measure(tutorialPose)');
  assert.equal(run('learning.jump'),true,'Learning recognizes real two-foot pose sequence');
  assert.equal(run('qaJumpCount'),0,'Practice jump does not count as park trick');
  run('tutorialPose[27].x=.4;tutorialPose[28].x=.6;updateStance(tutorialPose,10850);updateStance(tutorialPose,11400)');
  assert.equal(run('learning.stance'),true,'Learning recognizes feet-apart hold');
  context.now=13400;run('drawLesson(performance.now())');
  assert.equal(run('stage'),3,'Both lessons lead to park');assert.equal(run('active'),true);
  assert.equal(elements.ride.hidden,false);
  assert.equal(run('theme.word'), '달');
  run('draw()');
  assert.ok(run('rails.length') > 0, 'Game collision course built');
  run('back.onclick()');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run('active'), false);
  assert.equal(elements.menu.hidden, false);
  assert.equal(run('selectedTheme'), null);
  run('chooseBoard(themes[2]);updateCountdown(10000,true);updateCountdown(14500,false)');
  assert.equal(run('active'), false);
  assert.equal(run('previewStartedAt'), null, 'Missing person resets timer');
  assert.equal(elements.countdownNumber.textContent, '5');
  run('updateCountdown(15000,true);document.hidden=true');events.visibilitychange();
  fresh(30000);
  assert.equal(run('active'), false, 'Hidden screen cannot auto start');
  run('document.hidden=false;updateFinishPerson({poseLandmarks:null});drawSelection(30000)');
  assert.ok(run('lobbyPerson'),'Brief tracking loss does not erase visible person');
  context.now=32001;run('updateFinishPerson({poseLandmarks:null});drawSelection(performance.now())');
  assert.equal(run('lobbyPerson'), null);
  assert.equal(run('reach'), null, 'Lost tracking clears pending contact');
  run('clearBoard()');
  assert.equal(elements.countdownPanel.hidden, true);
  assert.equal(elements.startRide.hidden, true);
  assert.ok(calls.some(call => call.key === 'globalCompositeOperation' && call.value === 'destination-in'), 'Person mask applied');
  assert.ok(!calls.some(call => call.id === 'holding' && call.key === 'drawImage' && call.args[0] === elements.cam), 'Lobby never draws the webcam rectangle');
  assert.ok(calls.some(call => call.id === 'holding' && call.key === 'rotate' && call.args[0] === Math.PI / 2), 'Vertical deck rendered');
  assert.match(html, /데크 디자인을 골라보세요!/);
  context.now = 40000;
  run('updateFinishPerson({poseLandmarks:points,segmentationMask:{},image:{}})');
  assert.equal(run('drawLiveRider()'), true, 'Upper-body camera image also appears in game');
  run(`points[23]={x:.45,y:.6,visibility:1};points[24]={x:.55,y:.6,visibility:1};
    for(const i of [27,28,29,30,31,32])points[i]={x:i%2?.45:.55,y:i>30?.95:.9,visibility:1};
    updateFinishPerson({poseLandmarks:points,segmentationMask:{},image:{}});`);
  const personImage = run('personCutout');
  for(let i=0;i<3;i++) {
    calls.length = 0;
    run('enter(themes['+i+']);draw()');
    assert.ok(calls.some(call => call.id === 'scene' && call.key === 'drawImage' && call.args[0] === personImage), 'Live person rendered in game ' + i);
  }
  calls.length = 0;
  assert.equal(run('drawLiveRider()'), true);
  const offset = calls.find(call => call.id === 'scene' && call.key === 'translate').args;
  const scale = calls.find(call => call.id === 'scene' && call.key === 'scale').args;
  assert.ok(Math.abs(offset[1] + .95 * 480 * scale[1] + 9) < 1e-8, 'Feet land on top of deck');
  assert.ok(scale[0] < 0 && scale[1] > 0, 'Live person stays mirrored');
  run('audio=null;enter(themes[0]);audio=null;rider.vx=180;step(.02);jump();step(.016)');
  calls.length = 0;run('draw()');
  assert.ok(calls.some(call => call.id === 'scene' && call.key === 'translate' && call.args[0] === run('rider.x') && call.args[1] === run('rider.y')), 'Person is attached to moving/jumping rider');
  assert.ok(calls.some(call => call.id === 'scene' && call.key === 'drawImage' && call.args[0] === personImage));
  run('enter(themes[0]);audio=null');
  for(let i=0;i<3;i++){
    run('resetRide();jump()');assert.equal(run('qaJumpCount'),i+1);
    const x=run('rider.x'),y=run('rider.y');run('step(.03);draw()');
    assert.ok(run('rider.x')>x&&run('rider.y')<y,'Every ollie continues in park immediately');
  }
  assert.doesNotMatch(code,/ollieMoment|ollieView|startOllieMoment|closeUp/,'All closeup code removed');
  assert.doesNotMatch(html,/id="ollieMoment"/,'Closeup overlay removed');
  assert.equal(uploads,0,'No uploads');
  context.now = run('lobbyPerson.time')+2001;
  assert.equal(run('drawLiveRider()'), false, 'Stale camera image uses keyboard character fallback');
  // A distant/turned face must not gate body display or the two studio modes.
  context.now=45000;
  run(`var studioPoints=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));
    for(const [i,x,y]of [[0,.5,.2],[11,.43,.35],[12,.57,.35],[13,.36,.45],[14,.64,.45],[15,.32,.6],[16,.68,.6],[19,.32,.62],[20,.68,.62],[23,.46,.55],[24,.54,.55],[25,.45,.72],[26,.55,.72],[27,.44,.88],[28,.56,.88],[29,.43,.9],[30,.55,.9],[31,.46,.92],[32,.58,.92]])studioPoints[i]={x,y,visibility:1};
    studioPoints[0].visibility=.1;lobbyPerson=null;updateFinishPerson({poseLandmarks:studioPoints,segmentationMask:{},image:{}});openStudio();`);
  assert.equal(run('!!previewPerson(studioCanvas.getContext("2d"),studioCanvas,performance.now()).person'),true,'Low face visibility keeps masked body');
  const nearView=run('studioCameraView(performance.now())');
  run('var nearPose=studioPoints.map(p=>({...p}));for(const p of studioPoints){p.x=.5+(p.x-.5)*.5;p.y=.5+(p.y-.5)*.5}lobbyPerson=null;updateFinishPerson({poseLandmarks:studioPoints,segmentationMask:{},image:{}})');
  const farView=run('studioCameraView(performance.now())');
  assert.equal(farView.scale,nearView.scale,'Studio keeps the full camera frame at a stable scale');
  const boardPose=()=>run('studioBoardPose(studioCameraView(performance.now()))');
  run('studioHand.onclick()');const held=boardPose();
  run('studioPoints[15].x+=.03;studioPoints[15].y-=.02');const moved=boardPose();
  assert.ok(moved.x<held.x&&moved.y<held.y,'Hand mode follows mirrored wrist movement');
  assert.equal(elements.studioHand.attributes['aria-pressed'],'true');
  run('studioFoot.onclick()');const leftFoot=boardPose();
  run('for(const i of [27,29,31]){studioPoints[i].x+=.03;studioPoints[i].y-=.02}');const leftMoved=boardPose();
  assert.ok(leftMoved.x<leftFoot.x&&leftMoved.y<leftFoot.y,'Foot mode follows anatomical left sole');
  run('for(const i of [28,30,32])studioPoints[i].x-=.05');assert.equal(boardPose().x,leftMoved.x,'Right foot cannot move left-foot deck');
  run('studioPoints[27].visibility=0;drawStudio(performance.now())');assert.equal(boardPose(),null,'Hidden left ankle shows guidance rather than a detached deck');
  context.now+=1000;run('updateFinishPerson({poseLandmarks:null})');
  assert.ok(run('currentPerson(performance.now())'),'One-second detector gap retains person');
  calls.length=0;run('stream={};cam.readyState=2;cam.currentTime=10;refreshPersonVideo(performance.now());lobbyPerson=null;drawStudio(performance.now());stream=null');
  assert.ok(calls.some(call=>call.id==='studioCanvas'&&call.key==='drawImage'&&call.args[0]===elements.cam),'Full live webcam is visible without pose detection');
  assert.ok(!calls.some(call=>call.id==='studioCanvas'&&call.key==='drawImage'&&call.args[0]===run('shopWall')),'Studio does not draw the shop background');
  assert.ok(!calls.some(call=>call.id==='studioCanvas'&&call.key==='drawImage'&&call.args[0]===run('personCutout')),'Studio does not replace video with a cutout');
  calls.length=0;run('makeRoomBackground().userData.update({image:{},segmentationMask:{}})');
  assert.ok(!calls.some(call=>call.key==='getImageData'||call.key==='putImageData'),'Room background avoids CPU pixel readbacks');
  console.log('PASS: full webcam framing, live video without pose detection, hand/left-sole modes, no CPU background loop');
  function standing(){
    run(`var gait=Array.from({length:33},()=>({x:.5,y:.3,visibility:0}));
      gait[0]={x:.5,y:.2,visibility:1};
      for(const [i,x,y] of [[23,.45,.5],[24,.55,.5],[25,.45,.7],[26,.55,.7],[27,.45,.88],[28,.55,.88],[29,.44,.90],[30,.54,.90],[31,.48,.92],[32,.58,.92]])gait[i]={x,y,visibility:1};
      lobbyPerson=null;enter(themes[0]);audio=null;resetMotion();`);
  }
  function feed(time,edit=''){
    context.now=time;if(edit)run(edit);return run('measure(gait)');
  }
  function calibrate(){standing();for(let time=0;time<=700;time+=50)feed(time)}
  calibrate();
  assert.equal(run('rider.vx'),0,'Standing still does not accelerate');
  feed(750,'gait[23].y=gait[24].y=.58;gait[25].x=.53;gait[26].x=.63');
  assert.equal(run('rider.vx'),0,'Knee bend alone is not the final forward control');
  assert.equal(run('qaJumpCount'),0,'Knee bend does not trigger ollie');
  const crouchedSpeed=run('rider.vx');for(let time=800;time<=1400;time+=50)feed(time);
  assert.equal(run('rider.vx'),crouchedSpeed,'Holding a pose does not repeat pushes');
  calibrate();
  feed(750,'gait[27].y-=.04');
  assert.equal(run('rider.vx'),0,'Forward control is feet-apart stance');
  calibrate();
  feed(750,'for(const i of [24,26,28,30,32])gait[i].visibility=0');
  assert.equal(feed(800,'gait[25].x=.54'),true,'One leg still supports body tracking');
  assert.equal(run('rider.vx'),0);
  calibrate();
  run('gait[11]={x:.65,y:.3,visibility:1};gait[12]={x:.35,y:.3,visibility:1};updateStance(gait,750)');
  assert.equal(run('rider.vx'),0,'Feet together do not auto-drive');
  run('gait[27].x=.4;gait[28].x=.6;updateStance(gait,800)');
  const sideSpeed=run('rider.vx');assert.ok(sideSpeed>0,'Feet-apart stance starts driving');
  run('updateStance(gait,850)');assert.equal(run('rider.vx'),sideSpeed,'Auto-drive is rate limited');
  run('updateStance(gait,1300)');assert.ok(run('rider.vx')>sideSpeed,'Holding feet apart keeps driving');
  run('gait[27].x=.45;gait[28].x=.55;gait[11].x=.51;gait[12].x=.49');
  assert.equal(run('isWideStance(gait)'),false,'Turning sideways with feet together is not forward control');
  run('gait[27].x=.4;gait[28].x=.6;gait[28].visibility=0');
  assert.equal(run('isWideStance(gait)'),false,'Missing ankle does not auto-drive');
  run('gait[28].visibility=1');assert.equal(run('isWideStance(gait)'),true,'Body direction does not block feet-apart stance');
  run('for(const p of gait){p.x=.5+(p.x-.5)*.5;p.y=.5+(p.y-.5)*.5}');
  assert.equal(run('isWideStance(gait)'),true,'Stance threshold scales with participant size');
  assert.doesNotMatch(html,/옆으로 서기|몸을 옆으로/,'Old control wording removed');
  calibrate();
  feed(750,'for(const i of [27,29,31])gait[i].y-=.07;gait[23].y=gait[24].y=.45');feed(800);
  assert.equal(run('qaJumpCount'),0,'One foot lift is not an ollie');
  feed(1100,'for(const i of [28,30,32])gait[i].y-=.07');feed(1150);
  assert.equal(run('qaJumpCount'),0,'Feet lifted at separate times are not an ollie');
  calibrate();
  feed(750,'for(const i of [27,28,29,30])gait[i].y-=.04;gait[23].y=gait[24].y=.46');feed(800);
  assert.equal(run('qaJumpCount'),0,'Heels up with toes on floor is not an ollie');
  calibrate();
  feed(750,'for(const i of [27,28,29,30,31,32])gait[i].y-=.07;gait[23].y=gait[24].y=.45');
  assert.equal(run('qaJumpCount'),1,'Short coherent two-foot hop works in a single camera result');feed(800);
  assert.equal(run('qaJumpCount'),1,'Two feet rising together triggers ollie');
  assert.equal(run('rider.line'),null);assert.ok(run('rider.vy')<0);
  calibrate();
  feed(750,'for(const i of [27,28,29,30,31,32])gait[i].y-=.018;gait[23].y=gait[24].y=.492');feed(800);
  assert.equal(run('qaJumpCount'),1,'Gentle two-foot hops trigger ollie');
  run('enter(themes[0]);audio=null;rider.vx=200;qaJumpCount=0;last=1000');
  const slowStart=run('rider.x');run('frame(1034)');
  assert.ok(Math.abs(run('rider.x')-slowStart-3.4)<.001,'Game advances at half the previous pace');
  calibrate();
  feed(750,'for(const i of [27,28,29,30,31,32])gait[i].y-=.07');
  for(let time=800;time<=1550;time+=50)feed(time);
  assert.equal(run('qaJumpCount'),0,'Stepping farther away without rising hips is not a jump');
  feed(1600,'for(const i of [27,28,29,30,31,32])gait[i].y-=.07;gait[23].y=gait[24].y=.45');feed(1650);
  assert.equal(run('qaJumpCount'),1,'Ollie still works after stable floor position changes');
  calibrate();
  for(let time=750;time<=1500;time+=50)feed(time,`for(const i of [27,28,29,30,31,32])gait[i].y=${time%100?'.003':'-.003'}+({27:.88,28:.88,29:.9,30:.9,31:.92,32:.92})[i]`);
  assert.equal(run('qaJumpCount'),0,'Small tracking jitter does not jump');
  assert.equal(run('rider.vx'),0,'Small tracking jitter does not accelerate');
  // Sideways occlusion and lower pose-analysis rates used to miss short hops.
  calibrate();
  feed(750,'for(const i of [29,30,31,32])gait[i].visibility=0;gait[27].visibility=gait[28].visibility=.3');
  feed(1000,'for(const i of [27,28])gait[i].y-=.014;gait[23].y=gait[24].y=.493');
  assert.equal(run('qaJumpCount'),1,'Small hop works with toes hidden and less-confident ankles');
  feed(1100);assert.equal(run('qaJumpCount'),1,'One physical hop only triggers once');
  calibrate();
  feed(900,'for(const i of [27,28,29,30,31,32])gait[i].y-=.014;gait[23].y=gait[24].y=.493');
  assert.equal(run('qaJumpCount'),1,'A single airborne sample at slow pose-analysis rate works');
  calibrate();
  feed(750,'gait[28].visibility=0');
  feed(850,'gait[28].visibility=1;for(const i of [27,28,29,30,31,32])gait[i].y-=.02;gait[23].y=gait[24].y=.49');
  assert.equal(run('qaJumpCount'),1,'Brief ankle occlusion does not erase a ready jump');
  calibrate();
  feed(750,'for(const i of [27,28,29,30,31,32])gait[i].y-=.02');
  assert.equal(run('qaJumpCount'),0,'Feet-only tracking spike without rising body is rejected');
  function crossGap(themeIndex,startX,pathIndex,minY,targetPath){
    run('enter(themes['+themeIndex+']);audio=null;qaJumpCount=0');
    run(`var launchLine=rails.find(line=>line.path===${pathIndex}&&${startX}>=line.a[0]&&${startX}<=line.b[0]&&height(line,${startX})>${minY});
      rider={x:${startX},y:height(launchLine,${startX}),vx:0,vy:0,line:launchLine};jump();last=performance.now()`);
    const started=context.now;let frames=0;
    while(run('!rider.line')&&frames++<240){context.now+=1000/60;run('frame(performance.now())')}
    assert.equal(run('rider.line?.path'),targetPath,'Slower pace still crosses gap in park '+themeIndex);
    assert.ok(context.now-started>1500,'Longer real-time jump window');
  }
  crossGap(1,430,0,300,2);
  crossGap(2,430,0,0,1);
  crossGap(2,905,1,0,3);
  // Follow the connected ㅎ → tilted ㅐ without falling between separate pieces.
  run('enter(themes[0]);audio=null');
  const sunPaths=new Set();let previousX=run('rider.x'),sunFrames=0;
  while(run('stage===3')&&sunFrames++<1800){
    context.now+=1000/60;
    if(sunFrames%27===1)run('propel()');
    run('step(gamePace/60)');
    const x=run('rider.x');assert.ok(x>=previousX,'Sun run never resets from a disconnected piece');previousX=x;
    if(run('rider.line'))sunPaths.add(run('rider.line.path'));
  }
  assert.equal(run('stage'),4,'Connected sun course can be completed');
  assert.ok(sunPaths.has(2)&&sunPaths.has(3),'Rider crosses from ㅎ into tilted ㅐ');
  assert.ok(run('goal')>820,'Sun finish moves to the far end of tilted ㅐ');
  const stem=run('sunAe(0,0).map((v,i)=>v-sunAe(0,295)[i])');
  assert.ok(Math.abs(Math.abs(stem[0])-Math.abs(stem[1]))<1e-8,'ㅐ stems are tilted exactly 45 degrees');
  console.log('PASS: connected 45-degree sun course finishes without a gap/reset');
  for(let index=0;index<3;index++){
    run('enter(themes['+index+']);audio=null;var finishRail=rails.find(line=>goal>=line.a[0]&&goal<=line.b[0]);rider={x:goal-2,y:height(finishRail,goal)-45,vx:240,vy:-180,line:null};step(.02)');
    assert.equal(run('stage'),4,'Crossing the finish during an ollie enters the last screen in park '+index);
    assert.equal(run('active'),false);assert.equal(elements.studio.hidden,false);
    assert.ok(elements.studioLabel.textContent.includes(run('theme.word')),'Last screen keeps selected deck');
    run('drawStudio(performance.now())');
  }
  run('enter(themes[2]);rider.x=goal;rider.line=rails.find(line=>rider.x>=line.a[0]&&rider.x<=line.b[0]);step(0)');
  assert.equal(run('stage'),4,'Park completion enters pose stage');
  assert.equal(run('active'),false);assert.equal(elements.studio.hidden,false);
  run('drawStudio(performance.now());studioReturn.onclick()');
  assert.equal(run('stage'),1,'Pose stage returns to shop');
  assert.equal(uploads,0,'Four-stage flow has no photo recording');
  for(const phase of [1,2,3,4]){
    run('setStage('+phase+');selectedTheme=themes[0];participant={id:1,locked:true,missing:false};motion.ground={27:.9};updateParticipant({id:2,locked:true,missing:false})');
    assert.equal(run('stage'),phase,'Replacement participant continues the current stage');
    assert.equal(run('selectedTheme'),run('themes[0]'),'Replacement keeps the chosen board');
    assert.equal(run('motion.ground'),null,'New participant calibrates their own floor height');
  }
  run('enter(themes[0]);participant={id:2,locked:true,missing:true};rider.vx=200');const pausedX=run('rider.x');
  run('step(.1)');assert.equal(run('rider.x'),pausedX,'Game waits while its locked participant is missing');
  run('participant={id:3,locked:true,missing:false};step(.1)');assert.ok(run('rider.x')>pausedX,'Game continues when a participant is reacquired');
  console.log('PASS: slower movement preserves jump distance across moon and both sea gaps');
  console.log('PASS: two-foot ollie, no crouch/single-foot/heel-lift/jitter jumps, feet-apart auto-drive, short-hop and occlusion recognition');
  console.log('PASS: shop/lesson/park/studio flow, learned controls, continuous ollies without zoom, no recording');
})().catch(error => { console.error(error); process.exitCode = 1; });

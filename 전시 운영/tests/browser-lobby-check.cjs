const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '../..');
const runtime=path.resolve(__dirname,'../.runtime');fs.mkdirSync(runtime,{recursive:true});
const profile = path.join(runtime, 'qa-chrome-' + Date.now());
const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let chrome, server, socket;
const pending = new Map();
let sequence = 0, sessionId;
const pageErrors = [],recordingRequests=[];
async function call(method, params = {}, session = sessionId) {
  const id = ++sequence;
  const answer = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method+' '+String(params.expression||'').slice(0,160))); }, 15000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject });
  });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  return answer;
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function screenshot(name) {
  const result = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(runtime, name), Buffer.from(result.data, 'base64'));
}
async function captureCourses(){
  for(const [index,name] of ['sun','moon','sea'].entries()){
    await evaluate('enter(themes['+index+']);draw()');
    const courseImage=await evaluate("wall.toDataURL('image/png')");
    fs.writeFileSync(path.join(runtime,'course-full-'+name+'.png'),Buffer.from(courseImage.split(',')[1],'base64'));
    await screenshot('course-game-'+name+'.png');
  }
}
(async () => {
  server = spawn(process.execPath, [path.join(root, '전시 운영/tools/server.cjs'), '18401', 'qa-browser'], { windowsHide: true, stdio: 'ignore' });
  chrome = spawn(chromePath, ['--headless=new', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  let port,endpoint;
  for(let i=0;i<100;i++){
    try{[port,endpoint]=fs.readFileSync(portFile,'utf8').trim().split(/\r?\n/);if(port&&endpoint?.startsWith('/devtools/'))break}catch{}
    await wait(100);
  }
  if(!port||!endpoint)throw new Error('Test Chrome did not expose its debugging endpoint');
  socket = new WebSocket('ws://127.0.0.1:' + port + endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const entry = pending.get(data.id); pending.delete(data.id);
      if (data.error) entry.reject(new Error(JSON.stringify(data.error))); else entry.resolve(data.result);
    }
    if(data.method==='Network.requestWillBeSent'&&(data.params.request.method==='POST'||data.params.request.url.includes('/__exhibition/photos')))recordingRequests.push(data.params.request.url);
    if (data.method === 'Runtime.exceptionThrown') pageErrors.push(data.params.exceptionDetails);
  });
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }, null));
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // Synthetic test only: deny all real camera access before the app loads.
  await call('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{throw Object.assign(new Error('Synthetic test: camera disabled'),{name:'NotAllowedError'})}})" });
  await call('Page.navigate', { url: 'http://127.0.0.1:18401/' });
  for (let i = 0; i < 50; i++) {
    if (await evaluate("document.readyState==='complete' && typeof drawSelection==='function'")) break;
    await wait(100);
  }
  await wait(200);
  await evaluate("var qaJumpCount=0,qaOriginalJump=jump,qaOriginalEnter=enter; jump=function(){const grounded=!!rider?.line;qaOriginalJump();if(grounded&&!rider.line)qaJumpCount++};enter=function(t){qaJumpCount=0;qaOriginalEnter(t)}");
  assert.equal(await evaluate('cards.children.length'), 3);
  assert.equal(await evaluate("Promise.all([...deckArt.values()].map(art=>art.image.decode())).then(()=>[...deckArt.values()].every(art=>art.image.naturalWidth===1536))"), true, 'All three supplied deck images load');
  assert.equal(await evaluate('shopWall.decode().then(()=>shopWall.naturalWidth>0)'),true,'Supplied shop wall loads');
  assert.equal(await evaluate('Promise.all([...obstacleArt.values()].map(art=>art.image.decode())).then(()=>[...obstacleArt.values()].every(art=>art.image.naturalWidth===2720))'),true,'Three obstacle references load');
  if(process.argv.includes('--course-only')){await captureCourses();assert.deepEqual(pageErrors,[]);console.log('PASS: sun/moon/sea obstacle references render in Chrome without JavaScript errors');return}
  assert.deepEqual(await evaluate('themes.map(t=>deckArt.get(t).file)'), ['sun_deck.png','moon_deck_v2.png','sea_deck.png'], 'Correct sun/moon/sea mapping');
  const deckSizes = await evaluate(`themes.map(t=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
    const g=canvas.getContext('2d');drawHeldDeck(256,256,1,g,t);
    const pixels=g.getImageData(0,0,512,512).data;
    let left=512,right=0,top=512,bottom=0;
    for(let y=0;y<512;y++)for(let x=0;x<512;x++)if(pixels[(y*512+x)*4+3]>128){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}
    return [right-left+1,bottom-top+1];
  })`);
  for(const size of deckSizes){assert.ok(Math.abs(size[0]-436)<=1);assert.ok(Math.abs(size[1]-112)<=1)}
  assert.ok(Math.max(...deckSizes.map(size=>size[0]))-Math.min(...deckSizes.map(size=>size[0]))<=1, 'Same rendered deck length');
  assert.ok(Math.max(...deckSizes.map(size=>size[1]))-Math.min(...deckSizes.map(size=>size[1]))<=1, 'Same rendered deck width');
  console.log('Rendered deck sizes (sun/moon/sea): '+JSON.stringify(deckSizes));
  assert.equal(await evaluate("document.querySelector('.lobby-heading h1').textContent"), '데크 디자인을 골라보세요!');
  assert.equal(await evaluate(`(()=>{const b=rackBoards(holding.width,holding.height);return Math.abs((b[1].x-b[0].x)-(b[2].x-b[1].x))<.01&&b.every(item=>item.y===b[0].y)})()`),true,'Decks in equally spaced row');
  assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight'), true, 'Desktop fits screen');
  await screenshot('lobby-wall-qa.png');
  await evaluate(`
    Object.defineProperty(cam,'videoWidth',{value:640,configurable:true});Object.defineProperty(cam,'videoHeight',{value:480,configurable:true});
    var qaImage=document.createElement('canvas'),qaMask=document.createElement('canvas');
    qaImage.width=qaMask.width=640;qaImage.height=qaMask.height=480;
    var paint=qaImage.getContext('2d'),mask=qaMask.getContext('2d');
    paint.fillStyle='#ff00ff';paint.fillRect(0,0,640,480);
    function qaPerson(g,masked){
      g.lineCap='round';
      const line=(points,color,width)=>{g.beginPath();points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.strokeStyle=masked?'white':color;g.lineWidth=width;g.stroke()};
      line([[296,305],[287,435]],'#26384d',38);line([[344,305],[356,435]],'#26384d',38);
      line([[320,190],[320,302]],'#276a89',106);
      line([[270,190],[230,250],[180,300]],'#276a89',30);line([[370,190],[412,250],[460,300]],'#276a89',30);
      g.fillStyle=masked?'white':'#c88e67';g.beginPath();g.arc(320,116,40,0,Math.PI*2);g.fill();
      for(const x of [180,460]){g.beginPath();g.arc(x,300,15,0,Math.PI*2);g.fill()}
      if(!masked){g.fillStyle='#252624';g.beginPath();g.arc(320,104,39,Math.PI,2*Math.PI);g.fill()}
    }
    qaPerson(paint,false);qaPerson(mask,true);
    var qaPoints=Array.from({length:33},()=>({x:.5,y:.5,visibility:0}));
    qaPoints[0]={x:.5,y:116/480,visibility:1};
    qaPoints[11]={x:270/640,y:190/480,visibility:1};qaPoints[12]={x:370/640,y:190/480,visibility:1};
    qaPoints[13]={x:230/640,y:250/480,visibility:1};qaPoints[14]={x:412/640,y:250/480,visibility:1};
    qaPoints[15]={x:180/640,y:300/480,visibility:1};qaPoints[16]={x:460/640,y:300/480,visibility:1};
    qaPoints[19]={...qaPoints[15]};qaPoints[20]={...qaPoints[16]};
    qaPoints[23]={x:296/640,y:305/480,visibility:1};qaPoints[24]={x:344/640,y:305/480,visibility:1};
    qaPoints[25]={x:290/640,y:370/480,visibility:1};qaPoints[26]={x:350/640,y:370/480,visibility:1};
    for(const i of [27,28,29,30,31,32])qaPoints[i]={x:(i%2?287:356)/640,y:(i>30?454:435)/480,visibility:1};
    window.qaRefresh=()=>updateFinishPerson({poseLandmarks:qaPoints,segmentationMask:qaMask,image:qaImage});
    window.qaTimer=setInterval(()=>{qaRefresh();if(selectedTheme)previewStartedAt=performance.now()-2250},80);
    qaRefresh();drawSelection(performance.now());
  `);
  assert.equal(await evaluate("personBrush.getImageData(0,0,1,1).data[3]"), 0, 'Room background removed');
  assert.equal(await evaluate("personBrush.getImageData(320,220,1,1).data[3]"), 255, 'Person retained');
  await screenshot('lobby-person-qa.png');
  await evaluate('chooseBoard(themes[0],15);previewStartedAt=performance.now()-2250;drawSelection(performance.now())');
  await screenshot('lobby-preview-qa.png');
  assert.equal(await evaluate('countdownNumber.textContent'), '3');
  assert.equal(await evaluate('cam.hidden'), true);
  for(const [width,height] of [[1280,720],[390,844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(150);
    assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight && document.documentElement.scrollWidth<=innerWidth'), true, 'Fits ' + width + 'x' + height);
    assert.equal(await evaluate('[...cards.children].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})'), true, 'Reach targets in viewport');
  }
  await evaluate('clearInterval(qaTimer);qaRefresh();previewStartedAt=performance.now()-5001;drawSelection(performance.now())');
  assert.equal(await evaluate('stage===2 && !active && !lesson.hidden && menu.hidden'),true,'Shop selection enters lesson');
  assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight'),true,'Mobile lesson fits screen');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(150);
  await evaluate('qaRefresh();drawLesson(performance.now());resetMotion()');await screenshot('lesson-qa.png');
  for(let i=0;i<13;i++){await evaluate('qaRefresh();measure(qaPoints)');await wait(50)}
  await evaluate('for(const i of [27,28,29,30,31,32])qaPoints[i].y-=.06;qaPoints[23].y-=.04;qaPoints[24].y-=.04;measure(qaPoints)');
  await wait(50);await evaluate('qaRefresh();measure(qaPoints)');
  assert.equal(await evaluate('learning.jump && qaJumpCount===0'),true,'Tutorial learns jump without using park trick count');
  await evaluate('for(const i of [27,28,29,30,31,32])qaPoints[i].y+=.06;qaPoints[23].y+=.04;qaPoints[24].y+=.04;qaPoints[27].x=.36;qaPoints[28].x=.64;updateStance(qaPoints,performance.now());updateStance(qaPoints,performance.now()+600)');
  assert.equal(await evaluate('learning.stance'),true,'Tutorial learns feet-apart stance');
  await evaluate('drawLesson(learning.goAt)');
  assert.equal(await evaluate('stage===3 && active && !ride.hidden'),true,'Both lessons lead to park');
  await evaluate(`
    var qaLiveDraws=0,qaPersonMatrix,qaDeckMatrix;
    var qaDrawImage=ctx.drawImage.bind(ctx),qaLiveRider=drawLiveRider;
    ctx.drawImage=function(image,...args){if(image===personCutout){qaLiveDraws++;qaPersonMatrix=ctx.getTransform()}return qaDrawImage(image,...args)};
    drawLiveRider=function(){qaDeckMatrix=ctx.getTransform();return qaLiveRider()};
    qaRefresh();enter(themes[0]);fitScene();draw();
  `);
  assert.ok(await evaluate('qaLiveDraws>0'), 'Masked person drawn in active game');
  assert.equal(await evaluate(`(()=>{
    const footX=[27,28,29,30,31,32].reduce((sum,i)=>sum+qaPoints[i].x,0)/6*640;
    const p=new DOMPoint(footX,454).matrixTransform(qaPersonMatrix),d=new DOMPoint(0,-9).matrixTransform(qaDeckMatrix);
    return Math.hypot(p.x-d.x,p.y-d.y)<.01;
  })()`), true, 'Person feet exactly on deck');
  await screenshot('live-rider-qa.png');
  const beforeJump = await evaluate('qaPersonMatrix.f');
  await evaluate('lobbyPerson=null;jump();qaRefresh();step(.016);draw()');
  assert.ok(await evaluate('qaPersonMatrix.f') < beforeJump, 'Person follows jump');
  await evaluate('qaRefresh();enter(themes[0]);jump()');
  assert.equal(await evaluate('qaJumpCount===1 && stage===3 && !ride.hidden && !rider.line'),true,'Ollie stays in park');
  assert.equal(await evaluate('document.querySelector("#ollieMoment")===null'),true,'No zoom overlay');
  const airborne=await evaluate('({x:rider.x,y:rider.y})');
  await wait(100);
  assert.ok(await evaluate('rider.x')>airborne.x,'Park keeps moving after ollie');
  for(let i=2;i<=3;i++){
    await evaluate('qaRefresh();resetRide();jump()');
    assert.equal(await evaluate('qaJumpCount'),i,'Repeated ollie succeeds without a closeup');
  }
  await screenshot('ollie-continuous-qa.png');
  for(let index=0;index<3;index++){
    await evaluate('qaRefresh();enter(themes['+index+']);var qaFinish=rails.find(line=>goal>=line.a[0]&&goal<=line.b[0]);rider={x:goal-2,y:height(qaFinish,goal)-45,vx:240,vy:-180,line:null};step(.02);drawStudio(performance.now())');
    assert.equal(await evaluate('stage===4 && !studio.hidden && !active && finished'),true,'Airborne finish opens last screen in park '+index);
    assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight'),true,'Last screen fits viewport');
    assert.ok(await evaluate('studioLabel.textContent.includes(theme.word)'),'Last screen keeps chosen board');
  }
  assert.equal(await evaluate('stage===4 && !studio.hidden && !active'),true,'Park completion enters pose-stage placeholder');
  await wait(100);await screenshot('studio-placeholder-qa.png');
  await evaluate('qaRefresh();studioHand.click();drawStudio(performance.now());var qaStudioView=previewPerson(studioCanvas.getContext("2d"),studioCanvas,performance.now()),qaHandPose=studioBoardPose(qaStudioView)');
  assert.equal(await evaluate('studioHand.getAttribute("aria-pressed")==="true" && Math.abs(qaHandPose.x-qaStudioView.point(qaPoints[qaHandPose.wrist]).x)<.01'),true,'Board is attached to wrist, not beside the person');
  await screenshot('studio-hand-qa.png');
  await evaluate('studioFoot.click();drawStudio(performance.now());var qaFootPose=studioBoardPose(previewPerson(studioCanvas.getContext("2d"),studioCanvas,performance.now()))');
  await evaluate('for(const i of [27,29,31]){qaPoints[i].x+=.03;qaPoints[i].y-=.015}');
  const footFollow=await evaluate('studioBoardPose(previewPerson(studioCanvas.getContext("2d"),studioCanvas,performance.now()))');
  assert.ok(footFollow.x<(await evaluate('qaFootPose.x'))&&footFollow.y<(await evaluate('qaFootPose.y')),'Left-sole board follows left-foot pose');
  await evaluate('drawStudio(performance.now())');await screenshot('studio-foot-qa.png');
  // Synthetic canvas video only: no webcam permission, device capture or recording.
  await evaluate('(async()=>{stream=qaImage.captureStream(30);cam.srcObject=stream;const pump=setInterval(()=>{paint.fillStyle="#ff00ff";paint.fillRect(0,0,1,1);stream.getVideoTracks()[0].requestFrame?.()},30);try{await Promise.race([cam.play(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("Synthetic video play timeout")),4000))])}finally{clearInterval(pump)}qaPoints[0].visibility=.05;qaRefresh();window.qaPoseStamp=lobbyPerson.time;paint.fillStyle="#00ee44";paint.fillRect(290,200,40,40);stream.getVideoTracks()[0].requestFrame?.()})()');
  await wait(150);
  assert.deepEqual(await evaluate('Array.from(personBrush.getImageData(320,220,1,1).data)'),[0,238,68,255],'New video frame appears before the next pose result');
  assert.equal(await evaluate('lobbyPerson.time===qaPoseStamp'),true,'Live display does not wait for pose updates');
  await evaluate('updateFinishPerson({poseLandmarks:null})');await wait(900);
  assert.equal(await evaluate('!!currentPerson(performance.now())'),true,'Body remains visible through a short detection gap and weak face');
  await evaluate('stream.getTracks().forEach(t=>t.stop());stream=null;cam.srcObject=null;qaRefresh();studioHand.click();window.qaNearScale=previewPerson(studioCanvas.getContext("2d"),studioCanvas,performance.now()).scale');
  await evaluate(`
    for(const canvas of [qaImage,qaMask]){const copy=document.createElement('canvas');copy.width=640;copy.height=480;copy.getContext('2d').drawImage(canvas,0,0);const g=canvas.getContext('2d');g.clearRect(0,0,640,480);if(canvas===qaImage){g.fillStyle='#ff00ff';g.fillRect(0,0,640,480)}g.drawImage(copy,160,120,320,240)}
    for(const p of qaPoints){p.x=.5+(p.x-.5)*.5;p.y=.5+(p.y-.5)*.5}lobbyPerson=null;qaRefresh();drawStudio(performance.now());
  `);
  assert.ok(await evaluate('previewPerson(studioCanvas.getContext("2d"),studioCanvas,performance.now()).scale')>await evaluate('qaNearScale')*1.7,'Distant participant automatically fills studio frame');
  await screenshot('studio-far-qa.png');
  for(const [width,height]of [[390,844],[1440,900]]){await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await wait(100);assert.equal(await evaluate('document.documentElement.scrollHeight<=innerHeight'),true,'Studio modes fit '+width+'px viewport')}
  console.log('PASS: weak-face display, short tracking gap, live video between inference results, hand/left-foot modes, distant-body framing');
  assert.equal(await evaluate('document.querySelector("#photoRecap")===null'),true,'Polaroid removed');
  assert.equal(recordingRequests.length,0,'No photo upload requests');
  console.log('PASS: ollie across finish opens last screen for sun, moon and sea');
  assert.equal((await fetch('http://127.0.0.1:18401/__exhibition/photos',{method:'POST',headers:{Origin:'http://127.0.0.1:18401','Content-Type':'image/png'},body:new Uint8Array([137,80,78,71])})).status,405,'Server no longer accepts photos');
  assert.equal((await fetch('http://127.0.0.1:18401/__exhibition/photos/not-saved')).status,404,'Server exposes no stored photos');
  await evaluate('studioReturn.onclick()');assert.equal(await evaluate('stage===1 && !menu.hidden'),true,'Pose stage returns to shop');
  await evaluate('enter(themes[0])');assert.equal(await evaluate('qaJumpCount'),0,'New experience resets counter');
  console.log('PASS: continuous first/second/third ollies without zoom, no recording/upload/storage/polaroid');
  await captureCourses();
  assert.deepEqual(pageErrors, [], 'No browser JavaScript errors');
  async function resetAndCheck(trigger){
    const origin=await evaluate('performance.timeOrigin');
    await trigger();
    let ready=false;
    for(let i=0;i<70;i++){
      await wait(100);
      try{ready=await evaluate('performance.timeOrigin>'+origin+' && document.readyState==="complete" && typeof stage!=="undefined" && stage===1 && selectedTheme===null && document.querySelector("#ollieMoment")===null && !menu.hidden')}catch{}
      if(ready)break;
    }
    assert.equal(ready,true,'Reset fully reloads a clean shop');
  }
  const pressR=()=>call('Input.dispatchKeyEvent',{type:'keyDown',key:'r',code:'KeyR',windowsVirtualKeyCode:82});
  for(const setup of ['selectedTheme=themes[0];beginRide()','enter(themes[1])','enter(themes[2]);jump()','enter(themes[0]);openStudio()']){
    await evaluate(setup);await resetAndCheck(pressR);
  }
  await evaluate('enter(themes[0])');
  await resetAndCheck(()=>evaluate('resetExhibition.click()'));
  assert.deepEqual(pageErrors, [], 'Reloads do not create browser errors');
  // Fail the main app in a fresh document: its earlier reset script must survive.
  await call('Fetch.enable',{patterns:[{urlPattern:'http://127.0.0.1:18401/',requestStage:'Request'}]});
  const failureResponse=Buffer.from(fs.readFileSync(path.join(root,'skateboardword/index.html'),'utf8').replace('<script id="app-script">','<script id="app-script">throw new Error("qa-main-init-failure");')).toString('base64');
  const onPaused=async event=>{
    const data=JSON.parse(event.data);
    if(data.method!=='Fetch.requestPaused')return;
    await call('Fetch.fulfillRequest',{requestId:data.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html; charset=utf-8'}],body:failureResponse});
    await call('Fetch.disable');socket.removeEventListener('message',onPaused);
  };
  socket.addEventListener('message',onPaused);
  const beforeFailure=await evaluate('performance.timeOrigin');
  await call('Page.reload',{ignoreCache:true});
  for(let i=0;i<70;i++){await wait(100);if(pageErrors.length>0)break}
  assert.ok(pageErrors.some(error=>(error.exception?.description||'').includes('qa-main-init-failure')),'Synthetic main-app failure happened');
  assert.ok(await evaluate('performance.timeOrigin')>beforeFailure);
  await resetAndCheck(pressR);
  console.log('PASS: R resets lesson, park, airborne ollie, studio; reset button works; R recovers from main-app startup error.');
  console.log('PASS: Chrome rendering, wording/layout, lobby mask, countdown, live person at character position, feet on deck, jumping, no JS errors. No physical camera accessed.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await call('Browser.close', {}, null); } catch {}
    socket.close();
  }
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (server && server.exitCode === null) server.kill();
});

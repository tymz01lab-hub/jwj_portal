const fs = require('node:fs');
const os=require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '../..');
const runtime=path.resolve(__dirname,'../.runtime');fs.mkdirSync(runtime,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'skate-pipeline-qa-'));
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
  chrome = spawn(chromePath, ['--headless=new', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
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

  const fixture=process.argv[2]||'https://storage.googleapis.com/mediapipe-assets/pose.jpg';
  const bytes=fixture.startsWith('https://')?Buffer.from(await (await fetch(fixture)).arrayBuffer()):fs.readFileSync(path.resolve(fixture));
  const picture='data:image/jpeg;base64,'+bytes.toString('base64');
  let protectedWorkers=0;
  socket.addEventListener('message',async event=>{
    const data=JSON.parse(event.data);
    if(data.method!=='Target.attachedToTarget'||data.params.targetInfo.type!=='worker')return;
    const workerSession=data.params.sessionId;
    try{
      await call('Network.enable',{},workerSession);
      await call('Network.setBlockedURLs',{urls:['*://cdn.jsdelivr.net/*','*://storage.googleapis.com/*']},workerSession);
      protectedWorkers++;
    }catch(error){pageErrors.push({workerSetup:error.message})}
    finally{await call('Runtime.runIfWaitingForDebugger',{},workerSession)}
  });
  await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  const mock='Object.defineProperty(navigator.mediaDevices,"getUserMedia",{value:async()=>{const image=new Image();image.src='+JSON.stringify(picture)+';await image.decode();const canvas=document.createElement("canvas");canvas.width=640;canvas.height=480;const g=canvas.getContext("2d");const stream=canvas.captureStream(30);const paint=()=>{g.fillStyle="#dddddd";g.fillRect(0,0,640,480);const s=Math.min(600/image.width,440/image.height),w=image.width*s,h=image.height*s;g.drawImage(image,(640-w)/2,(480-h)/2,w,h);stream.getVideoTracks()[0].requestFrame?.()};window.qaVideo={canvas,stream,paint};paint();setInterval(paint,40);return stream}})';
  await call('Page.addScriptToEvaluateOnNewDocument',{source:mock+';const NativeWorker=Worker;window.Worker=class extends NativeWorker{constructor(...args){super(...args);this.addEventListener("message",event=>{window.qaMaskPeak=event.data.maskPeak})}}'});
  await call('Network.setBlockedURLs',{urls:['*://cdn.jsdelivr.net/*','*://storage.googleapis.com/*']});
  await call('Page.navigate',{url:process.argv[3]||'http://127.0.0.1:18401/'});
  let state;
  const snapshot='(()=>{const a=personBrush.getImageData(0,0,personCutout.width,personCutout.height).data,b=maskBrush.getImageData(0,0,personMask.width,personMask.height).data;let count=0,max=0,maskMax=0;for(let i=3;i<a.length;i+=16){if(a[i]>32)count++;max=Math.max(max,a[i]);maskMax=Math.max(maskMax,b[i]||0)}return {stage,video:[cam.videoWidth,cam.videoHeight,cam.readyState],status:lobbyStatus,locked:participant.locked,missing:participant.missing,person:!!currentPerson(performance.now()),alphaPixels:count,maxAlpha:max,maskMax}})()';
  for(let i=0;i<30;i++){
    await wait(500);try{state=await evaluate(snapshot)}catch{continue}
    if(i%10===0)console.log(JSON.stringify({...state,workerPeak:await evaluate('window.qaMaskPeak')}));
    if(state.person&&state.alphaPixels>200)break;
  }
  console.log('FINAL '+JSON.stringify(state));
  assert.ok(state?.person&&state.alphaPixels>200,'Actual camera→worker→mask→cutout must retain visible person pixels');
  await evaluate('window.qaRenders={};var qaCanvasDraw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image===personCutout)qaRenders[this.canvas.id]=(qaRenders[this.canvas.id]||0)+1;return qaCanvasDraw.call(this,image,...args)}');
  for(const [setup,id,stage]of [['setStage(1)','holding',1],['selectedTheme=themes[0];beginRide()','lessonCanvas',2],['enter(themes[0])','scene',3]]){
    await evaluate(setup);await wait(500);await screenshot('pipeline-stage-'+stage+'.png');
    assert.ok(await evaluate('qaRenders['+JSON.stringify(id)+']>0'),'Live masked person is drawn in stage '+stage);
  }
  assert.deepEqual(pageErrors,[],'No browser errors in real camera pipeline');
  assert.equal(recordingRequests.length,0,'No camera frames uploaded');
  assert.ok(protectedWorkers>0,'External model CDNs were blocked inside the inference worker');
  console.log('PASS: actual worker/model with external model CDNs blocked, nonempty cutout in stages 1/2/3');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await call('Browser.close', {}, null); } catch {}
    socket.close();
  }
  if (chrome && chrome.exitCode === null) chrome.kill();
  if (server && server.exitCode === null) server.kill();
  for(let i=0;i<20&&chrome?.exitCode===null;i++)await wait(100);
  if(path.dirname(profile)!==path.resolve(os.tmpdir())||!path.basename(profile).startsWith('skate-pipeline-qa-'))throw new Error('Unsafe profile cleanup path');
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
});

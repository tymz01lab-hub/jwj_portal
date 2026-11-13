import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = selector => document.querySelector(selector);
const stage = $('#stage'), status = $('#status'), video = $('#webcam');
const themes = {
  moon: { word: '달', name: 'LUNAR PARK', sky: '#202733', floor: '#565c64', metal: '#80858b', accent: '#bec7cb', dark: '#41454c', light: '#bbc5d0', gravity: 5.8 },
  sun: { word: '해', name: 'SOLAR PARK', sky: '#fba75d', floor: '#db6139', metal: '#ffbd43', accent: '#ffedaa', dark: '#a83522', light: '#ff9b4b', gravity: 9.5 },
  water: { word: '물', name: 'ABYSS PARK', sky: '#052e49', floor: '#0c5361', metal: '#58b9d3', accent: '#8cf8df', dark: '#063f3c', light: '#27bfc8', gravity: 7.4 }
};
let theme = themes.moon, renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
} catch {
  status.textContent = '3D 화면을 열 수 없어요. Chrome의 그래픽 가속을 켜고 다시 열어 주세요.';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '3D 파크. 방향키 오른쪽으로 밀기, 스페이스바로 알리.');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(43, 16 / 9, .1, 160);
const environment = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
const environmentMap = environment.fromScene(room, .04);
scene.environment = environmentMap.texture;
scene.environmentIntensity = .85;
room.dispose();
environment.dispose();
const hemisphere = new THREE.HemisphereLight('#f4faff', '#39434f', .8);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight('#ffffff', 3);
keyLight.position.set(-9, 15, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
Object.assign(keyLight.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, far: 70 });
keyLight.shadow.normalBias = .035;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight('#bce8ff', 1.6);
rimLight.position.set(8, 6, -9);
scene.add(rimLight);
const park = new THREE.Group();
scene.add(park);
let floaters = [], swimmers = [], pulse = 0, track = [];
let roomFeed=null, scenery=[], completed=false, follow=false, viewDistance=48;
const viewTarget=new THREE.Vector3(0,2,0);
const finishMessage=()=>theme.word+' 완성! 다시 타기를 누르면 처음부터 출발해요.';
function applyRoomView(){
  scene.background=roomFeed||new THREE.Color(theme.sky);
  for(const object of scenery)object.visible=!roomFeed;
  const surface=park.getObjectByName('hangul-course');
  surface.geometry.setDrawRange(0,roomFeed?surface.userData.raisedCount:Infinity);
}
const courseScale = 6, courseOffsetZ = 12.6;
function crestHeight(x,z) {
  return 3.8 + 1.35*Math.sin(x*.19+z*.12) + 1.1*Math.cos(z*.24-.5);
}
const clock = new THREE.Clock();

function mesh(geometry, material, parent = park) {
  const object = new THREE.Mesh(geometry, material);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}
function box(width, height, depth, x, y, z, material, parent = park) {
  const object = mesh(new THREE.BoxGeometry(width, height, depth), material, parent);
  object.position.set(x, y, z);
  return object;
}
function tube(points, radius, material, parent = park) {
  return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 64, radius, 8, false), material, parent);
}
function material(color, metalness = .3, roughness = .4) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

// Each outline is a complete syllable, retaining its original Hangul arrangement.
const outlines = {
  '달': [
    [[.3,3.9],[-2.4,3.9],[-2.4,2.3],[.3,2.3]],
    [[1.2,4.2],[1.2,2.05]], [[1.2,3.2],[2.7,3.2]],
    [[-2.4,1.45],[2.2,1.45],[2.2,.72],[-2.4,.72],[-2.4,0],[2.4,0]]
  ],
  '해': [
    [[-2.1,4.1],[-.9,4.1]], [[-2.7,3.52],[-.3,3.52]],
    Array.from({ length: 65 }, (_, i) => [-1.5 + 1.05 * Math.cos(i * Math.PI / 32), 1.7 + 1.12 * Math.sin(i * Math.PI / 32)]),
    [[.55,4.2],[.55,0]], [[.55,2.1],[2.6,2.1]], [[2.6,4.2],[2.6,0]]
  ],
  '물': [
    [[-1.5,4.1],[1.5,4.1],[1.5,2.85],[-1.5,2.85],[-1.5,4.1]],
    [[-2.6,2.25],[2.6,2.25]], [[0,2.25],[0,1.65]],
    [[-2.3,1.2],[2.2,1.2],[2.2,.6],[-2.3,.6],[-2.3,0],[2.4,0]]
  ]
};
function strokeShape(points) {
  const closed = points.length > 3 && new THREE.Vector2(...points[0]).distanceTo(new THREE.Vector2(...points.at(-1))) < .001;
  const vertices = (closed ? points.slice(0, -1) : points).map(p => new THREE.Vector2(...p));
  const side = sign => vertices.map((point, i) => {
    const prev = vertices[(i - 1 + vertices.length) % vertices.length];
    const next = vertices[(i + 1) % vertices.length];
    let before = point.clone().sub(prev).normalize();
    let after = next.clone().sub(point).normalize();
    if (!closed && i === 0) before = after.clone();
    if (!closed && i === vertices.length - 1) after = before.clone();
    const normal = new THREE.Vector2(-before.y, before.x);
    const bisector = normal.clone().add(new THREE.Vector2(-after.y, after.x)).normalize();
    const length = .15 / Math.max(.25, bisector.dot(normal));
    return point.clone().addScaledVector(bisector, sign * length);
  });
  const left = side(1), right = side(-1);
  if (closed) {
    const clockwise = THREE.ShapeUtils.isClockWise(vertices);
    const shape = new THREE.Shape(clockwise ? left : right);
    shape.holes.push(new THREE.Path((clockwise ? right : left).reverse()));
    return shape;
  }
  return new THREE.Shape([...left, ...right.reverse()]);
}
function glyph(word, surface) {
  const group = new THREE.Group();
  for (const path of outlines[word]) {
    const geometry = new THREE.ExtrudeGeometry(strokeShape(path), {
      depth: .62, bevelEnabled: true, bevelThickness: .07, bevelSize: .045, bevelSegments: 3, steps: 1
    });
    mesh(geometry, surface, group);
  }
  return group;
}
function quarterPipe(surface, coping) {
  const shape = new THREE.Shape();
  shape.moveTo(0,0); shape.lineTo(3.4,0); shape.lineTo(3.4,2.6);
  shape.lineTo(2.9,2.6); shape.bezierCurveTo(2.8,.9,1.9,.1,0,.1); shape.closePath();
  const ramp = mesh(new THREE.ExtrudeGeometry(shape, { depth: 4.5, bevelEnabled: false }), surface);
  ramp.position.set(-20,.05,-6);
  tube([[-17.05,2.69,-6.05],[-17.05,2.69,-1.45]], .075, coping);
}
function buildTrack() {
  track = [];
  // Stroke groups in reading order: initial consonant, vowel, final consonant.
  const groups={'달':[0,1,1,2],'물':[0,1,1,2],'해':[0,0,0,1,1,1]}[theme.word];
  const paths = outlines[theme.word].map(path => path.map(([x,y]) =>
    new THREE.Vector3(x * courseScale, 0, courseOffsetZ - y * courseScale)
  ));
  paths.forEach((path, index) => {
    for (let i = 1; i < path.length; i++) {
      track.push({ start: path[i-1], end: path[i], length: path[i-1].distanceTo(path[i]), gap: false });
    }
    const start = path.at(-1), end = paths[(index+1)%paths.length][0];
    const length = start.distanceTo(end);
    if (length > .001) track.push({ start, end, length, gap: true,
      spin:index+1<paths.length&&groups[index]!==groups[index+1] });
  });
}
function trackPosition(segment, distance) {
  const part = track[segment], progress = THREE.MathUtils.clamp(distance / part.length, 0, 1);
  const position = part.start.clone().lerp(part.end, progress);
  position.y = crestHeight(position.x,position.z);
  if (part.gap) position.y += Math.sin(progress * Math.PI) * Math.min(3, part.length * .4);
  return position;
}
const wearCanvases=new Map();
const surfaceWidth=41,surfaceDepth=34,pixelsPerUnit=24;
const scratchColors={'달':'#615294','해':'#b02c41','물':'#08765c'};
let wearTexture,wearBrush;
// One fixed lunar landscape so returning to this park restores the same craters.
const craters=Array.from({length:83},(_,i)=>({
  x:Math.sin(i*73.21+.5)*19, z:Math.sin(i*119.7+2)*15.8,
  radius:i%7===0?1.15+(i%5)*.21:.25+(i%9)*.085
}));
function paintMoon(brush){
  brush.save();
  brush.scale(pixelsPerUnit,pixelsPerUnit);
  brush.translate(surfaceWidth/2,surfaceDepth/2);
  for(const {x,z,radius:r} of craters){
    const shade=brush.createRadialGradient(x-r*.15,z-r*.15,0,x,z,r*1.1);
    shade.addColorStop(0,'#5a5e66');shade.addColorStop(.65,'#666b72');
    shade.addColorStop(.85,'#909499');shade.addColorStop(1,'rgba(128,133,139,0)');
    brush.fillStyle=shade;brush.fillRect(x-r*1.1,z-r*1.1,r*2.2,r*2.2);
  }
  brush.restore();
}
function courseMaterial(){
  let canvas=wearCanvases.get(theme.word);
  if(!canvas){
    canvas=document.createElement('canvas');
    canvas.width=surfaceWidth*pixelsPerUnit;
    canvas.height=surfaceDepth*pixelsPerUnit;
    const brush=canvas.getContext('2d');
    brush.fillStyle=theme.metal;
    brush.fillRect(0,0,canvas.width,canvas.height);
    if(theme===themes.moon)paintMoon(brush);
    wearCanvases.set(theme.word,canvas);
  }
  wearBrush=canvas.getContext('2d');
  wearTexture=new THREE.CanvasTexture(canvas);
  wearTexture.colorSpace=THREE.SRGBColorSpace;
  wearTexture.generateMipmaps=false;
  wearTexture.minFilter=THREE.LinearFilter;
  const surfaceMaterial=theme===themes.moon?material('#ffffff',.02,.98):material('#ffffff',.18,.7);
  surfaceMaterial.map=wearTexture;
  return surfaceMaterial;
}
function scratch(part,from,to){
  if(part.gap||motion.vy!==0||motion.jump>0||to<=from)return;
  const dx=(part.end.x-part.start.x)/part.length;
  const dz=(part.end.z-part.start.z)/part.length;
  const brush=wearBrush;
  brush.save();
  brush.setTransform(dx*pixelsPerUnit,dz*pixelsPerUnit,-dz*pixelsPerUnit,dx*pixelsPerUnit,
    (part.start.x+surfaceWidth/2)*pixelsPerUnit,(part.start.z+surfaceDepth/2)*pixelsPerUnit);
  brush.fillStyle=scratchColors[theme.word];
  for(const offset of [-.44,.44]){
    brush.globalAlpha=.30;
    brush.fillRect(from,offset-.13,to-from,.26);
    brush.globalAlpha=.68;
    brush.fillRect(from,offset-.07,to-from,.045);
    brush.fillStyle='#f7f3dc';
    brush.globalAlpha=.65;
    brush.fillRect(from,offset+.035,to-from,.033);
    brush.fillStyle=scratchColors[theme.word];
  }
  brush.restore();
  wearTexture.needsUpdate=true;
}
function sculptCourse() {
  const strokes=track.filter(part=>!part.gap);
  const geometry=new THREE.PlaneGeometry(surfaceWidth,surfaceDepth,300,248);
  geometry.rotateX(-Math.PI/2);
  const vertices=geometry.attributes.position;
  const tones=new Float32Array(vertices.count*3);
  for(let i=0;i<vertices.count;i++){
    const x=vertices.getX(i),z=vertices.getZ(i);
    let distance=Infinity;
    for(const {start,end} of strokes){
      const dx=end.x-start.x,dz=end.z-start.z;
      const t=THREE.MathUtils.clamp(((x-start.x)*dx+(z-start.z)*dz)/(dx*dx+dz*dz),0,1);
      distance=Math.min(distance,(x-start.x-t*dx)**2+(z-start.z-t*dz)**2);
    }
    distance=Math.sqrt(distance);
    const u=THREE.MathUtils.clamp((distance-.94)/4.4,0,1);
    const fade=THREE.MathUtils.smoothstep(distance,.94,2.4);
    tones.fill(1-.44*fade,i*3,i*3+3);
    // The cosine cross-section is horizontal at both the riding lip and the runout.
    const rise=(crestHeight(x,z)-.045)*(.5+.5*Math.cos(Math.PI*u));
    let relief=0;
    if(theme===themes.moon&&u>0&&u<1){
      for(const crater of craters){
        const r2=((x-crater.x)**2+(z-crater.z)**2)/crater.radius**2;
        if(r2<1)relief+=crater.radius*.23*(1-r2)**2;
      }
    }
    vertices.setY(i,.045+rise-Math.min(rise*.65,relief*Math.sin(Math.PI*u)));
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(tones,3));
  geometry.computeVertexNormals();
  const raised=[],flat=[];
  const indices=geometry.index.array;
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i],b=indices[i+1],c=indices[i+2];
    const group=Math.max(vertices.getY(a),vertices.getY(b),vertices.getY(c))>.046?raised:flat;
    group.push(a,b,c);
  }
  geometry.setIndex(raised.concat(flat));
  const surface=mesh(geometry,courseMaterial());
  surface.material.vertexColors=true;
  surface.userData.raisedCount=raised.length;
  surface.name='hangul-course';
}
function buildPark() {
  const geometries = new Set(), materials = new Set();
  park.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
  park.clear();
  geometries.forEach(g => g.dispose());
  materials.forEach(m => {m.map?.dispose();m.dispose()});
  floaters = []; swimmers = [];
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.FogExp2(theme.sky, theme === themes.water ? .025 : .013);
  rimLight.color.set(theme.light);
  scene.environmentIntensity=theme===themes.moon?.45:.85;
  const concrete = material(theme.floor, .3, .56);
  const alloy = material(theme.metal, .86, .2);
  const dark = material(theme.dark, .55, .32);
  const glow = new THREE.MeshStandardMaterial({ color: theme.accent, emissive: theme.accent, emissiveIntensity: .4, metalness: .6, roughness: .24 });
  const floor = mesh(new THREE.CylinderGeometry(22, 22.3, .38, 96), concrete);
  floor.position.y = -.21;
  const horizon = mesh(new THREE.PlaneGeometry(240,240), material(theme.floor,.05,.94));
  horizon.rotation.x = -Math.PI/2; horizon.position.y = -.45;
  const firstObstacle=park.children.length;
  quarterPipe(concrete, alloy);

  // Raised bowl, with a curved transition and a continuous metal coping.
  const profile = [new THREE.Vector2(.01,.12),new THREE.Vector2(1.4,.12)];
  for(let i=0;i<=24;i++) {
    const a=i/24*Math.PI/2;
    profile.push(new THREE.Vector2(1.4+1.9*Math.sin(a),.12+1.9*(1-Math.cos(a))));
  }
  profile.push(new THREE.Vector2(3.65,2.02),new THREE.Vector2(3.65,.02));
  const bowl=mesh(new THREE.LatheGeometry(profile.reverse(),80),concrete);
  bowl.position.set(16,0,-1.2);
  const lip=mesh(new THREE.TorusGeometry(3.3,.07,10,100),alloy);
  lip.rotation.x=Math.PI/2;lip.position.set(16,2.04,-1.2);

  // Street obstacles frame the central Hangul course.
  const bankShape=new THREE.Shape();
  bankShape.moveTo(-2.7,0);bankShape.lineTo(-1.2,.7);bankShape.lineTo(1.2,.7);bankShape.lineTo(2.7,0);bankShape.closePath();
  const bank=mesh(new THREE.ExtrudeGeometry(bankShape,{depth:2.8,bevelEnabled:false}),concrete);
  bank.position.set(0,0,12);
  for(let i=0;i<4;i++)box(2.5,(4-i)*.22,.55,-15.2,(4-i)*.11,3+i*.55,concrete);
  tube([[-16,1.65,2.9],[-16,.85,5]],.065,alloy);
  tube([[-16,1.65,2.9],[-16,.86,2.9]],.05,alloy);
  tube([[-16,.85,5],[-16,.06,5]],.05,alloy);
  box(3,.58,1.1,14,.29,7,concrete);
  box(3.08,.07,1.16,14,.61,7,alloy);
  tube([[-3,.65,-11],[2.5,.65,-11]],.06,alloy);
  for(const x of [-2.7,2.2])tube([[x,.65,-11],[x,0,-11]],.045,alloy);
  for(const obstacle of park.children.slice(firstObstacle)){
    const center=new THREE.Box3().setFromObject(obstacle).getCenter(new THREE.Vector3());
    if(Math.abs(center.x)>10)obstacle.position.x+=Math.sign(center.x)*8;
    else obstacle.position.z+=Math.sign(center.z)*8;
  }
  buildTrack();
  sculptCourse();
  const firstDecoration=park.children.length;
  for(const [x,y,z,s,turn] of [[-18,4.5,4,.43,.5],[17,5,-9,.5,-.5],[-3,7,-19,.3,.28]]) {
    const floating=glyph(theme.word,alloy);
    floating.position.set(x,y,z);floating.scale.setScalar(s);floating.rotation.set(.04,turn,.08);
    park.add(floating);floaters.push({object:floating,y,turn});
  }
  if(theme===themes.moon) {
    for(let i=0;i<24;i++) {
      const a=i*2.4,r=25+(i%5)*3;
      const rock=mesh(new THREE.IcosahedronGeometry(.6+(i%4)*.7,1),dark);
      rock.position.set(Math.cos(a)*r,-.15,Math.sin(a)*r);
      rock.scale.set(1,.45,1);
    }
    const earth=mesh(new THREE.SphereGeometry(2.1,40,24),material('#88adca',.12,.6));
    earth.position.set(-15,10,-26);
  }else if(theme===themes.sun) {
    const sun=mesh(new THREE.SphereGeometry(4,48,32),new THREE.MeshBasicMaterial({color:'#fff1bd'}));
    sun.position.set(-13,9,-22);
    for(let i=0;i<3;i++){
      const halo=mesh(new THREE.TorusGeometry(5+i*.6,.035,8,100),glow);
      halo.position.copy(sun.position);halo.rotation.x=.3;
    }
  }else{
    const fishMaterial=material('#71ddda',.7,.25);
    for(let i=0;i<13;i++){
      const fish=new THREE.Group();
      const body=mesh(new THREE.SphereGeometry(.28,16,10),fishMaterial,fish);body.scale.set(2,.65,.65);
      const tail=mesh(new THREE.ConeGeometry(.28,.4,3),fishMaterial,fish);tail.rotation.z=-Math.PI/2;tail.position.x=-.62;
      park.add(fish);swimmers.push({object:fish,phase:i*1.77,radius:9+i%4,y:2+i%5});
    }
  }
  // Sparse suspended dust makes the distances between objects visible.
  const coords=new Float32Array(480*3);
  for(let i=0;i<480;i++){coords[i*3]=Math.sin(i*127.1)*40;coords[i*3+1]=Math.abs(Math.sin(i*311.7))*19;coords[i*3+2]=Math.cos(i*71.9)*40;}
  const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.BufferAttribute(coords,3));
  park.add(new THREE.Points(dustGeometry,new THREE.PointsMaterial({color:theme.accent,size:.035,transparent:true,opacity:.65})));
  scenery=[floor,horizon,...park.children.slice(firstDecoration)];
  applyRoomView();
}

const skater=new THREE.Group();skater.scale.setScalar(2);scene.add(skater);
const board=new THREE.Group();skater.add(board);
const boardMetal=material('#d9e1e8',.9,.22);
const deckShape=new THREE.Shape();
deckShape.moveTo(-.88,-.23);deckShape.lineTo(.88,-.23);deckShape.quadraticCurveTo(1.13,-.23,1.13,0);deckShape.quadraticCurveTo(1.13,.23,.88,.23);deckShape.lineTo(-.88,.23);deckShape.quadraticCurveTo(-1.13,.23,-1.13,0);deckShape.quadraticCurveTo(-1.13,-.23,-.88,-.23);
const deck=mesh(new THREE.ExtrudeGeometry(deckShape,{depth:.055,bevelEnabled:true,bevelThickness:.035,bevelSize:.025,bevelSegments:3}),boardMetal,board);
deck.rotation.x=-Math.PI/2;deck.position.y=.19;
const wheelMaterial=material('#f1faff',.2,.28);
for(const x of [-.7,.7])for(const z of [-.22,.22]) {
  const wheel=mesh(new THREE.CylinderGeometry(.115,.115,.12,20),wheelMaterial,board);
  wheel.rotation.x=Math.PI/2;wheel.position.set(x,.1,z);
}
const mannequin=new THREE.Group();skater.add(mannequin);
const mannequinMaterial=material('#e6edf1',.65,.32);
mesh(new THREE.CapsuleGeometry(.22,.45,6,12),mannequinMaterial,mannequin).position.set(0,1.5,0);
mesh(new THREE.SphereGeometry(.18,24,16),mannequinMaterial,mannequin).position.set(0,2.14,0);
for(const x of [-.16,.16]){
  box(.16,.8,.17,x,.76,0,mannequinMaterial,mannequin);
  box(.14,.63,.14,x*2.05,1.46,0,mannequinMaterial,mannequin);
}
const bodyCanvas=document.createElement('canvas');bodyCanvas.width=bodyCanvas.height=512;
const bodyContext=bodyCanvas.getContext('2d');
const maskCanvas=document.createElement('canvas'),maskContext=maskCanvas.getContext('2d');
const bodyTexture=new THREE.CanvasTexture(bodyCanvas);bodyTexture.colorSpace=THREE.SRGBColorSpace;
const bodyPlane=new THREE.PlaneGeometry(4.1,4.1);
bodyPlane.translate(0,4.1*(.5-.125),0);
const bodySprite=new THREE.Mesh(bodyPlane,new THREE.MeshBasicMaterial({map:bodyTexture,transparent:true,side:THREE.DoubleSide,depthWrite:false}));
bodySprite.position.y=.27;bodySprite.visible=false;skater.add(bodySprite);
let motion={segment:0,distance:0,speed:0,jump:0,vy:0},audio,rollDistance=0;
function tone(freq,end,duration,volume=.12){
  if(!audio)return;
  const oscillator=audio.createOscillator(),gain=audio.createGain(),now=audio.currentTime;
  oscillator.frequency.setValueAtTime(freq,now);oscillator.frequency.exponentialRampToValueAtTime(end,now+duration);
  gain.gain.setValueAtTime(volume,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  oscillator.connect(gain).connect(audio.destination);oscillator.start();oscillator.stop(now+duration);
}
function unlock(){audio??=new AudioContext();audio.resume().catch(()=>{});}
function push(){if(completed)return;follow=true;unlock();motion.speed=Math.min(4.5,motion.speed+2.05);tone(170,45,.12,.08);}
let flight=null;
function ollie(deepCrouch=false){
  unlock();
  if(completed||flight||track[motion.segment].gap)return;
  const height=deepCrouch===true?5.6:3.6;
  const duration=deepCrouch===true?.43:.32;
  let remaining=(12+motion.speed)*duration;
  let segment=motion.segment,distance=motion.distance;
  // Pick a landing on the current stroke; fly directly to it across bends.
  while(remaining>0){
    const step=Math.min(remaining,track[segment].length-distance);
    distance+=step;remaining-=step;
    if(remaining<=0||!track[segment+1]||track[segment+1].gap)break;
    segment++;distance=0;
  }
  flight={from:trackPosition(motion.segment,motion.distance),to:trackPosition(segment,distance),
    segment,distance,height,duration,time:0};
  follow=true;
  motion.speed=Math.max(motion.speed,3.3);
  motion.vy=4*height/duration;
  tone(1000,170,.07);
  return true;
}
$('#push').onclick=()=>{if(completed)selectTheme(document.documentElement.dataset.theme);push()};$('#ollie').onclick=ollie;
addEventListener('keydown',e=>{
  if(e.code==='Space'&&e.target.matches('#camera,#overhead,[data-world]'))return;
  if(!e.repeat&&['ArrowRight','Space'].includes(e.code)){e.preventDefault();(e.code==='Space'?ollie:push)();}
});
function selectTheme(key){
  theme=themes[key];document.documentElement.dataset.theme=key;
  document.querySelectorAll('[data-world]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.world===key)));
  $('#worldTitle').textContent=theme.word;$('#worldName').textContent=theme.name;
  buildPark();flight=null;motion={segment:0,distance:0,speed:0,jump:0,vy:0};
  completed=false;follow=!!roomFeed;$('#push').textContent='밀기 →';
  status.textContent='밀기를 누르면 획을 따라 출발해요.';
}
document.querySelectorAll('[data-world]').forEach(button=>button.onclick=()=>selectTheme(button.dataset.world));
let yaw=.12,elevation=.98,drag=null;
$('#overhead').onclick=()=>{follow=false;yaw=0;elevation=1.48;};
renderer.domElement.addEventListener('pointerdown',e=>{renderer.domElement.focus({preventScroll:true});drag={x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId)});
renderer.domElement.addEventListener('pointermove',e=>{
  if(!drag)return;yaw-=(e.clientX-drag.x)*.005;elevation=THREE.MathUtils.clamp(elevation+(e.clientY-drag.y)*.003,.35,1.48);drag={x:e.clientX,y:e.clientY};
});
renderer.domElement.addEventListener('pointerup',()=>drag=null);
renderer.domElement.addEventListener('pointercancel',()=>drag=null);
function fit(){const rect=stage.getBoundingClientRect();renderer.setSize(rect.width,rect.height);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix();}
new ResizeObserver(fit).observe(stage);
function animate(){
  const elapsed=clock.getDelta(),dt=Math.min(elapsed,.04),time=clock.elapsedTime;
  if(!$('#shop').hidden){requestAnimationFrame(animate);return}
  if(track[motion.segment].gap)motion.speed=Math.max(2.2,motion.speed);
  let markStart=motion.distance;
  if(!flight){
    const section=track[motion.segment];
    if(section.spin)motion.distance=Math.min(section.length,motion.distance+section.length*elapsed/.44);
    else {motion.distance+=motion.speed*dt;motion.speed=Math.max(0,motion.speed-dt*.5);}
  }
  while(!completed&&motion.distance>=track[motion.segment].length){
    scratch(track[motion.segment],markStart,track[motion.segment].length);
    markStart=0;
    if(motion.segment===track.length-1||(motion.segment===track.length-2&&track.at(-1).gap)){
      motion.distance=track[motion.segment].length;markStart=motion.distance;motion.speed=0;
      completed=true;follow=false;yaw=0;elevation=1.42;
      $('#push').textContent='다시 타기';status.textContent=finishMessage();break;
    }
    motion.distance-=track[motion.segment].length;
    const wasGap=track[motion.segment].gap;
    motion.segment=(motion.segment+1)%track.length;
    if(wasGap){pulse=1;tone(130,40,.2);}
    if(track[motion.segment].gap)tone(1000,170,.07);
  }
  scratch(track[motion.segment],markStart,motion.distance);
  rollDistance+=motion.speed*dt;
  if(rollDistance>.7){rollDistance=0;tone(70,35,.035,.025);}
  skater.position.copy(trackPosition(motion.segment,motion.distance));
  const part=track[motion.segment],direction=part.end.clone().sub(part.start);
  skater.rotation.y=part.spin?2*Math.PI*motion.distance/part.length:0;
  if(flight){
    flight.time+=elapsed;
    const t=Math.min(1,flight.time/flight.duration);
    motion.jump=4*flight.height*t*(1-t);
    skater.position.lerpVectors(flight.from,flight.to,t);
    skater.position.y+=motion.jump;
    direction.subVectors(flight.to,flight.from);
    if(t===1){
      motion.segment=flight.segment;motion.distance=flight.distance;
      motion.vy=0;flight=null;pulse=1;
      tone(theme===themes.sun?370:130,40,.23);
    }
  }
  board.rotation.y=Math.atan2(-direction.z,direction.x);
  const forwardX=Math.cos(board.rotation.y),forwardZ=-Math.sin(board.rotation.y);
  const slope=(crestHeight(skater.position.x+.1*forwardX,skater.position.z+.1*forwardZ)-crestHeight(skater.position.x,skater.position.z))/.1;
  board.rotation.z=Math.atan(slope)-Math.min(.12,motion.jump*.08);
  floaters.forEach((f,i)=>{f.object.position.y=f.y+Math.sin(time*.45+i)*.22;f.object.rotation.y=f.turn+Math.sin(time*.25+i)*.12;});
  swimmers.forEach(f=>{const a=time*.13+f.phase;f.object.position.set(Math.cos(a)*f.radius,f.y+Math.sin(a*2)*.3,Math.sin(a)*f.radius-4);f.object.rotation.y=-a-Math.PI/2;f.object.rotation.z=Math.sin(time*3+f.phase)*.06;});
  pulse=Math.max(0,pulse-dt*3);boardMetal.emissive.set(theme.accent);boardMetal.emissiveIntensity=pulse*.4;
  const blend=1-Math.exp(-dt*(follow?(part.spin?14:4):2));
  viewDistance+=( (follow?17:48)-viewDistance)*blend;
  const focus=follow?skater.position.clone().add(new THREE.Vector3(0,1.8-motion.jump,0)):new THREE.Vector3(0,2,0);
  viewTarget.lerp(focus,blend);
  camera.position.set(Math.sin(yaw)*Math.cos(elevation),Math.sin(elevation),Math.cos(yaw)*Math.cos(elevation)).multiplyScalar(viewDistance).add(viewTarget);
  camera.lookAt(viewTarget);
  bodySprite.quaternion.copy(camera.quaternion);
  renderer.render(scene,camera);requestAnimationFrame(animate);
}
selectTheme('moon');fit();animate();
status.textContent='밀기를 누르면 글자 획을 따라가요. 끊긴 획 사이는 자동으로 점프해요.';

const poseBase='https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/';
let stream=null,session=0,pose,poseLoading;
let stance=null,gesture='ready',lowestHip=0,lastBent=0,deepSince=null,deep=false;
function resetGesture(){stance=null;gesture='ready';deepSince=null;deep=false;}
// Remember real background pixels as the rider uncovers them. For still-hidden
// areas, interpolate the nearest visible background on each side of the mask.
function makeRoomBackground(){
  const canvas=document.createElement('canvas');
  canvas.width=Math.min(video.videoWidth,480);
  canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  const {width:w,height:h}=canvas;
  const history=new Uint8ClampedArray(w*h*4),seen=new Uint8Array(w*h);
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
  texture.userData.update=result=>{
    if(!result.segmentationMask)return;
    ctx.clearRect(0,0,w,h);ctx.drawImage(result.segmentationMask,0,0,w,h);
    const mask=ctx.getImageData(0,0,w,h).data;
    ctx.drawImage(result.image,0,0,w,h);
    const frame=ctx.getImageData(0,0,w,h),pixels=frame.data;
    for(let y=0;y<h;y++){
      let left=-1,right=0;
      const row=y*w;
      for(let x=0;x<w;x++){
        const i=row+x,k=4*i;
        if(mask[k+3]<12){
          for(let c=0;c<3;c++)history[k+c]=pixels[k+c];
          seen[i]=1;left=x;continue;
        }
        right=Math.max(right,x+1);
        while(right<w&&mask[4*(row+right)+3]>=12)right++;
        const l=left>=0?left:right,r=right<w?right:left;
        const mix=l===r?0:(x-l)/(r-l);
        for(let c=0;c<3;c++){
          pixels[k+c]=seen[i]?history[k+c]:l>=0&&l<w?
            pixels[4*(row+l)+c]*(1-mix)+pixels[4*(row+r)+c]*mix:128;
        }
      }
    }
    ctx.putImageData(frame,0,0);texture.needsUpdate=true;
  };
  return texture;
}
function composite(result){
  bodySprite.visible=false;mannequin.visible=true;
  const points=result.poseLandmarks,mask=result.segmentationMask;
  if(!points||!mask||points[0].visibility<.5)return false;
  const sole=[points[29],points[31]].filter(p=>p.visibility>.55&&p.y>0&&p.y<1);
  if(!sole.length)return false;
  const w=video.videoWidth,h=video.videoHeight;if(!w||!h)return false;
  if(maskCanvas.width!==w||maskCanvas.height!==h){maskCanvas.width=w;maskCanvas.height=h}
  maskContext.clearRect(0,0,w,h);maskContext.drawImage(result.image,0,0,w,h);
  maskContext.globalCompositeOperation='destination-in';maskContext.drawImage(mask,0,0,w,h);maskContext.globalCompositeOperation='source-over';
  const footX=sole.reduce((sum,p)=>sum+p.x*w,0)/sole.length,footY=Math.max(...sole.map(p=>p.y))*h;
  const height=Math.max(h*.25,Math.abs(points[0].y-(points[23].y+points[24].y)/2)*h*2.1);
  const scale=300/height;
  bodyContext.clearRect(0,0,512,512);bodyContext.save();bodyContext.translate(256,448);bodyContext.scale(-scale,scale);bodyContext.drawImage(maskCanvas,-footX,-footY);bodyContext.restore();
  bodyTexture.needsUpdate=true;bodySprite.visible=true;mannequin.visible=false;return true;
}
function measure(points){
  const now=performance.now();
  if(now-lastLegFrame>600)resetGesture();
  if(!points)return;
  const legs=[[23,25,27],[24,26,28]].filter(ids=>ids.every(i=>points[i].visibility>.55));
  if(legs.length!==2)return;
  lastLegFrame=now;
  function angle(a,b,c){
    const u=new THREE.Vector2((points[a].x-points[b].x)*video.videoWidth,(points[a].y-points[b].y)*video.videoHeight);
    const v=new THREE.Vector2((points[c].x-points[b].x)*video.videoWidth,(points[c].y-points[b].y)*video.videoHeight);
    return Math.acos(THREE.MathUtils.clamp(u.dot(v)/(u.length()*v.length()),-1,1))*180/Math.PI;
  }
  const hip=(points[23].y+points[24].y)/2;
  const span=(points[27].x-points[28].x)*video.videoWidth/video.videoHeight;
  const height=(points[27].y+points[28].y)/2-hip;
  recognizeGesture(legs.map(ids=>angle(...ids)),hip,span,height,now,points[27].y-points[28].y);
}
let lastLegFrame=-Infinity,ollieFeedbackUntil=0;
function recognizeGesture(angles,hip,span,height,now,footLevel){
  const straight=Math.min(...angles)>145;
  if(!stance){
    if(straight&&height>.12)stance={hip,span,height,footLevel};
    return;
  }
  const stride=Math.abs(span-stance.span)/stance.height;
  const uneven=Math.abs(angles[0]-angles[1])>25;
  const liftedFoot=Math.abs(footLevel-stance.footLevel)>.17*stance.height;
  if(stride>.32){gesture='push';deepSince=null;deep=false}
  if(gesture==='push'){
    if(stride<.15){push();gesture='recover'}
    return;
  }
  if(gesture==='recover'){
    if(straight&&stride<.15&&!liftedFoot){resetGesture();stance={hip,span,height:Math.max(.12,height),footLevel}}
    return;
  }
  if(uneven||liftedFoot||stride>.23){gesture='recover';return}
  const drop=(hip-stance.hip)/stance.height;
  if(gesture==='crouch'&&lowestHip-hip>.055*stance.height){
    if(now-lastBent<600&&ollie(deep))ollieFeedbackUntil=now+650;
    gesture='recover';return;
  }
  if(drop>.09||(Math.max(...angles)<150&&drop>.045)){
    if(gesture!=='crouch'||hip>=lowestHip-.015*stance.height)lastBent=now;
    lowestHip=gesture==='crouch'?Math.max(lowestHip,hip):hip;
    gesture='crouch';
    if(Math.max(...angles)<=90){
      deepSince??=now;
      if(now-deepSince>=100)deep=true;
    }else deepSince=null;
  }else if(gesture==='crouch'){
    deepSince=null;
    if(now-lastBent>600)gesture='recover';
  }else if(straight){
    stance.hip=Math.min(stance.hip,hip);
  }
}
function stopCamera(){
  roomFeed?.dispose();roomFeed=null;applyRoomView();
  session++;stream?.getTracks().forEach(track=>track.stop());stream=null;video.srcObject=null;
  $('#preview').hidden=true;
  bodySprite.visible=false;mannequin.visible=true;resetGesture();
  $('#camera').textContent='웹캠 켜고 들어가기';$('#camera').disabled=false;
}
async function startCamera(){
  if(stream){stopCamera();status.textContent='웹캠 꺼짐 · 버튼이나 키보드로 탈 수 있어요.';return}
  unlock();const id=++session;$('#camera').disabled=true;
  try{
    const acquired=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
    if(id!==session){acquired.getTracks().forEach(t=>t.stop());return}
    stream=acquired;video.srcObject=stream;await video.play();
    if(id!==session)return;
    roomFeed=makeRoomBackground();
    const crop=Math.min(1,(16/9)/(video.videoWidth/video.videoHeight));
    const cropY=Math.min(1,(video.videoWidth/video.videoHeight)/(16/9));
    roomFeed.repeat.set(-crop,cropY);roomFeed.offset.set((1+crop)/2,(1-cropY)/2);
    applyRoomView();follow=!completed;$('#preview').hidden=false;status.textContent='몸과 배경을 구분하는 중…';
    if(!window.Pose){
      poseLoading??=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=poseBase+'pose.js';script.onload=resolve;script.onerror=reject;document.head.append(script)}).catch(error=>{poseLoading=null;throw error});
      await poseLoading;
    }
    if(id!==session)return;
    if(!pose){pose=new window.Pose({locateFile:file=>poseBase+file});pose.setOptions({modelComplexity:1,smoothLandmarks:true,enableSegmentation:true,smoothSegmentation:true})}
    pose.onResults(result=>{
      if(id!==session)return;
      if(!$('#shop').hidden){
        const g=$('#cutout').getContext('2d');
        g.clearRect(0,0,640,480);
        if(result.segmentationMask&&result.poseLandmarks){
          g.drawImage(result.image,0,0,640,480);
          g.globalCompositeOperation='destination-in';g.drawImage(result.segmentationMask,0,0,640,480);g.globalCompositeOperation='source-over';
        }
        return;
      }
      roomFeed.userData.update(result);
      const visible=composite(result);measure(result.poseLandmarks);
      if(completed){status.textContent=finishMessage();return}
      status.textContent=performance.now()<ollieFeedbackUntil?'알리!':
        !visible||!stance?'양발이 보이게 살짝 옆으로 서서 두 무릎을 펴 주세요.':
        gesture==='push'?'푸시오프 준비 · 민 발을 제자리로 가져오세요.':
        gesture==='crouch'?'알리 준비 · 두 무릎을 함께 빠르게 펴세요.':
        '푸시오프는 한 발만 뒤로 · 알리는 발 간격을 유지하고 함께 앉았다 일어나세요.';
    });
    $('#camera').textContent='웹캠 끄기';$('#camera').disabled=false;
    while(id===session){
      await pose.send({image:video});
      if(!$('#shop').hidden&&shopHand){
        try{await shopHand.send({image:video})}catch{shopHand=null;$('#shopHint').textContent='손 인식을 열지 못했어요. 데크를 클릭해 입장하세요.'}
      }
      await new Promise(requestAnimationFrame)
    }
  }catch(error){
    if(id===session){
      stopCamera();const failedPose=pose;pose=null;if(failedPose)failedPose.close().catch(()=>{});
      status.textContent=error.name==='NotAllowedError'?'카메라 권한을 허용한 뒤 다시 눌러 주세요.':'웹캠과 인터넷 연결을 확인하고 다시 눌러 주세요.';
    }
  }finally{if(id===session||!stream)$('#camera').disabled=false}
}
$('#camera').onclick=startCamera;
const shop=$('#shop'),decks=[...shop.querySelectorAll('.deck')];
for(const el of shop.parentElement.children)if(el!==shop)el.inert=true;
let shopHand=null,candidate=null,since=0;
function enterShopPark(key){
  if(shop.hidden)return;
  shop.hidden=true;
  for(const el of shop.parentElement.children)el.inert=false;
  selectTheme(key);renderer.domElement.focus();
}
decks.forEach(deck=>deck.onclick=()=>enterShopPark(deck.dataset.key));
function shopGesture(result){
  if(shop.hidden)return;
  const p=result.multiHandLandmarks?.[0],cursor=$('#finger');
  let target=null,pinched=false;
  cursor.hidden=!p;
  if(p){
    const x=1-(p[4].x+p[8].x)/2,y=(p[4].y+p[8].y)/2,wall=$('#wall');
    cursor.style.left=x*100+'%';cursor.style.top=y*100+'%';
    const rect=wall.getBoundingClientRect();
    target=document.elementFromPoint(rect.left+wall.clientLeft+x*wall.clientWidth,rect.top+wall.clientTop+y*wall.clientHeight)?.closest('.deck');
    const dist=(a,b)=>Math.hypot((p[a].x-p[b].x)*video.videoWidth,(p[a].y-p[b].y)*video.videoHeight);
    pinched=dist(4,8)<dist(5,17)*.36;
  }
  for(const deck of decks)deck.classList.toggle('target',deck===target);
  const held=pinched&&target?target:null;
  if(held!==candidate){candidate=held;since=performance.now()}
  if(held&&performance.now()-since>=160)enterShopPark(held.dataset.key);
}
$('#shopCamera').onclick=async()=>{
  const button=$('#shopCamera'),hint=$('#shopHint');
  button.disabled=true;hint.textContent='Chrome에서 카메라 사용을 허용해 주세요.';
  const running=startCamera();
  try{
    const base='https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/';
    if(!window.Hands)await new Promise((ok,fail)=>{const s=document.createElement('script');s.src=base+'hands.js';s.onload=ok;s.onerror=fail;document.head.append(s)});
    if(!shop.hidden){
      shopHand=new window.Hands({locateFile:file=>base+file});shopHand.setOptions({maxNumHands:1,modelComplexity:0});shopHand.onResults(shopGesture);
      hint.textContent='손끝의 원을 데크에 놓고 엄지와 검지를 모아 주세요.';
    }
  }catch{hint.textContent='손 인식을 불러오지 못했어요. 데크를 클릭해 입장하세요.'}
  await running;button.disabled=false;if(!shop.hidden)hint.textContent=status.textContent;
};
addEventListener('pagehide',stopCamera);

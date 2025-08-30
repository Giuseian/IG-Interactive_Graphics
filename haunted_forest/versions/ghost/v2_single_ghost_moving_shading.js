// WORKING SINGLE GHOST WITH DYNAMIC TARGET (diagnostica inclusa)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { Ghost } from './entities/Ghost.js';
import { initHUD } from './ui/hud.js';

// ---- master switch per log rumorosi ----
window.DEBUG = false;

let scene, camera, renderer, controls, ghost, hud;
let ground, targetMarker, targetRing, targetBeacon;
let ghostArrow, seekLine, seekLineGeom, seekStrip, seekStripGeom;
let labelGhost, labelTarget;
let _t = performance.now() * 0.001;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// TARGET LOCK
const LOCK_TARGET = false;
const FIX_X = 4.0;
const FIX_Z = -4.0;
let isLocked = LOCK_TARGET;

let targetPoint = null;

const fmt = (v)=> v ? `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})` : 'null';
function snapshot(tag='snap') {
  const gp = ghost?.root?.position ?? null;
  const mp = targetMarker?.position ?? null;
  const tp = targetPoint ?? null;
  const dx = (mp?.x ?? 0) - (gp?.x ?? 0);
  const dz = (mp?.z ?? 0) - (gp?.z ?? 0);
  const d  = Math.hypot(dx,dz);
  if (window.DEBUG) console.log(`[${tag}] ghost=${fmt(gp)} marker=${fmt(mp)} targetAI=${fmt(tp)} sameRef=${mp===tp} dXZ=${d.toFixed(3)}`);
}

function makeLabel(){
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent:true, depthTest:false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(2.6, 0.65, 1);
  spr.userData.update = (text)=>{
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.font = '48px ui-sans-serif,system-ui,Arial';
    ctx.fillStyle = '#00000088';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#ffe7b3';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width/2, canvas.height/2);
    tex.needsUpdate = true;
  };
  spr.userData.update('');
  return spr;
}

(async function start(){ await init(); animate(); })();

async function init() {
  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fb3d9);
  scene.fog = new THREE.FogExp2(0xDFE9F3, 0.00015);

  // Camera + Controls
  camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 1000);
  camera.position.set(0, 1.8, 3.2);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 20.0;
  controls.target.set(0, 1.2, 0);
  controls.update();

  // Luci
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xfff1c1, 1.2); sun.position.set(5,10,4);
  scene.add(sun);

  // Ground
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x6b5b53, roughness: 1 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -0.10;
  scene.add(ground);

  // Target marker & ring
  const markerR = 0.6, ringR = 0.75;
  targetMarker = new THREE.Mesh(
    new THREE.CircleGeometry(markerR, 64),
    new THREE.MeshBasicMaterial({ color: 0xff8c00, depthTest:false, depthWrite:false })
  );
  targetMarker.rotation.x = -Math.PI/2; targetMarker.renderOrder = 999;

  targetRing = new THREE.Mesh(
    new THREE.RingGeometry(markerR*0.7, ringR, 64),
    new THREE.MeshBasicMaterial({ color: 0x111111, depthTest:false, depthWrite:false })
  );
  targetRing.rotation.x = -Math.PI/2; targetRing.renderOrder = 999;

  scene.add(targetMarker, targetRing);

  targetPoint = targetMarker.position;

  // Beacon
  targetBeacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 2.0, 22),
    new THREE.MeshBasicMaterial({ color: 0xff8c00, transparent:true, opacity:0.95, depthTest:false })
  );
  targetBeacon.frustumCulled = false; targetBeacon.renderOrder = 998;
  scene.add(targetBeacon);

  // Arrow
  ghostArrow = new THREE.ArrowHelper(new THREE.Vector3(0,0,1), new THREE.Vector3(), 1.5, 0x18c08f);
  ghostArrow.frustumCulled = false; ghostArrow.renderOrder = 997;
  scene.add(ghostArrow);

  // Line + strip
  seekLineGeom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  seekLine = new THREE.Line(seekLineGeom, new THREE.LineBasicMaterial({ color: 0xff8c00 }));
  seekLine.frustumCulled = false; seekLine.renderOrder = 996;
  scene.add(seekLine);

  seekStripGeom = new THREE.PlaneGeometry(1, 0.10);
  seekStrip = new THREE.Mesh(seekStripGeom, new THREE.MeshBasicMaterial({ color: 0xff8c00, transparent:true, opacity:0.6, side:THREE.DoubleSide }));
  seekStrip.rotation.x = -Math.PI/2; seekStrip.frustumCulled = false; seekStrip.renderOrder = 995;
  scene.add(seekStrip);

  // Labels
  labelGhost = makeLabel(); scene.add(labelGhost);
  labelTarget = makeLabel(); scene.add(labelTarget);

  // Target iniziale
  setTarget(FIX_X, FIX_Z);
  snapshot('lock');

  // Ghost
  const getGroundY = () => ground.position.y;
  ghost = new Ghost({
    url: '/assets/models/ghost/ghost.glb',
    targetHeight: 2.2,
    opacityBody: 0.75,
    getGroundY,
    clearance: 0.06,
    getTargetPos: () => targetPoint,
    speed: 1.2,
    keepDistance: 0.0,
    arriveRadius: 0.03,
  });
  await ghost.load();
  ghost.setPosition(0, 1.40, 0).addTo(scene);

  ghost.setDebugMode(0);   // 0 = NORMAL, spegne ogni vista di debug

  // forza compilazione shader
  renderer.compile(scene, camera);
  if (window.DEBUG) console.log('uniformSets at init:', ghost.uniformSets?.length, ghost.uniformSets);

  // Idle
  ghost.setIdleParams({
    baseY: 0.45,
    ampBob: 0.06,
    omegaBob: 1.2,
    swayAmpX: THREE.MathUtils.degToRad(4),
    swayAmpZ: THREE.MathUtils.degToRad(4),
    swayOmega: 1.05,
    minY: 0.35,
    maxY: 0.60,
  });

  ghost.appear();

  hud = initHUD();
  focusOnGhost(4.5);

  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  // Debug / controls
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k==='f') focusOnGhost(2.0);
    if (k==='t') { ghost.root.position.set(targetPoint.x, ghost.root.position.y, targetPoint.z); if (window.DEBUG) console.log('teleport ghost to target'); }
    if (k==='p') snapshot('manual');
    if (k==='o') toggleTopDown();

    if (k==='a') ghost.appear();
    if (k==='x') ghost.cleanse();
    if (k==='z') ghost.deactivate();

    if (k==='l') setLocked(!isLocked);

    // thresholds
    if (k==='1') { ghost?._setThreshold(1.0);  console.log('thr=1.0'); }
    if (k==='2') { ghost?._setThreshold(0.5);  console.log('thr=0.5'); }
    if (k==='3') { ghost?._setThreshold(0.25); console.log('thr=0.25'); }

    // diagnostica shader
    if (k==='9') {
      animate._dbgMode = ((animate._dbgMode ?? 0) + 1) % 4; // 0..3
      ghost.setDebugMode(animate._dbgMode);
      const labels = ['NORMAL','NOISE','MASK','EDGE'];
      console.log('[DEBUG MODE]', animate._dbgMode, labels[animate._dbgMode]);
    }
    if (k==='m') ghost.logMaterialsDebug();
    if (k==='r') { renderer.compile(scene, camera); console.log('[renderer] compile() called'); }

    // toggle log rumorosi
    if (k==='k') { window.DEBUG = !window.DEBUG; console.log('DEBUG =', window.DEBUG); }
  });

  setLocked(isLocked);

  addEventListener('resize', onResize);
  window.ghost = ghost; window.targetPoint = targetPoint; window.renderer = renderer; window.scene = scene; window.camera = camera;
}

function setLocked(v){
  isLocked = !!v;
  renderer.domElement.style.cursor = isLocked ? 'default' : 'crosshair';
  if (targetBeacon?.material) {
    targetBeacon.material.color.set(isLocked ? 0xff8c00 : 0x22cc88);
    targetBeacon.material.needsUpdate = true;
  }
  if (window.DEBUG) console.log(`[target] ${isLocked ? 'LOCKED' : 'UNLOCKED'}  (press L to toggle)`);
}

function setTarget(x, z){
  const gy = ground.position.y + 0.02;
  targetMarker.position.set(x, gy, z);
  targetRing.position.set(x, gy + 0.001, z);
  targetBeacon.position.set(x, gy + 1.0, z);
}

function onPointerDown(e){
  if (isLocked) return;
  if (e.button !== 0) return;
  ndc.x =  (e.clientX / innerWidth)  * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(ground, false)[0];
  if (hit) setTarget(hit.point.x, hit.point.z);
}

function focusOnGhost(offset = 2.0) {
  const box = new THREE.Box3().setFromObject(ghost.root);
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  const radius = 0.5 * Math.max(size.x, size.y, size.z);
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) * 0.5)) * offset;
  camera.position.set(center.x, center.y + radius * 0.6, center.z + dist);
  controls.target.set(center.x, center.y + radius * 0.5, center.z);
  controls.update();
}

// Toggle vista dall’alto (O)
let _savedCam = null;
function toggleTopDown(){
  if (_savedCam){
    camera.position.copy(_savedCam.pos);
    controls.target.copy(_savedCam.target);
    controls.enableRotate = _savedCam.rotate;
    controls.update();
    _savedCam = null;
    return;
  }
  _savedCam = { pos: camera.position.clone(), target: controls.target.clone(), rotate: controls.enableRotate };
  const gp = ghost.root.position, tp = targetPoint;
  const mid = new THREE.Vector3( (gp.x+tp.x)/2, 0, (gp.z+tp.z)/2 );
  camera.position.set(mid.x, 20, mid.z);
  controls.target.set(mid.x, 0, mid.z);
  controls.enableRotate = false;
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  const t = performance.now() * 0.001;
  const dt = Math.min(0.05, t - _t); _t = t;

  controls.update();

  const posPrev = ghost ? ghost.root.position.clone() : null;

  ghost?.update(dt);

  // HUD
  if (ghost) {
    const dNow = Math.hypot(targetPoint.x - ghost.root.position.x,
                            targetPoint.z - ghost.root.position.z);
    animate._dPrev = dNow;
    const thr = ghost._getThreshold ? ghost._getThreshold() : 1;
    hud?.setDebug({ state: ghost.state ?? 'inactive', threshold: thr, exposure: ghost.exposure ?? 0, dist: dNow });
  }

  // Arrow
  if (ghost && posPrev) {
    const origin = new THREE.Vector3().copy(ghost.root.position); origin.y += 1.1;
    const dir = new THREE.Vector3().copy(targetPoint).sub(origin); dir.y = 0;
    const len = dir.length();
    if (len > 1e-6) {
      dir.multiplyScalar(1/len);
      ghostArrow.position.copy(origin);
      ghostArrow.setDirection(dir);
      ghostArrow.setLength(THREE.MathUtils.clamp(len, 0.5, 3.0));
    }
    const moved = ghost.root.position.clone().sub(posPrev).setY(0);
    const toT   = targetPoint.clone().sub(posPrev).setY(0);
    if (moved.lengthSq()>1e-8 && toT.lengthSq()>1e-8) {
      const dot = moved.normalize().dot(toT.normalize());
      ghostArrow.setColor(new THREE.Color(dot < -0.01 ? 0xff3b30 : 0x18c08f));
      if (window.DEBUG && dot < -0.01) console.warn('Ghost si muove al contrario! dot=', dot.toFixed(3));
    }
  }

  // Linea & striscia a terra
  if (ghost && seekLine && seekStrip) {
    const gy = ground.position.y + 0.05;
    const gx = ghost.root.position.x, gz = ghost.root.position.z;
    const tx = targetPoint.x,        tz = targetPoint.z;

    const a = new THREE.Vector3(gx, gy, gz);
    const b = new THREE.Vector3(tx, gy, tz);
    seekLineGeom.attributes.position.setXYZ(0, a.x, a.y, a.z);
    seekLineGeom.attributes.position.setXYZ(1, b.x, b.y, b.z);
    seekLineGeom.attributes.position.needsUpdate = true;
    seekLineGeom.computeBoundingSphere();

    const midX = (gx + tx) * 0.5;
    const midZ = (gz + tz) * 0.5;
    const len  = Math.hypot(tx - gx, tz - gz);
    const yaw  = Math.atan2(tz - gz, tx - gx);
    seekStrip.position.set(midX, gy, midZ);
    seekStrip.rotation.y = yaw;
    seekStrip.scale.set(len, 1, 1);
  }

  // Labels 3D
  if (ghost && labelGhost && labelTarget) {
    const gp = ghost.root.position, tp = targetPoint;
    labelGhost.position.set(gp.x, gp.y + 1.8, gp.z);
    labelTarget.position.set(tp.x, ground.position.y + 1.6, tp.z);

    const d = Math.hypot(tp.x - gp.x, tp.z - gp.z);
    const status = isLocked ? '[locked]' : '[click to move]';
    labelGhost.userData.update(`ghost ${gp.x.toFixed(2)}, ${gp.z.toFixed(2)}  d=${d.toFixed(2)}`);
    labelTarget.userData.update(`target ${tp.x.toFixed(2)}, ${tp.z.toFixed(2)} ${status}`);
  }

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
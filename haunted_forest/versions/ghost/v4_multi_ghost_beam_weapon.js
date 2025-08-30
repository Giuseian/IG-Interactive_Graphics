// STEP 9: Beam + LOS + Overheat  (sul tuo step 8A)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { initHUD } from './ui/hud.js';
import { GhostSpawner } from './systems/GhostSpawner.js';
import { BeamSystem } from './systems/BeamSystem.js';

window.DEBUG = false;

let scene, camera, renderer, controls, hud, spawner, beam;
let ground, groundPlane;
let targetMarker, targetRing, targetBeacon;
let labelTarget;
let _t = performance.now() * 0.001;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

// Target lock / click-to-move
const LOCK_TARGET = false;
const FIX_X = 4.0, FIX_Z = -4.0;
let isLocked = LOCK_TARGET;
let targetPoint = null;

// input state per il beam (evita flicker da key-repeat)
const INPUT = { fireKey:false, fireMouse:false };

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
  camera.position.set(0, 6, 24);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2.0;
  controls.maxDistance = 60.0;
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

  // Piano infinito del terreno per fallback raycast
  groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ground.position.y);

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

  // Label target
  labelTarget = makeLabel(); scene.add(labelTarget);

  // Target iniziale
  setTarget(FIX_X, FIX_Z);

  // HUD
  hud = initHUD();

  // === Spawner (8A) con direzioni ===
  const getGroundY = () => ground.position.y;
  const getFocusPos = () => targetPoint; // il target funge da "player" ora
  spawner = new GhostSpawner({
    scene, camera, getGroundY, getFocusPos,
    poolSize: 12,
    maxAlive: 4,
    spawnInterval: 4.0,
    minR: 6.0,
    maxR: 14.0,
    minPlayerDist: 5.0,
    minSeparation: 2.0,

    spawnMode: 'mix',
    sectorHalfAngleDeg: 60,
    mixWeights: { front: 0.25, behind: 0.5, left: 0.125, right: 0.125 },
    antiPopIn: false,

    ghostOpts: {
      targetHeight: 2.2,
      opacityBody: 0.75,
      clearance: 0.06,
      speed: 1.2,
      keepDistance: 0.0,
      arriveRadius: 0.03,
    }
  });
  await spawner.init();

  // *** Bilanciamento esposizione: riduci il decadimento dei ghost ***
  for (const g of spawner.pool) g.params.exposureFalloff = 0.35;

  // === BEAM ===
  beam = new BeamSystem({
    scene, camera,
    halfAngleDeg: 16,      // cono un po' più largo
    maxRange: 22,
    exposureRate: 2.2,     // più incisivo
    heatRise: 0.35,        // ~3s ON prima di overheat
    heatFall: 0.6,         // cooldown più rapido
    overheatHi: 1.0,
    overheatLo: 0.4
  });
  // niente ostacoli per ora (forest arriverà dopo)
  beam.setObstacles([]);

  // Inquadratura panoramica dell’anello di spawn
  focusOnArena();

  // Input
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  // Beam input: RMB o SPACE
  renderer.domElement.addEventListener('contextmenu', (e)=>e.preventDefault());
  renderer.domElement.addEventListener('pointerdown', (e)=>{
    if (e.button === 2) { INPUT.fireMouse = true; e.preventDefault(); }
  });
  window.addEventListener('pointerup', (e)=>{
    if (e.button === 2) INPUT.fireMouse = false;
  });
  window.addEventListener('keydown', (e)=>{
    if (e.code === 'Space') { INPUT.fireKey = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e)=>{
    if (e.code === 'Space') INPUT.fireKey = false;
  });

  // Hotkeys utili
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k==='f') focusOnArena();
    if (k==='o') toggleTopDown();
    if (k==='l') setLocked(!isLocked);

    if (k==='b') {
      const order = ['mix','behind','front','left','right','none'];
      const i = order.indexOf(spawner.params.spawnMode);
      const next = order[(i+1) % order.length];
      spawner.setSpawnMode(next);
      console.log('[spawner] mode =', next);
    }
    if (k==='n') {
      spawner.toggleAntiPopIn();
      console.log('[spawner] antiPopIn =', spawner.params.antiPopIn);
    }

    if (k==='g' && !e.shiftKey) spawner.forceSpawnNow();
    if (k==='g' &&  e.shiftKey) spawner.fillToCap();
    if (k==='c') spawner.cleanseAll();
    if (k==='[') spawner.decMaxAlive(1);
    if (k===']') spawner.incMaxAlive(1);
    if (k===';') spawner.params.spawnInterval = Math.max(0.5, spawner.params.spawnInterval - 0.5);
    if (k==="'") spawner.params.spawnInterval += 0.5;

    if (k==='9') {
      animate._dbgMode = ((animate._dbgMode ?? 0) + 1) % 4;
      for (const g of spawner.active) g.setDebugMode(animate._dbgMode);
      const labels = ['NORMAL','NOISE','MASK','EDGE'];
      console.log('[DEBUG MODE]', animate._dbgMode, labels[animate._dbgMode]);
    }
    if (k==='m') for (const g of spawner.active) g.logMaterialsDebug();
  });

  setLocked(isLocked);

  addEventListener('resize', onResize);
  Object.assign(window, { spawner, targetPoint, renderer, scene, camera, beam });
}

function setLocked(v){
  isLocked = !!v;
  renderer.domElement.style.cursor = isLocked ? 'default' : 'crosshair';
  if (targetBeacon?.material) {
    targetBeacon.material.color.set(isLocked ? 0xff8c00 : 0x22cc88);
    targetBeacon.material.needsUpdate = true;
  }
}

function setTarget(x, z){
  const gy = ground.position.y + 0.02;
  targetMarker.position.set(x, gy, z);
  targetRing.position.set(x, gy + 0.001, z);
  targetBeacon.position.set(x, gy + 1.0, z);
}

function onPointerDown(e){
  // LMB = sposta target (se unlocked), RMB = beam: non toccare qui
  if (isLocked) return;
  if (e.button !== 0) return;

  ndc.x =  (e.clientX / innerWidth)  * 2 - 1;
  ndc.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);

  let hit = raycaster.intersectObject(ground, false)[0];
  if (hit) { setTarget(hit.point.x, hit.point.z); return; }

  const p = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, p)) setTarget(p.x, p.z);
}

// Panoramic view of the spawn ring around the target
function focusOnArena(pad = 2.0){
  const r = (spawner?.params?.maxR ?? 14) + pad;
  const fov = camera.fov * Math.PI / 180;
  const dist = r / Math.sin(fov * 0.5);
  camera.position.set(targetPoint.x, Math.max(3, 0.4*r), targetPoint.z + dist);
  controls.target.set(targetPoint.x, 0.6, targetPoint.z);
  controls.update();
}

// Optional top-down toggle (O)
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
  camera.position.set(targetPoint.x, 20, targetPoint.z);
  controls.target.set(targetPoint.x, 0, targetPoint.z);
  controls.enableRotate = false;
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  const t = performance.now() * 0.001;
  const dt = Math.min(0.05, t - _t); _t = t;

  controls.update();

  // Spawner tick + update ghosts
  spawner?.update(dt);
  for (const g of spawner?.active ?? []) g.update(dt);

  // === Beam: input stabile + update
  const wantFire = (INPUT.fireKey || INPUT.fireMouse);
  beam?.setFiring(wantFire);
  beam?.update(dt, spawner?.active ?? []);

  // HUD (mostra anche i dati dello spawner e il calore del beam)
  const lead = spawner?.firstActive?.();
  hud?.set(
    1,                             // health placeholder
    beam?.heat ?? 0,               // heat
    0,                             // score placeholder
    { overheated: !!(beam?.overheated) }
  );
  hud?.setDebug({
    state: lead?.state ?? 'none',
    threshold: lead?._getThreshold ? lead._getThreshold() : 1,
    exposure: lead?.exposure ?? 0,
    dist: lead ? Math.hypot(targetPoint.x - lead.root.position.x, targetPoint.z - lead.root.position.z) : 0,
    spawner: {
      alive: spawner?.active?.size ?? 0,
      pool: spawner?.pool?.length ?? 0,
      maxAlive: spawner?.params?.maxAlive ?? 0,
      nextIn: Math.max(0, spawner?.spawnCooldown ?? 0).toFixed(2),
      mode: spawner?.params?.spawnMode ?? 'mix',
      antiPopIn: !!spawner?.params?.antiPopIn
    }
  });

  // Target label
  if (labelTarget) {
    labelTarget.position.set(targetPoint.x, ground.position.y + 1.6, targetPoint.z);
    const status = isLocked ? '[locked]' : '[click to move]';
    labelTarget.userData.update(`target ${targetPoint.x.toFixed(2)}, ${targetPoint.z.toFixed(2)} ${status}`);
  }

  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
























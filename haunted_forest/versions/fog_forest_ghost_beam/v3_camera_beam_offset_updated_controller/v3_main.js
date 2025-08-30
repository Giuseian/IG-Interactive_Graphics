
// // // // // main.js — Pines + FBM Fog (safe) + HUD + Ghost SPAWNER + WASD (FPS) + BeamSystem (GIMBAL) + SANCTUARIES
// Updated Controller with FPS 
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
// (OrbitControls rimosso)

// Systems & UI
import { TreeCatalog } from './assets/TreeCatalog.js';
import { ForestSystem } from './systems/ForestSystem.js';
import { initHUD } from './ui/hud.js';
import { GhostSpawner } from './systems/GhostSpawner.js';
import { WASDController } from './systems/WASDController.js';
import { BeamSystem } from './systems/BeamSystem.js';
import { SanctuarySystem } from './systems/SanctuarySystem.js';

/* ---------- REGOLE COLORI PINO ---------- */
const PINE_RULES = [
  { name: 'leaves', matchMat:['材质.001'], matchObj:['leaves','leaf','ico','pine'],
    color:'#7FA36B', roughness:0.95, metalness:0.0, emissiveScale:0.5, emissiveIntensity:0.08, flatShading:true },
  { name: 'trunk',  matchMat:['材质'], matchObj:['trunk','cylinder'],
    color:'#B28C72', roughness:0.95, metalness:0.0, emissiveScale:0.5, emissiveIntensity:0.08, flatShading:true },
  { name: 'other',  color:'#BFBFBF', roughness:0.95, metalness:0.0, emissiveScale:0.4, emissiveIntensity:0.04, flatShading:true }
];
const PINE_OPTIONS = { mtlUrl:'/assets/models/trees/pine.mtl', keepSourceMaps:false, scale:18, rules:PINE_RULES };

/* Collezione degli shader patchati per aggiornare fogTime */
const _fogShaders = new Set();

/* ---------------- Fog FBM (SAFE: niente worldPosition) ---------------- */
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz - D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw); vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,p2),dot(p3,p3)));
}
float FBM(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){ v+=a*snoise(p); p*=2.0; a*=0.5; } return v; }
`;

THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying vec3 vFogWorldPos;
#endif
`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vec3 posW = (modelMatrix * vec4( transformed, 1.0 )).xyz;
  vFogWorldPos = posW;
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = NOISE_GLSL + `
#ifdef USE_FOG
  uniform float fogTime;
  uniform vec3 fogColor;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  vec3 fogOrigin = cameraPosition;
  vec3 dir = normalize(vFogWorldPos - fogOrigin);
  float dist = distance(vFogWorldPos, fogOrigin);

  vec3 sampleP = vFogWorldPos * 0.00025 + vec3(0.0, 0.0, fogTime * 0.025);
  float n = FBM(sampleP + FBM(sampleP)); n = n*0.5 + 0.5;

  float dcurve = pow(dist, 1.2);
  float baseExp = 1.0 - exp(-dcurve * fogDensity * 0.85);

  float y = dir.y; if(abs(y) < 1e-4) y = (y < 0.0 ? -1.0 : 1.0)*1e-4;
  float heightFactor = 0.12;
  float heightFog = heightFactor * exp(-fogOrigin.y * fogDensity) *
                    (1.0 - exp(-dcurve * y * fogDensity)) / y;

  float fogFactor = clamp(
    mix(heightFog, heightFog + baseExp*0.6, 0.7) * mix(n, 1.0, clamp((dist - 5000.0)/5000.0, 0.0, 1.0)),
    0.0, 1.0
  );
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
`;

/* --- utility per applicare uniforms fogTime a tutti i materiali --- */
function attachFogTo(root){
  root.traverse?.(child=>{
    const mat = child.material; if(!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    mats.forEach(m=>{
      m.fog = true;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (shader)=>{
        prev?.(shader);
        shader.uniforms.fogTime = { value: 0.0 };
        _fogShaders.add(shader);
      };
      m.needsUpdate = true;
    });
  });
}

/* ---------------- App & Game State ---------------- */
let scene, camera, renderer; // <- niente controls
let animateFog = true;
let debugEl;

const player = { health:1.0, heat:0.0, score:0, beamOn:false, overheated:false };

let hud;
let beam;      // spotlight scenico
let beamSystem;

// Systems
let forest;
let spawner;
let playerCtl;
let sanctuaries; // <===== NEW

// griglia collisione camera-tronchi
let _occGrid = null;

// input schema (gimbal): RMB = AIM, F = power toggle
let _aimHeld = false;
let _fireToggle = false;

// reticolo
let _reticleEl = null;

let _tPrev = performance.now() * 0.001;

init();
animate();

async function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0c0);

  // Fog (regolabile con [ e ])
  scene.fog = new THREE.FogExp2(0xDFE9F3, 1.6e-4);

  camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 20000);
  camera.position.set(0, 20, 120);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('game-canvas'),
    antialias: true
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const sun = new THREE.DirectionalLight(0xffe6b3, 1.0);
  sun.position.set(60, 120, 80);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000),
    new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 1 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- HUD ---
  hud = initHUD();

  // Reticolo (mirino)
  _reticleEl = document.createElement('div');
  _reticleEl.id = 'reticle';
  _reticleEl.style.cssText = `
    position:fixed; left:-9999px; top:-9999px; z-index:9999;
    width:10px; height:10px; border:2px solid #cfe8ff; border-radius:50%;
    box-shadow:0 0 6px #b4d9ff; pointer-events:none; opacity:0.9; transform:translate(-50%,-50%);
  `;
  document.body.appendChild(_reticleEl);

  // Spotlight (solo estetica, visibile quando il beam è attivo)
  beam = new THREE.SpotLight(0xcff2ff, 0, 60, THREE.MathUtils.degToRad(12), 0.35, 1.0);
  beam.visible = false;
  camera.add(beam);
  scene.add(camera);
  const beamTargetObj = new THREE.Object3D();
  scene.add(beamTargetObj);
  beam.target = beamTargetObj;

  // ===== INPUT =====
  // RMB = AIM (ora non tocca la rotazione, serve solo per il gimbal)
  addEventListener('mousedown', (e)=>{
    if (e.button === 2) { // RMB = AIM
      _aimHeld = true;
      beamSystem?.setAiming(true);
    }
  });
  addEventListener('mouseup', (e)=>{
    if (e.button === 2) {
      _aimHeld = false;
      beamSystem?.setAiming(false);
    }
  });
  renderer.domElement.addEventListener('contextmenu', (e)=> e.preventDefault());

  // Pointer Lock: click sul canvas per abilitare mouse-look (ESC per uscire)
  const canvas = renderer.domElement;
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  });
  // Mouse-look + (se AIM) delta al gimbal
  addEventListener('mousemove', (e)=>{
    if (document.pointerLockElement === canvas) {
      playerCtl?.onMouseDelta(e.movementX, e.movementY);
      if (_aimHeld) beamSystem?.onAimMouseDelta(e.movementX, e.movementY);
    }
  });

  addEventListener('keydown',   (e)=>{
    const code = e.code;

    if (code === 'KeyF') { // power toggle
      _fireToggle = !_fireToggle;
      e.preventDefault();
    }

    if (code === 'KeyP') spawner?.forceSpawnNow?.();
    if (code === 'KeyV') spawner?.toggleAntiPopIn?.();
    if (code === 'KeyC') spawner?.cleanseAll?.();
    if (code === 'KeyX') spawner?.cleanseNearest?.(camera.position);

    if (code === 'Comma')  { beamSystem?.decHalfAngle(1); e.preventDefault(); }
    if (code === 'Period') { beamSystem?.incHalfAngle(1); e.preventDefault(); }
    if (code === 'Digit9') { beamSystem?.decRange(10);    e.preventDefault(); }
    if (code === 'Digit0') { beamSystem?.incRange(10);    e.preventDefault(); }

    // quick look opzionale (snap dello yaw del controller)
    if (code === 'KeyQ') {
      const snap = e.shiftKey ? Math.PI : Math.PI/4;
      playerCtl?.addYaw(+snap);
      e.preventDefault();
    }
    if (code === 'KeyE') {
      playerCtl?.addYaw(-Math.PI/4);
      e.preventDefault();
    }
  });

  // Nebbia → materiali già presenti
  attachFogTo(scene);

  // --- forest + misura altezza tipica pino
  const env = await setupForest(scene);

  // Nebbia → materiali del forest
  attachFogTo(scene);

  // ---------- WASD Controller (FPS) ----------
  const getGroundY = (x, z) => 0.0;
  playerCtl = new WASDController({
    camera,
    getGroundY,
    eyeHeight: 20,
    speed: 50,
    sprintMultiplier: 1.6,
    accel: 12,
    friction: 6,
    bounds: { minX:-9500, maxX:9500, minZ:-9500, maxZ:9500 },
    sensX: 0.0018,
    sensY: 0.0016
  });

  // ---------------- GHOST SPAWNER ----------------
  const getFocusPos = () => new THREE.Vector3().copy(camera.position);

  spawner = new GhostSpawner({
    scene,
    camera,
    getGroundY,
    getFocusPos,

    poolSize: 14,
    maxAlive: 5,
    spawnInterval: 1.2,

    // anello ampio -> distribuzione sparsa nella foresta
    minR: 140,
    maxR: 260,
    minPlayerDist: 60,
    minSeparation: 40,

    spawnMode: 'mix',
    sectorHalfAngleDeg: 90,
    mixWeights: { front: 0.25, behind: 0.25, left: 0.25, right: 0.25 },
    antiPopIn : true,

    ghostOpts: {
      url: '/assets/models/ghost/ghost.glb',

      targetHeight: env.pineTypicalHeight * 0.10,
      scaleJitter: 0.28,
      opacityBody: 0.78,

      speed: 14.0,
      burstMultiplier: 1.6,

      keepDistance: 0.0,
      arriveRadius: 1.2,

      yawRateDeg: 720,

      // Swoop: partono molto alti, scendono tardi
      swoop: { far: 120, near: 55, hLow: 1.6, hHigh: 60.0, yLerp: 3.2 },

      weave: { amp: 0.9, omega: 0.9, fadeNear: 8, fadeFar: 90, enabled: true },

      hardLockDist: 60,

      // Idle "serpentina" visiva
      idleWeaveAmp: 0.35,
      idleWeaveOmega: 1.5
    },

    protectSeconds: 1.0
  });
  await spawner.init();

  // ===== BEAM SYSTEM (GIMBAL) =====
  beamSystem = new BeamSystem({
    scene,
    camera,
    halfAngleDeg: 20,
    maxRange: spawner.params.maxR,
    exposureRate: 4.2,
    smoothTau: 0.12,       // smoothing orientamento/posizione
    yawLimitDeg: 35,
    pitchLimitDeg: 25,
    sensX: 0.0018,
    sensY: 0.0016,
    recenterTau: 0.22
  });

  window.beamSystem = beamSystem;

  // (OPZIONALE) Ostacoli per LOS
  const USE_OCCLUSION = false;
  if (USE_OCCLUSION) {
    const occluderMeshes = [];
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    const matOcc = new THREE.MeshBasicMaterial({ visible: false });
    for (const c of forest.occluders) {
      const m = new THREE.Mesh(cylGeo, matOcc);
      m.position.set(c.pos.x, c.height * 0.5, c.pos.z);
      m.scale.set(c.radius, c.height, c.radius);
      m.updateMatrixWorld();
      occluderMeshes.push(m);
      scene.add(m);
    }
    beamSystem.setObstacles(occluderMeshes);
  }

  // ===== SANCTUARIES =====
  const TOTEM_COUNT = 3; // cambia liberamente
  const items = makeSanctuarySpots(TOTEM_COUNT, { minR: 350, maxR: 1200, minSeparation: 250 });
  sanctuaries = new SanctuarySystem({
    scene, camera,
    beamSystem,
    spawner,
    modelUrl: '/assets/models/totem/new_totem.fbx', // <-- metti il tuo path
    items,
    decayRate: 0.25,
    onPurified: (idx, totalDone, totalCount)=>{
      player.score += 100;
      if (spawner?.params) {
        spawner.params.maxAlive += 1;
        spawner.params.spawnInterval *= 0.9;
      }
      if (scene.fog) scene.fog.density *= 1.07;
      if (totalDone === totalCount) showWinOverlay();
    }
  });
  await sanctuaries.init();

  // griglia collisione camera–alberi
  _occGrid = buildOccluderGrid(forest.occluders, 120); // cell size ~120u

  // DESPAWN / CULLING
  spawner.params.despawnStyle       = 'deactivate';
  spawner.params.farCull            = spawner.params.maxR * 2.0;
  spawner.params.despawnBehindDist  = 60;
  spawner.params.minBehindRange     = 35;
  spawner.params.behindTime         = 1.5;

  setupDebug(beamTargetObj);
  addEventListener('resize', onResize);
}

async function setupForest(scene){
  const catalog = new TreeCatalog();
  const proto = await catalog.load('pine', '/assets/models/trees/pine.obj', PINE_OPTIONS);

  let protoHeight = 0;
  for (const { geometry } of proto.geometriesByMaterial) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    protoHeight = Math.max(protoHeight, bb.max.y - bb.min.y);
  }
  const sMed = 0.5 * (0.9 + 1.35);
  const pineTypicalHeight = protoHeight * sMed;

  forest = new ForestSystem(scene, {
    seed: 2025,
    innerRadius: 200,
    outerRadius: 6000,
    minSpacing: 22,
    maxSpacing: 34,
    count: 4500,
    scale: [0.9, 1.35],
    clearings: [{ x:0, z:0, r:200 }],
    types: [{
      name: 'pine',
      url: '/assets/models/trees/pine.obj',
      options: PINE_OPTIONS,
      occluderHeight: 160,
      occluderRadiusScale: 0.9
    }]
  }, catalog);

  const result = await forest.generate();
  console.log('Forest ready:', result);
  window.forest = forest;

  return { forest, pineTypicalHeight };
}

/* --- loop --- */
function animate(){
  requestAnimationFrame(animate);

  const tNow = performance.now() * 0.001;
  const dt   = Math.min(0.05, Math.max(0, tNow - _tPrev));
  _tPrev = tNow;

  // input/camera
  playerCtl?.update(dt);

  // soft collision camera–alberi
  resolveCameraCollision(camera.position, _occGrid, { camRadius: 8, maxIter: 2 });

  // fog time
  _fogShaders.forEach(s => { s.uniforms.fogTime.value = animateFog ? tNow : 0.0; });

  // stato BEAM: attivo se power ON e non overheated
  const activeBeam = _fireToggle && !player.overheated;

  // 1) ghost update
  spawner?.update(dt);

  // 2) beam update (orientamento/heat/exposure)
  if (beamSystem) {
    beamSystem.setFiring(activeBeam);
    beamSystem.update(dt, spawner?.active || []);

    // sync HUD heat/overheat
    player.heat       = beamSystem.heat;
    player.overheated = beamSystem.overheated;
  }

  // 2.5) sanctuaries update (usa dir/apice beam aggiornati)
  sanctuaries?.update(dt, {
    beamOn: activeBeam,
    playerPos: camera.position
  });

  // spotlight visivo (si spegne se overheat)
  beam.visible = activeBeam;

  // HUD base
  player.beamOn = _fireToggle;
  hud.set(
    player.health,
    player.heat,
    player.score,
    { overheated: player.overheated, beamOn: activeBeam }
  );

  // debug info
  const g = spawner?.firstActive?.();
  const thr = (g && g._getThreshold) ? g._getThreshold() : (g?.uniformSets?.[0]?.uThreshold?.value ?? 1.0);
  const dist = g ? Math.hypot(g.root.position.x - camera.position.x, g.root.position.z - camera.position.z) : 0;
  const spStats = spawner?.debugInfo?.() || null;

  // exposure dal bersaglio che stai realmente colpendo
  const focus = window.beamSystem?.getFocusInfo?.();
  const exposureForHUD = focus ? focus.exposure : (g?.exposure || 0);

  if (typeof hud.setDebug === 'function') {
    hud.setDebug({
      state: g?.state ?? 'inactive',
      threshold: thr,
      exposure: exposureForHUD,
      dist,
      spawner: spStats
    });
  }

  // aggiorna reticolo se in AIM
  updateReticle();

  renderer.render(scene, camera);

  updateDebug(spStats || {});
}

function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

/* -------- mini UI (debug) -------- */
function setupDebug(beamTargetObj){
  debugEl = document.createElement('div');
  debugEl.style.cssText = `
    position:fixed; left:8px; bottom:8px; z-index:9998;
    color:#dfe8f3; background:#0008; padding:6px 8px; border-radius:6px;
    font:12px/1.35 monospace; user-select:none; pointer-events:none; white-space:pre;`;
  document.body.appendChild(debugEl);

  addEventListener('keydown', (e)=>{
    switch(e.code){
      case 'BracketLeft':  scene.fog.density = Math.max(0, scene.fog.density - 1e-6); break;
      case 'BracketRight': scene.fog.density = Math.min(1, scene.fog.density + 1e-6); break;
      case 'Minus':        renderer.toneMappingExposure = Math.max(0.2, renderer.toneMappingExposure - 0.05); break;
      case 'Equal':        renderer.toneMappingExposure = Math.min(3.0, renderer.toneMappingExposure + 0.05); break;
      case 'KeyT':         animateFog = !animateFog; break;
      default: break;
    }
  });

  // punta lo spotlight lungo la FORWARD del BEAM
  const fwd  = new THREE.Vector3();
  const apex = new THREE.Vector3();
  const updateBeamTarget = ()=>{
    if (window.beamSystem) {
      window.beamSystem.getBeamForward(fwd);
      window.beamSystem.getBeamApex(apex);
    } else {
      camera.getWorldDirection(fwd);
      apex.copy(camera.position);
    }
    beamTargetObj.position.copy(apex).addScaledVector(fwd, 60);
  };
  const _origRender = renderer.render.bind(renderer);
  renderer.render = (a,b)=>{ updateBeamTarget(); _origRender(a,b); };
}

/* --------- Reticolo (proiezione 2D del puntamento del beam) --------- */
function updateReticle(){
  if (!_reticleEl || !window.beamSystem) return;
  if (!window.beamSystem.aiming) {
    _reticleEl.style.left = '-9999px';
    _reticleEl.style.top  = '-9999px';
    return;
  }
  const fwd = window.beamSystem.getBeamForward(new THREE.Vector3());
  const p = new THREE.Vector3().copy(camera.position).addScaledVector(fwd, 60);
  p.project(camera);
  if (p.z < -1 || p.z > 1) {
    _reticleEl.style.left = '-9999px';
    _reticleEl.style.top  = '-9999px';
    return;
  }
  const x = (p.x * 0.5 + 0.5) * innerWidth;
  const y = (-p.y * 0.5 + 0.5) * innerHeight;
  _reticleEl.style.left = x + 'px';
  _reticleEl.style.top  = y + 'px';
}

/* --------- Collisione camera–alberi (soft push-out) --------- */
function buildOccluderGrid(occs, cellSize = 100){
  const grid = new Map();
  const put = (i,j,idx)=>{
    const k = i+'|'+j;
    let arr = grid.get(k);
    if(!arr){ arr = []; grid.set(k, arr); }
    arr.push(idx);
  };
  for (let i=0;i<occs.length;i++){
    const c = occs[i];
    const ci = Math.floor(c.pos.x / cellSize);
    const cj = Math.floor(c.pos.z / cellSize);
    put(ci, cj, i);
  }
  return { grid, cellSize, occs };
}

function resolveCameraCollision(pos, grid, opt = {}){
  if (!grid) return;
  const camR = opt.camRadius ?? 8;
  const cell = grid.cellSize;
  const ci = Math.floor(pos.x / cell);
  const cj = Math.floor(pos.z / cell);

  const neigh = [
    [0,0], [1,0], [-1,0], [0,1], [0,-1],
    [1,1], [1,-1], [-1,1], [-1,-1]
  ];

  let iter = opt.maxIter ?? 1;
  while (iter-- > 0){
    let pushed = false;
    for (const [di,dj] of neigh){
      const k = (ci+di)+'|'+(cj+dj);
      const arr = grid.grid.get(k);
      if (!arr) continue;
      for (const idx of arr){
        const c = grid.occs[idx]; // {pos, radius, height}
        const dx = pos.x - c.pos.x;
        const dz = pos.z - c.pos.z;
        const d2 = dx*dx + dz*dz;
        const minR = (c.radius || 0) + camR;
        if (d2 < minR*minR){
          const d = Math.max(1e-4, Math.sqrt(d2));
          const nx = dx / d, nz = dz / d;
          const push = (minR - d);
          pos.x += nx * push;
          pos.z += nz * push;
          pushed = true;
        }
      }
    }
    if (!pushed) break;
  }
}

function updateDebug(spStats = {}){
  if(!debugEl) return;
  const heatPct = Math.round(player.heat*100);
  const beamState = player.overheated ? 'OVERHEATED' : (_fireToggle ? 'ON' : 'OFF');

  const spLine =
    ` | spawner: alive=${spStats.alive ?? 0}/${spStats.maxAlive ?? 0}` +
    ` pool=${spStats.pool ?? 0} next=${(spStats.nextIn ?? 0).toFixed?.(2) ?? '0.00'}` +
    ` mode=${spStats.mode ?? '-'} anti=${spStats.antiPopIn ? 'on' : 'off'}`;

  const beamInfo = window.beamSystem
    ? ` | cone:${window.beamSystem.halfAngleDeg}° range:${window.beamSystem.maxRange} hits:${window.beamSystem.hitsThisFrame}`
    : '';

  debugEl.innerHTML =
    `FogExp2+FBM density: ${scene.fog?.density.toExponential(2)}  |  ` +
    `Exposure: ${renderer.toneMappingExposure.toFixed(2)}  |  ` +
    `shaders:${_fogShaders.size}  |  anim:${animateFog?'ON':'OFF'}${spLine}${beamInfo}\n` +
    `Heat: ${player.overheated?'<span style="color:#ff6b6b">'+heatPct+'%</span>':heatPct+'%'}  ` +
    `| Beam: ${beamState}  (Pointer Lock: click canvas, ESC per uscire | RMB: AIM | F: power | P:spawn, V:antiPopIn, C:cleanse all, X:nearest, ,/. angle, 9/0 range, Q/E snap, Shift+Q 180°)`;
}


/* ---- Spots casuali per i santuari (ad anello) ---- */
function makeSanctuarySpots(count, opt = {}) {
  const minR = opt.minR ?? 350;
  const maxR = opt.maxR ?? 1200;
  const minSep = opt.minSeparation ?? 250;

  const spots = [];
  let tries = 0;
  while (spots.length < count && tries < 2000) {
    tries++;
    const r = THREE.MathUtils.lerp(minR, maxR, Math.random());
    const th = Math.random() * Math.PI * 2;
    const x = Math.cos(th) * r;
    const z = Math.sin(th) * r;

    // evita che due spot siano troppo vicini
    if (spots.every(s => Math.hypot(s.x - x, s.z - z) >= minSep)) {
      spots.push({
        x, z,
        radius: 22,        // raggio cerchio di attivazione
        holdSeconds: 3.0   // tempo da “illuminare” per purificare
      });
    }
  }
  return spots;
}

/* ---- Overlay di vittoria ---- */
function showWinOverlay() {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; inset:0; display:flex; align-items:center; justify-content:center;
    background:rgba(0,0,0,0.6); z-index:99999; color:#e9fbff; font-family:sans-serif;
  `;
  el.innerHTML = `
    <div style="text-align:center">
      <div style="font-size:42px; margin-bottom:8px;">Forest Cleansed!</div>
      <div style="opacity:.9; margin-bottom:16px;">Hai purificato tutti i santuari.</div>
      <button id="win-restart" style="
        font-size:18px; padding:10px 18px; border-radius:10px; border:0;
        background:#8ee6ff; color:#00313b; cursor:pointer;">Restart</button>
    </div>
  `;
  document.body.appendChild(el);
  const btn = el.querySelector('#win-restart');
  btn.addEventListener('click', ()=> location.reload());
  addEventListener('keydown', (e)=>{ if (e.code === 'KeyR') location.reload(); }, { once:true });
}
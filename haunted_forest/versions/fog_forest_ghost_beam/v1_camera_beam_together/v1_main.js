// // // // main.js — Pines + FBM Fog (safe) + HUD + Ghost SPAWNER + WASD + BeamSystem   - main with camera and beam moving together 

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

import { TreeCatalog } from './assets/TreeCatalog.js';
import { ForestSystem } from './systems/ForestSystem.js';
import { initHUD } from './ui/hud.js';
import { GhostSpawner } from './systems/GhostSpawner.js';
import { WASDController } from './systems/WASDController.js';
import { BeamSystem } from './systems/BeamSystem.js';

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
let scene, camera, renderer, controls;
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

// NEW: griglia leggera per collisione camera-tronchi
let _occGrid = null;

// NEW: input schema Opzione A
let _rmbHeld = false;   // hold-to-fire (RMB)
let _beamToggle = false; // F = toggle persistente

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

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enablePan = false;
  controls.target.set(0, 60, -600);

  // HUD
  hud = initHUD();

  // Spotlight (solo estetica, visibile quando il beam è attivo)
  beam = new THREE.SpotLight(0xcff2ff, 0, 60, THREE.MathUtils.degToRad(12), 0.35, 1.0);
  beam.visible = false;
  camera.add(beam);
  scene.add(camera);
  const beamTargetObj = new THREE.Object3D();
  scene.add(beamTargetObj);
  beam.target = beamTargetObj;

  // ===== INPUT =====
  // RMB = hold-to-fire (LMB resta libero per ruotare)
  addEventListener('mousedown', (e)=>{
    if (e.button === 2) { // right mouse
      _rmbHeld = true;
    }
  });
  addEventListener('mouseup', (e)=>{
    if (e.button === 2) {
      _rmbHeld = false;
    }
  });
  // niente menu contestuale sul canvas
  renderer.domElement.addEventListener('contextmenu', (e)=> e.preventDefault());

  // Tastiera
  addEventListener('keydown',   (e)=>{
    const k = e.key;

    // F = toggle persistente (se non overheated)
    if (k.toLowerCase() === 'f' && !player.overheated) {
      _beamToggle = !_beamToggle;
    }

    if (k === 'p' || k === 'P') spawner?.forceSpawnNow?.();
    if (k === 'v' || k === 'V') spawner?.toggleAntiPopIn?.();
    if (k === 'c' || k === 'C') spawner?.cleanseAll?.();
    if (k === 'x' || k === 'X') spawner?.cleanseNearest?.(camera.position);

    // tuning beam (angolo/range)
    if (k === ',') beamSystem?.decHalfAngle(1);
    if (k === '.') beamSystem?.incHalfAngle(1);
    if (k === '9') beamSystem?.decRange(10);
    if (k === '0') beamSystem?.incRange(10);

    // quick look con tastiera (Q/E = ±45°, Shift+Q = 180°)
    if (k === 'q' || k === 'Q') {
      const snap = e.shiftKey ? Math.PI : Math.PI/4;
      controls.rotateLeft(snap);
      controls.update();
    }
    if (k === 'e' || k === 'E') {
      controls.rotateLeft(-Math.PI/4);
      controls.update();
    }
  });

  // Nebbia → materiali già presenti
  attachFogTo(scene);

  // --- forest + misura altezza tipica pino
  const env = await setupForest(scene);

  // Nebbia → materiali del forest
  attachFogTo(scene);

  // ---------- WASD Controller ----------
  const getGroundY = (x, z) => 0.0;
  playerCtl = new WASDController({
    camera,
    controls,
    getGroundY,
    eyeHeight: 20,
    speed: 50,
    sprintMultiplier: 1.6,
    accel: 12,
    friction: 6,
    bounds: { minX:-9500, maxX:9500, minZ:-9500, maxZ:9500 }
  });

  // ---------------- GHOST SPAWNER ----------------
  // Target = posizione della camera
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

  // ===== BEAM SYSTEM (LOGICA + CONO VISIVO + SMOOTHING) =====
  beamSystem = new BeamSystem({
    scene,
    camera,
    halfAngleDeg: 20,                 // più largo → più facile colpire
    maxRange: spawner.params.maxR,    // >= raggio max di spawn (260 nel tuo setup)
    exposureRate: 4.2,                // carica più veloce (vs falloff 0.6 dei ghost)
    smoothTau: 0.12                   // smussa direzione/posizione del cono
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

  // NEW: costruisci la griglia per collisione camera–alberi
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

  // NEW: soft collision camera–alberi
  resolveCameraCollision(camera.position, _occGrid, { camRadius: 8, maxIter: 2 });

  // fog time
  _fogShaders.forEach(s => { s.uniforms.fogTime.value = animateFog ? tNow : 0.0; });

  // stato BEAM: attivo se RMB o toggle, e non overheated
  const activeBeam = (_rmbHeld || _beamToggle) && !player.overheated;

  // 1) prima aggiorniamo i ghost (decadimento esposizione)
  spawner?.update(dt);

  // 2) poi il beam (carica esposizione + smoothing direzione)
  if (beamSystem) {
    beamSystem.setFiring(activeBeam);
    beamSystem.update(dt, spawner?.active || []);

    // sincronizza HUD con lo stato reale del beam (heat/overheat)
    player.heat       = beamSystem.heat;
    player.overheated = beamSystem.overheated;
  }

  // spotlight visivo (si spegne se overheat)
  beam.visible = activeBeam;

  // HUD base (mostro lo stato "desiderato", indipendente dall'overheat)
  player.beamOn = (_rmbHeld || _beamToggle);
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

  controls.update();
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
    position:fixed; left:8px; bottom:8px; z-index:9999;
    color:#dfe8f3; background:#0008; padding:6px 8px; border-radius:6px;
    font:12px/1.35 monospace; user-select:none; pointer-events:none; white-space:pre;`;
  document.body.appendChild(debugEl);

  addEventListener('keydown', (e)=>{
    switch(e.key){
      case '[': scene.fog.density = Math.max(0, scene.fog.density - 1e-6); break;
      case ']': scene.fog.density = Math.min(1, scene.fog.density + 1e-6); break;
      case '-': renderer.toneMappingExposure = Math.max(0.2, renderer.toneMappingExposure - 0.05); break;
      case '=':
      case '+': renderer.toneMappingExposure = Math.min(3.0, renderer.toneMappingExposure + 0.05); break;
      case 't':
      case 'T': animateFog = !animateFog; break;
      default: break;
    }
  });

  // punta lo spotlight davanti alla camera
  const fwd = new THREE.Vector3();
  const updateBeamTarget = ()=>{
    camera.getWorldDirection(fwd);
    beamTargetObj.position.copy(camera.position).addScaledVector(fwd, 60);
  };
  const _origRender = renderer.render.bind(renderer);
  renderer.render = (a,b)=>{ updateBeamTarget(); _origRender(a,b); };
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

  // controlliamo solo le 9 celle attorno
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
  const beamState = player.overheated ? 'OVERHEATED' : ((_rmbHeld || _beamToggle) ? 'ON' : 'OFF');

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
    `| Beam: ${beamState}  (RMB hold, F toggle | P:spawn, V:antiPopIn, C:cleanse all, X:nearest, ,/. angle, 9/0 range, Q/E snap, Shift+Q 180°)`;
}




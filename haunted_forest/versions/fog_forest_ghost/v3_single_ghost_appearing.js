// main.js — Pines + FBM Fog + HUD + Beam Heat + Ghost (stati + HUD + tuning look)   - higher starting point (partiamo da un'altezza più alta - singolo ghost)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

import { TreeCatalog } from './assets/TreeCatalog.js';
import { ForestSystem } from './systems/ForestSystem.js';
import { initHUD } from './ui/hud.js';
import { Ghost } from './entities/Ghost.js';

/* ---------- REGOLE COLORI PINO ---------- */
const PINE_RULES = [
  { name: 'leaves', matchMat:['材质.001'], matchObj:['leaves','leaf','ico','pine'],
    color:'#7FA36B', roughness:0.95, metalness:0.0, emissiveScale:0.5, emissiveIntensity:0.08, flatShading:true },
  { name: 'trunk',  matchMat:['材质'], matchObj:['trunk','cylinder'],
    color:'#B28C72', roughness:0.95, metalness:0.0, emissiveScale:0.5, emissiveIntensity:0.08, flatShading:true },
  { name: 'other',  color:'#BFBFBF', roughness:0.95, metalness:0.0, emissiveScale:0.4, emissiveIntensity:0.04, flatShading:true }
];

const PINE_OPTIONS = { mtlUrl:'/assets/models/trees/pine.mtl', keepSourceMaps:false, scale:18, rules:PINE_RULES };

/* ---------------- Fog FBM (patch ai chunk) ---------------- */
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
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float FBM(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<6;i++){ v+=a*snoise(p); p*=2.0; a*=0.5; } return v; }
`;
THREE.ShaderChunk.fog_pars_vertex = `
#ifdef USE_FOG
  varying vec3 vWorldPosition;
#endif
`;
THREE.ShaderChunk.fog_vertex = `
#ifdef USE_FOG
  vWorldPosition = worldPosition.xyz;
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = NOISE_GLSL + `
#ifdef USE_FOG
  uniform float fogTime;
  uniform vec3 fogColor;
  varying vec3 vWorldPosition;
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
  vec3 dir = normalize(vWorldPosition - fogOrigin);
  float dist = distance(vWorldPosition, fogOrigin);

  vec3 sampleP = vWorldPosition * 0.00025 + vec3(0.0, 0.0, fogTime * 0.025);
  float n = FBM(sampleP + FBM(sampleP)); n = n*0.5 + 0.5;

  dist *= mix(n, 1.0, clamp((dist - 5000.0)/5000.0, 0.0, 1.0));
  dist *= dist;

  float y = dir.y; if(abs(y) < 1e-4) y = (y < 0.0 ? -1.0 : 1.0)*1e-4;
  float heightFactor = 0.05;
  float fogFactor = heightFactor * exp(-fogOrigin.y * fogDensity) *
                    (1.0 - exp(-dist * y * fogDensity)) / y;

  fogFactor = clamp(fogFactor, 0.0, 1.0);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif
`;



/* uniform fogTime per tutti i materiali */
const _fogShaders = new Set();
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
const HEAT_RATE=0.35, COOL_RATE=0.50, OVERHEAT_ON=1.0, OVERHEAT_OFF=0.60;

let hud;
let beam, beamTarget;

// Ghost
let ghost = null;

let _tPrev = performance.now() * 0.001;

init();
animate();

async function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0c0);
  scene.fog = new THREE.FogExp2(0xDFE9F3, 5e-6);

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
  controls.target.set(0, 60, -600);

  // HUD
  hud = initHUD();

  // Beam (SpotLight) agganciato alla camera
  beam = new THREE.SpotLight(0xcff2ff, 0, 60, THREE.MathUtils.degToRad(12), 0.35, 1.0);
  beam.visible = false;
  camera.add(beam);
  scene.add(camera);
  beamTarget = new THREE.Object3D();
  scene.add(beamTarget);
  beam.target = beamTarget;

  // Input beam
  addEventListener('mousedown', (e)=>{ if (e.button === 0 && !player.overheated) player.beamOn = true; });
  addEventListener('mouseup',   (e)=>{ if (e.button === 0) player.beamOn = false; });
  addEventListener('keydown',   (e)=>{
    const k = e.key;
    if (k.toLowerCase() === 'f' && !player.overheated) player.beamOn = !player.beamOn;
    if (k==='0') ghost?.setDebugMode(0);
    if (k==='1') ghost?.setDebugMode(1);
    if (k==='2') ghost?.setDebugMode(2);
    if (k==='3') ghost?.setDebugMode(3);
  });

  attachFogTo(scene);

  // --- forest + misura altezza tipica pino
  const env = await setupForest(scene);

  attachFogTo(scene);


  // ---------------- GHOST ----------------
  const GHOST_LIFT = 10.0; // prova 4..10

  // ...dentro init(), PRIMA di creare il Ghost:
  const ghostAnchor = new THREE.Object3D();
  ghostAnchor.position.set(0, GHOST_LIFT, 0); // solleva tutto il ghost
  scene.add(ghostAnchor);

  ghost = await new Ghost({
    url: '/assets/models/ghost/ghost.glb',
    targetHeight: env.pineTypicalHeight * 0.50,
    opacityBody: 0.78,
    getGroundY: (x, z) => 0.0,   // lascia 0 se non campioni il terreno
    getTargetPos: null,
    speed: 0,
    keepDistance: 0.0,
    arriveRadius: 1.0
  }).load();

  ghost.addTo(ghostAnchor);
  ghost.setPosition(0, 0, 0);
  ghost.appear();

  tuneGhostLook();

  window.ghost = ghost;

  setupDebug();
  addEventListener('resize', onResize);
}

// Ritorna anche l'altezza tipica del pino per scalare il ghost
async function setupForest(scene){
  const catalog = new TreeCatalog();
  const proto = await catalog.load('pine', '/assets/models/trees/pine.obj', PINE_OPTIONS);

  // Altezza del prototipo (dopo scale in PINE_OPTIONS)
  let protoHeight = 0;
  for (const { geometry } of proto.geometriesByMaterial) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    protoHeight = Math.max(protoHeight, bb.max.y - bb.min.y);
  }
  const sMed = 0.5 * (0.9 + 1.35);
  const pineTypicalHeight = protoHeight * sMed;

  const forest = new ForestSystem(scene, {
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

function tuneGhostLook(){
  if (!ghost) return;
  ghost.setDebugMode?.(0);
  const sets = ghost.uniformSets || [];
  for (const s of sets){
    if (s.uNoiseScale) s.uNoiseScale.value = 0.18;
    if (s.uEdgeWidth)  s.uEdgeWidth.value  = 0.065;
    if (s.uFlowSpeed)  s.uFlowSpeed.value  = 0.12;
    if (s.uPulseTime)  s.uPulseTime.value  = 0.0;
    if (s.uThreshold)  s.uThreshold.value  = 0.06;
    if (s.uEdgeColor){
      const c = s.uEdgeColor.value instanceof THREE.Color ? s.uEdgeColor.value : (s.uEdgeColor.value = new THREE.Color());
      c.set('#eaf6ff');
    }
  }
}

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function updateBeamHeat(dt){
  if (player.beamOn && !player.overheated) player.heat += HEAT_RATE * dt;
  else                                     player.heat -= COOL_RATE * dt;
  player.heat = clamp01(player.heat);

  if (!player.overheated && player.heat >= OVERHEAT_ON) {
    player.overheated = true;
    player.beamOn = false;
  } else if (player.overheated && player.heat <= OVERHEAT_OFF) {
    player.overheated = false;
  }
}

function animate(){
  requestAnimationFrame(animate);

  const tNow = performance.now() * 0.001;
  const dt   = Math.min(0.05, Math.max(0, tNow - _tPrev));
  _tPrev = tNow;

  _fogShaders.forEach(s => { s.uniforms.fogTime.value = animateFog ? tNow : 0.0; });

  updateBeamHeat(dt);
  const active = player.beamOn && !player.overheated;
  beam.visible   = active;
  beam.intensity = active ? 3.5 : 0.0;
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  beamTarget.position.copy(camera.position).addScaledVector(fwd, 60);

  hud.set(player.health, player.heat, player.score, { overheated: player.overheated, beamOn: active });

  if (ghost) {
    ghost.update(dt);
    const thr  = ghost._getThreshold ? ghost._getThreshold() : (ghost.uniformSets?.[0]?.uThreshold?.value ?? 1.0);
    const dist = Math.hypot(ghost.root.position.x - camera.position.x,
                            ghost.root.position.z - camera.position.z);
    if (typeof hud.setGhost === 'function') {
      hud.setGhost({ state: ghost.state, thr, exp: ghost.exposure || 0, dist });
    } else if (typeof hud.setDebug === 'function') {
      hud.setDebug({ state: ghost.state, threshold: thr, exposure: ghost.exposure || 0, dist });
    }
  }

  controls.update();
  renderer.render(scene, camera);
  updateDebug();
}

function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

/* -------- mini UI (debug) -------- */
function setupDebug(){
  debugEl = document.createElement('div');
  debugEl.style.cssText = `
    position:fixed; left:8px; bottom:8px; z-index:9999;
    color:#dfe8f3; background:#0008; padding:6px 8px; border-radius:6px;
    font:12px/1.35 monospace; user-select:none; pointer-events:none; white-space:pre;`;
  document.body.appendChild(debugEl);

  addEventListener('keydown', (e)=>{
    switch(e.key){
      case '[': scene.fog.density = clamp01(scene.fog.density - 1e-6); break;
      case ']': scene.fog.density = clamp01(scene.fog.density + 1e-6); break;
      case '-': renderer.toneMappingExposure = Math.max(0.2, renderer.toneMappingExposure - 0.05); break;
      case '=':
      case '+': renderer.toneMappingExposure = Math.min(3.0, renderer.toneMappingExposure + 0.05); break;
      case 'a':
      case 'A': animateFog = !animateFog; break;
      default: break;
    }
  });
}
function updateDebug(){
  if(!debugEl) return;
  const heatPct = Math.round(player.heat*100);
  const beamState = player.overheated ? 'OVERHEATED' : (player.beamOn ? 'ON' : 'OFF');

  debugEl.innerHTML =
    `FogExp2+FBM density: ${scene.fog?.density.toExponential(2)}  |  ` +
    `Exposure: ${renderer.toneMappingExposure.toFixed(2)}  |  ` +
    `shaders:${_fogShaders.size}  |  anim:${animateFog?'ON':'OFF'}\n` +
    `Heat: ${player.overheated?'<span style="color:#ff6b6b">'+heatPct+'%</span>':heatPct+'%'}  ` +
    `| Beam: ${beamState}  (Mouse L o F)`;
}
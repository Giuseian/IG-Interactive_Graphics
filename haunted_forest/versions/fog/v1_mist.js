// // Import Three.js core and OrbitControls  - buona gradualità 
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let ambient, sun, moon, hemi;
let ground;
let debugEl;
let skyDome, skyMat;

// === PERCORSO TEXTURE (cambialo se serve) ===
const TEX_BASE = 'assets/textures/grass/';

// Debug cache for overlay
const _dbg = { sunUp:0, wAmb:0, wExp:0, wFog:0, uFogH:0, uFogD:0, tile:32 };

// ---------- TINTA LEGGERA DEL TERRENO (Opzione A.2) ----------
let TINT_STRENGTH = 0.35; // 0 = no tint, 1 = full tint

// === Palettes (night/day endpoints) ===
const PALETTE = {
  night: {
    fogColor: 0x0a1220, fogDensity: 0.025,
    ambientColor: 0xb1c0d4, ambientIntensity: 0.14,
    sunColor: 0xbfd6ff, sunIntensity: 1.0,
    hemiSky: 0x1a2738, hemiGround: 0x141414, hemiIntensity: 0.06,
    groundColor: 0x20261b, exposure: 1.00
  },
  day: {
    fogColor: 0xd7dee6, fogDensity: 0.010,
    ambientColor: 0xfff0d0, ambientIntensity: 0.38,
    sunColor: 0xffe6b3, sunIntensity: 1.7,
    hemiSky: 0xcfe4ff, hemiGround: 0xb0b6aa, hemiIntensity: 0.18,
    groundColor: 0x4b5a39, exposure: 1.18
  }
};

// ---- Day–Night constants ----
const DAY_LENGTH = 120;
const SKY_RADIUS  = 120;

// ---- Time driver ----
let startTime = performance.now();
let timeScale = 1;
let manualPhase = null;

// === SkyDome gradient colors ===
const FOG_DAY   = new THREE.Color(PALETTE.day.fogColor);
const FOG_NIGHT = new THREE.Color(PALETTE.night.fogColor);

const SKY_DAY_TOP    = new THREE.Color(0x89c7ff);
const SKY_DAY_BOTTOM = FOG_DAY.clone();
const SKY_NIGHT_TOP  = new THREE.Color(0x0a1330);
const SKY_NIGHT_BOTTOM = FOG_NIGHT.clone();

// === Fog preset controller (keys F1/F2/F3) ===
const FogPreset = {
  multiplier: 1.0,
  heightDay:  55.0,
  heightNight:35.0,
  densityBoost: 12.0,
  horizonWidth: 0.32,
  horizonPower: 1.4
};

// === Skydome shaders ===
const SKY_VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos;

  uniform vec3 uCamPos;

  uniform vec3 topDay;
  uniform vec3 bottomDay;
  uniform vec3 topNight;
  uniform vec3 bottomNight;

  uniform vec3 sunDir;
  uniform vec3 moonDir;
  uniform float sunUp;

  uniform float sunSize;
  uniform float sunSoftness;
  uniform float sunIntensity;

  uniform float moonSize;
  uniform float moonSoftness;
  uniform float moonIntensity;

  uniform vec3  uFogColor;
  uniform float uFogDensity;
  uniform float uFogHeight;
  uniform float uHorizonWidth;
  uniform float uHorizonPower;

  float softDisc(vec3 dir, vec3 centerDir, float size, float softness){
    float cosAng = dot(normalize(dir), normalize(centerDir));
    float inner = cos(size);
    float outer = cos(size + softness);
    float t = clamp((cosAng - outer) / max(1e-5, (inner - outer)), 0.0, 1.0);
    return t;
  }

  void main() {
    vec3 dir = normalize(vWorldPos - uCamPos);

    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 gradDay   = mix(bottomDay,  topDay,   h);
    vec3 gradNight = mix(bottomNight, topNight, h);
    vec3 baseCol   = mix(gradNight, gradDay, sunUp);

    float sunMask  = softDisc(dir, sunDir,  sunSize,  sunSoftness);
    vec3  sunCol   = vec3(1.0, 0.92, 0.75) * sunIntensity * sunMask;

    float moonMask = softDisc(dir, moonDir, moonSize, moonSoftness);
    vec3  moonCol  = vec3(0.8, 0.9, 1.0)   * moonIntensity * moonMask;

    float t = 1.0 - smoothstep(0.0, uHorizonWidth, max(dir.y, 0.0));
    t = pow(t, uHorizonPower);
    float dens = uFogDensity * (uFogHeight * 0.02);
    float fogAmt = 1.0 - exp(-t * dens * 4.0);
    fogAmt = clamp(fogAmt, 0.0, 1.0);

    vec3 fogged = mix(uFogColor, baseCol, 1.0 - fogAmt);

    gl_FragColor = vec4(fogged + sunCol + moonCol, 1.0);
  }
`;

init();
animate();

function init() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
  camera.position.set(0, 6, 16);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('game-canvas'),
    antialias: true
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setClearColor(0x000000, 1);

  // Lights
  ambient = new THREE.AmbientLight(0xffffff, 0.2);
  scene.add(ambient);

  sun = new THREE.DirectionalLight(PALETTE.day.sunColor, 1.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.camera.left = -50;
  sun.shadow.camera.right = 50;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  scene.add(sun);

  moon = new THREE.DirectionalLight(0xbfd6ff, 0.0);
  scene.add(moon);

  hemi = new THREE.HemisphereLight(PALETTE.night.hemiSky, PALETTE.night.hemiGround, PALETTE.night.hemiIntensity);
  scene.add(hemi);

  // Fog baseline (night)
  scene.fog = new THREE.FogExp2(PALETTE.night.fogColor, PALETTE.night.fogDensity);

  // Ground (plane + material)
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,   // base bianca: la tinta la applichiamo noi
    roughness: 0.9,
    metalness: 0.0
  });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Carica e applica le texture prato
  setupGroundTextures();

  // Test box
  const testBox = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0x8aa37b })
  );
  testBox.position.set(0, 1, 0);
  testBox.castShadow = true;
  scene.add(testBox);

  // Orbit controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 1, 0);

  // === Skydome ===
  const skyGeo = new THREE.SphereGeometry(1000, 48, 32);
  skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      topDay:       { value: SKY_DAY_TOP.clone() },
      bottomDay:    { value: SKY_DAY_BOTTOM.clone() },
      topNight:     { value: SKY_NIGHT_TOP.clone() },
      bottomNight:  { value: SKY_NIGHT_BOTTOM.clone() },
      sunDir:       { value: new THREE.Vector3(0,1,0) },
      moonDir:      { value: new THREE.Vector3(0,-1,0) },
      sunUp:        { value: 0.0 },
      sunSize:      { value: 0.07 },
      sunSoftness:  { value: 0.03 },
      sunIntensity: { value: 1.5 },
      moonSize:     { value: 0.05 },
      moonSoftness: { value: 0.03 },
      moonIntensity:{ value: 1.0 },
      uFogColor:    { value: new THREE.Color(scene.fog.color) },
      uFogDensity:  { value: scene.fog.density * FogPreset.densityBoost * FogPreset.multiplier },
      uFogHeight:   { value: FogPreset.heightNight },
      uCamPos:      { value: new THREE.Vector3() },
      uHorizonWidth:{ value: FogPreset.horizonWidth },
      uHorizonPower:{ value: FogPreset.horizonPower }
    }
  });
  skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -9999;
  scene.add(skyDome);

  // Resize + UI
  addEventListener('resize', onResize);
  setupLiveTuning();
  setLightingMood('night');
  setupPresetKeys();
  setupTimeKeys();
  setupTilingKeys();
  setupTintKey();            // <— toggle T
  updateDebugUI();
}

// ====== TEXTURE GROUND ======
function setupGroundTextures(){
  const loader   = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy?.() ?? 8;

  const map = loader.load(TEX_BASE + 'Grass002_4K_Color.jpg');
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAniso;

  const normalMap = loader.load(TEX_BASE + 'Grass002_4K_NormalGL.jpg');
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.anisotropy = maxAniso;

  const roughnessMap = loader.load(TEX_BASE + 'Grass002_4K_Roughness.jpg');
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAniso;

  const aoMap = loader.load(TEX_BASE + 'Grass002_4K_AmbientOcclusion.jpg');
  aoMap.wrapS = aoMap.wrapT = THREE.RepeatWrapping;
  aoMap.anisotropy = maxAniso;

  const TILE = _dbg.tile;
  map.repeat.set(TILE, TILE);
  normalMap.repeat.set(TILE, TILE);
  roughnessMap.repeat.set(TILE, TILE);
  aoMap.repeat.set(TILE, TILE);

  ground.material.map = map;
  ground.material.normalMap = normalMap;
  ground.material.roughnessMap = roughnessMap;
  ground.material.aoMap = aoMap;
  ground.material.aoMapIntensity = 1.0;
  ground.material.roughness = 1.0;
  ground.material.metalness = 0.0;
  ground.material.needsUpdate = true;

  // AO richiede uv2
  if (!ground.geometry.getAttribute('uv2')) {
    ground.geometry.setAttribute('uv2', ground.geometry.getAttribute('uv'));
  }
}

function applyTiling(n){
  const m = ground.material;
  if (m.map) m.map.repeat.set(n, n);
  if (m.normalMap) m.normalMap.repeat.set(n, n);
  if (m.roughnessMap) m.roughnessMap.repeat.set(n, n);
  if (m.aoMap) m.aoMap.repeat.set(n, n);
  _dbg.tile = n;
}

// Apply palette instantly (for N/M toggles only)
function setLightingMood(mode) {
  const p = PALETTE[mode];
  if (!p) return;

  if (!scene.fog) scene.fog = new THREE.FogExp2(p.fogColor, p.fogDensity);
  scene.fog.color.setHex(p.fogColor);
  scene.fog.density = p.fogDensity;

  ambient.color.setHex(p.ambientColor);
  ambient.intensity = p.ambientIntensity;

  sun.color.setHex(p.sunColor);
  sun.intensity = p.sunIntensity;

  hemi.color.setHex(p.hemiSky);
  hemi.groundColor.setHex(p.hemiGround);
  hemi.intensity = p.hemiIntensity;

  renderer.toneMappingExposure = p.exposure;

  // colore base lasciato a bianco, la tinta è gestita in updateDayNight()
  ground.material.color.set(0xffffff);
}

// Helpers
function smooth01(x, a, b){
  const t = THREE.MathUtils.clamp((x - a) / Math.max(1e-5, (b - a)), 0, 1);
  return t * t * (3 - 2 * t);
}

// Day–Night animation
function updateDayNight(timeSec) {
  const phase = (timeSec % DAY_LENGTH) / DAY_LENGTH;
  const ang   = phase * Math.PI * 2;

  sun.position.set(Math.cos(ang) * SKY_RADIUS,  Math.sin(ang) * SKY_RADIUS,  0);
  moon.position.set(Math.cos(ang + Math.PI) * SKY_RADIUS, Math.sin(ang + Math.PI) * SKY_RADIUS, 0);

  const sunUp  = Math.max(0, Math.sin(ang));
  const moonUp = Math.max(0, Math.sin(ang + Math.PI));

  sun.intensity  = THREE.MathUtils.lerp(0.0, PALETTE.day.sunIntensity,   sunUp);
  moon.intensity = THREE.MathUtils.lerp(0.0, PALETTE.night.sunIntensity, moonUp);

  const wAmb = smooth01(sunUp, 0.05, 0.35);
  const wExp = smooth01(sunUp, 0.15, 0.70);
  const wFog = smooth01(sunUp, 0.20, 0.80);

  ambient.intensity = THREE.MathUtils.lerp(PALETTE.night.ambientIntensity, PALETTE.day.ambientIntensity, wAmb);
  ambient.color.lerpColors(new THREE.Color(PALETTE.night.ambientColor), new THREE.Color(PALETTE.day.ambientColor), wAmb);

  const fogColNight = new THREE.Color(PALETTE.night.fogColor);
  const fogColDay   = new THREE.Color(PALETTE.day.fogColor);
  scene.fog.color.lerpColors(fogColNight, fogColDay, wFog);
  scene.fog.density = THREE.MathUtils.lerp(PALETTE.night.fogDensity, PALETTE.day.fogDensity, wFog);

  renderer.toneMappingExposure = THREE.MathUtils.lerp(PALETTE.night.exposure, PALETTE.day.exposure, wExp);

  hemi.intensity = THREE.MathUtils.lerp(PALETTE.night.hemiIntensity, PALETTE.day.hemiIntensity, wAmb);
  hemi.color.lerpColors(new THREE.Color(PALETTE.night.hemiSky), new THREE.Color(PALETTE.day.hemiSky), wAmb);
  hemi.groundColor.lerpColors(new THREE.Color(PALETTE.night.hemiGround), new THREE.Color(PALETTE.day.hemiGround), wAmb);

  // ---------- TINTA LEGGERA DEL TERRENO ----------
  const nightTint = new THREE.Color(PALETTE.night.groundColor);
  const dayTint   = new THREE.Color(PALETTE.day.groundColor);
  const paletteTint = nightTint.lerp(dayTint, wAmb); // tinta palette
  // misceliamo verso il bianco in base a TINT_STRENGTH
  const finalTint = paletteTint.clone().lerp(new THREE.Color(0xffffff), 1 - TINT_STRENGTH);
  ground.material.color.copy(finalTint);

  // Skydome uniforms
  const sunDir  = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0).normalize();
  const moonDir = new THREE.Vector3(Math.cos(ang + Math.PI), Math.sin(ang + Math.PI), 0).normalize();

  if (skyMat) {
    skyMat.uniforms.sunDir.value.copy(sunDir);
    skyMat.uniforms.moonDir.value.copy(moonDir);
    skyMat.uniforms.sunUp.value = sunUp;
    skyMat.uniforms.sunIntensity.value  = THREE.MathUtils.lerp(0.0, 1.5, sunUp);
    skyMat.uniforms.moonIntensity.value = THREE.MathUtils.lerp(1.0, 0.0, sunUp);

    skyMat.uniforms.uFogColor.value.copy(scene.fog.color);
    const skyDensity = scene.fog.density * FogPreset.densityBoost * FogPreset.multiplier;
    const skyHeight  = THREE.MathUtils.lerp(FogPreset.heightNight, FogPreset.heightDay, wFog);
    skyMat.uniforms.uFogDensity.value = skyDensity;
    skyMat.uniforms.uFogHeight.value  = skyHeight;

    skyMat.uniforms.uHorizonWidth.value = FogPreset.horizonWidth;
    skyMat.uniforms.uHorizonPower.value = FogPreset.horizonPower;

    _dbg.uFogD = skyDensity;
    _dbg.uFogH = skyHeight;
  }

  _dbg.sunUp = sunUp; _dbg.wAmb = wAmb; _dbg.wExp = wExp; _dbg.wFog = wFog;
}

// Preset keys (F1–F3)
function setupPresetKeys(){
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      FogPreset.multiplier = 0.8;
      FogPreset.densityBoost = 10.0;
      FogPreset.heightDay = 60.0; FogPreset.heightNight = 40.0;
      FogPreset.horizonWidth = 0.28; FogPreset.horizonPower = 1.2;
    }
    if (e.key === 'F2') {
      FogPreset.multiplier = 1.2;
      FogPreset.densityBoost = 12.0;
      FogPreset.heightDay = 55.0; FogPreset.heightNight = 35.0;
      FogPreset.horizonWidth = 0.32; FogPreset.horizonPower = 1.4;
    }
    if (e.key === 'F3') {
      FogPreset.multiplier = 1.6;
      FogPreset.densityBoost = 14.0;
      FogPreset.heightDay = 50.0; FogPreset.heightNight = 30.0;
      FogPreset.horizonWidth = 0.36; FogPreset.horizonPower = 1.6;
    }
  });
}

// Time keys (P/U/O/Y/I/R)
function setupTimeKeys(){
  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') timeScale = (timeScale === 0 ? 1 : 0);
    if (e.key === 'u' || e.key === 'U') manualPhase = 0.00;
    if (e.key === 'o' || e.key === 'O') manualPhase = 0.25;
    if (e.key === 'y' || e.key === 'Y') manualPhase = 0.50;
    if (e.key === 'i' || e.key === 'I') manualPhase = 0.75;
    if (e.key === 'r' || e.key === 'R') manualPhase = null;
  });
}

// Tiling keys (',' and '.')
function setupTilingKeys(){
  window.addEventListener('keydown', (e) => {
    if (!ground || !ground.material) return;
    if (e.key === ',' || e.key === '<') {
      _dbg.tile = Math.max(1, Math.round(_dbg.tile * 0.8));
      applyTiling(_dbg.tile);
    }
    if (e.key === '.' || e.key === '>') {
      _dbg.tile = Math.min(256, Math.round(_dbg.tile * 1.25));
      applyTiling(_dbg.tile);
    }
  });
}

// Toggle TINT (T)
function setupTintKey(){
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') {
      TINT_STRENGTH = (TINT_STRENGTH > 0 ? 0 : 0.35);
      updateDebugUI();
      console.log('TINT_STRENGTH =', TINT_STRENGTH);
    }
  });
}

// Render loop
function animate() {
  requestAnimationFrame(animate);

  if (skyDome) skyDome.position.copy(camera.position);
  if (skyMat)  skyMat.uniforms.uCamPos.value.copy(camera.position);

  const elapsed = (performance.now() - startTime) / 1000;
  const t = (manualPhase !== null) ? manualPhase * DAY_LENGTH : elapsed * timeScale;

  updateDayNight(t);
  updateDebugUI();
  controls.update();
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

/* ---------- Debug overlay ---------- */
function setupLiveTuning() {
  debugEl = document.createElement('div');
  debugEl.id = 'debug-look';
  debugEl.style.cssText = `
    position:fixed; left:8px; bottom:8px; z-index:9999;
    color:#9fb6d1; background:#0008; padding:6px 8px; border-radius:6px;
    font:12px/1.3 monospace; user-select:none; pointer-events:none;
    white-space:pre;
  `;
  document.body.appendChild(debugEl);

  addEventListener('keydown', (ev) => {
    let changed = true;
    switch (ev.key) {
      case '[': scene.fog.density = clamp(scene.fog.density - 0.001, 0.005, 0.05); break;
      case ']': scene.fog.density = clamp(scene.fog.density + 0.001, 0.005, 0.05); break;
      case '-': renderer.toneMappingExposure = clamp(renderer.toneMappingExposure - 0.05, 0.5, 2.0); break;
      case '=':
      case '+': renderer.toneMappingExposure = clamp(renderer.toneMappingExposure + 0.05, 0.5, 2.0); break;
      case '1': ambient.intensity = clamp(ambient.intensity - 0.02, 0.0, 1.0); break;
      case '2': ambient.intensity = clamp(ambient.intensity + 0.02, 0.0, 1.0); break;
      case '3': sun.intensity = clamp(sun.intensity - 0.05, 0.0, 3.0); break;
      case '4': sun.intensity = clamp(sun.intensity + 0.05, 0.0, 3.0); break;
      default: changed = false;
    }
    if (changed) updateDebugUI();
  });
}

function updateDebugUI() {
  if (!debugEl) return;
  debugEl.textContent =
    `fog: ${scene.fog.density.toFixed(3)} | exp: ${renderer.toneMappingExposure.toFixed(2)} | ` +
    `amb: ${ambient.intensity.toFixed(2)} | sun: ${sun.intensity.toFixed(2)} | tile: ${_dbg.tile} | tint: ${TINT_STRENGTH.toFixed(2)}\n` +
    `sunUp: ${_dbg.sunUp.toFixed(2)} | wAmb: ${_dbg.wAmb.toFixed(2)} | wExp: ${_dbg.wExp.toFixed(2)} | wFog: ${_dbg.wFog.toFixed(2)}\n` +
    `sky uFogDensity: ${_dbg.uFogD.toFixed(4)} | sky uFogHeight: ${_dbg.uFogH.toFixed(1)}\n` +
    `[N]/[M] palette | time: [P] pause  [U]/[O]/[Y]/[I]/[R] jump | fog: [ ]  - = | ambient 1/2 | sun 3/4 | tiling ,/. | T tint | Presets F1/F2/F3`;
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let ambient, sun, moon, hemi;
let ground;
let debugEl;
let skyDome, skyMat;

// NEW: offscreen target + fullscreen fog pass
let rt, depthTex, fsScene, fsCamera, fogMat, fsQuad;

const TEX_BASE = 'assets/textures/grass/';
const _dbg = { sunUp:0, wAmb:0, wExp:0, wFog:0, uFogH:0, uFogD:0, tile:32 };

let TINT_STRENGTH = 0.35;

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

const DAY_LENGTH = 120;
const SKY_RADIUS  = 120;
const HORIZON_BLEND = 0.18;

let startTime = performance.now();
let timeScale = 1;
let manualPhase = null;
let _prevTimeSec = 0;
let _havePrevTime = false;

let _cloudTime = 0;
let _lastFrameTs = performance.now();

const FOG_DAY   = new THREE.Color(PALETTE.day.fogColor);
const FOG_NIGHT = new THREE.Color(PALETTE.night.fogColor);

const SKY_DAY_TOP    = new THREE.Color(0x89c7ff);
const SKY_DAY_BOTTOM = FOG_DAY.clone();
const SKY_NIGHT_TOP  = new THREE.Color(0x0a1330);
const SKY_NIGHT_BOTTOM = FOG_NIGHT.clone();

const FogPreset = {
  multiplier: 1.0,
  heightDay:  55.0,
  heightNight:35.0,
  densityBoost: 12.0,
  horizonWidth: 0.32,
  horizonPower: 1.4
};

/* ====================== SKYDOME SHADER ====================== */
const SKY_VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position,1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  }
`;

// Skydome: gradient + high clouds + horizon haze + thin ground-sheet fog
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

  // High clouds
  uniform float uTime;
  uniform float uCloudCov;
  uniform float uCloudSharp;
  uniform vec2  uCloudSpeed;
  uniform float uCloudScale;
  uniform vec3  uCloudTint;
  uniform float uCloudLight;

  // Thin ground sheet (for distant continuity)
  uniform float uGF_Height;
  uniform float uGF_Thick;
  uniform float uGF_Cov;
  uniform float uGF_Sharp;
  uniform vec2  uGF_Speed;
  uniform float uGF_Scale;
  uniform vec3  uGF_Tint;

  // noise
  float hash21(vec2 p){ p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=hash21(i+vec2(0,0)), b=hash21(i+vec2(1,0));
    float c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
    vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm2(vec2 p){ float a=0.5,s=0.0; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.0; a*=0.5; } return s; }
  float softDisc(vec3 dir, vec3 cDir, float size, float soft){
    float cosAng = dot(normalize(dir), normalize(cDir));
    float inner = cos(size), outer = cos(size+soft);
    return clamp((cosAng-outer)/max(1e-5,(inner-outer)),0.0,1.0);
  }

  void main() {
    vec3 dir = normalize(vWorldPos - uCamPos);

    // base gradient
    float h = clamp(dir.y*0.5+0.5,0.0,1.0);
    vec3 gradDay   = mix(bottomDay,  topDay,   h);
    vec3 gradNight = mix(bottomNight, topNight, h);
    vec3 baseCol   = mix(gradNight, gradDay, sunUp);

    // horizon haze
    float horiz = 1.0 - smoothstep(0.0, uHorizonWidth, max(dir.y, 0.0));
    horiz = pow(horiz, uHorizonPower);
    float dens  = uFogDensity * (uFogHeight * 0.02);
    float fogAmt = 1.0 - exp(-horiz * dens * 4.0);
    fogAmt = clamp(fogAmt, 0.0, 1.0);

    // celestial
    float sMask = softDisc(dir, sunDir, 0.07, 0.03);
    vec3 sunHalo  = vec3(1.0,0.92,0.75) * sunIntensity * sMask;
    float mMask = softDisc(dir, moonDir, 0.05, 0.03);
    vec3 moonHalo = vec3(0.8,0.9,1.0) * moonIntensity * mMask;

    // thin, distant ground sheet (helps continuity at far horizon)
    float gfMask=0.0; vec3 skyLow=baseCol;
    if(dir.y < 0.15){
      float denom = dir.y;
      if(abs(denom)>1e-4){
        float t = (uGF_Height - uCamPos.y) / denom;
        if(t>0.0){
          vec2 hitXZ = (uCamPos + dir*t).xz;
          vec2 fuv = hitXZ*uGF_Scale + uTime*uGF_Speed;
          float fn = fbm2(fuv);
          float feather=0.12;
          gfMask = smoothstep(uGF_Cov-feather,uGF_Cov+feather,fn);
          gfMask = pow(gfMask, max(0.001, uGF_Sharp));
          float angleBoost = smoothstep(0.0, 0.25, -dir.y);
          float depthFactor = 1.0 - exp(-uGF_Thick / max(0.04, -dir.y));
          float distFade = exp(-t * 0.002);
          gfMask *= angleBoost * depthFactor * distFade;
          vec3 fogTint = mix(baseCol, uGF_Tint, gfMask);
          skyLow = mix(baseCol, fogTint, gfMask);
        }
      }
    }

    // high clouds
    float denomSky = max(0.35, dir.y + 0.25);
    vec2 uv = (dir.xz/denomSky)*uCloudScale + uTime*uCloudSpeed;
    float n = fbm2(uv);
    float m = smoothstep(uCloudCov-0.12, uCloudCov+0.12, n);
    m = pow(m, max(0.001, uCloudSharp));
    float horizonFade = smoothstep(-0.05, uFogHeight/100.0, dir.y);
    m *= horizonFade;
    m *= clamp(1.0 - uFogDensity * 2.0, 0.0, 1.0);

    float sunL = smoothstep(0.4, 1.0, max(0.0, dot(normalize(dir), normalize(sunDir))));
    vec3 cloudCol = mix(skyLow, uCloudTint, m);
    cloudCol += uCloudLight * sunL * m * (0.6 + 0.4*sunUp);
    cloudCol = mix(cloudCol, uFogColor, fogAmt * 0.45);
    cloudCol *= (1.0 - 0.35 * fogAmt);
    vec3 skyWithClouds = mix(skyLow, cloudCol, m);

    // final haze + halos
    vec3 fogged = mix(uFogColor, skyWithClouds, 1.0 - fogAmt);
    gl_FragColor = vec4(fogged + sunHalo + moonHalo, 1.0);
  }
`;

/* ====================== FULLSCREEN FOG PASS ======================
   Adds volumetric fog IN FRONT OF GEOMETRY using the depth buffer.
   A few steps of 3D FBM anchored to world space, height falloff,
   and sun forward-scatter. This is what hides objects in fog.
================================================================== */

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FS_FRAG = /* glsl */`
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;

  uniform mat4 projInv;
  uniform mat4 viewInv;

  uniform float cameraNear;
  uniform float cameraFar;

  uniform vec3 fogColor;     // base tint (from scene fog color)
  uniform vec3 sunDir;
  uniform float sunUp;

  // Volumetric controls
  uniform float vfBottom;    // y of fog base (≈ ground)
  uniform float vfTop;       // y top
  uniform float vfDensity;   // base density
  uniform float vfFalloff;   // vertical falloff scale (m)
  uniform float vfScale;     // world noise scale
  uniform vec2  vfSpeed;     // wind (xz)
  uniform float vfCoverage;  // threshold
  uniform float vfSharp;     // edge sharpness
  uniform float vfLight;     // forward-scatter glow
  uniform float time;

  // --- helpers copied from three.js shader chunks ---
  float viewZToPerspectiveDepth( const float viewZ, const float near, const float far ) {
    return (( near + viewZ ) * far) / (( far - near ) * viewZ);
  }
  float perspectiveDepthToViewZ( const float invClipZ, const float near, const float far ) {
    return ( near * far ) / ( ( far - near ) * invClipZ - far );
  }

  // --- noise ---
  float hash21(vec2 p){ p = fract(p*vec2(123.34, 345.45)); p += dot(p,p+34.345); return fract(p.x*p.y); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p);
    float a=hash21(i+vec2(0,0)), b=hash21(i+vec2(1,0));
    float c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
    vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm3(vec3 p){ // stack 2D slices for speed
    float a=0.5, s=0.0;
    for(int i=0;i<5;i++){
      s += a * vnoise(p.xz);
      p.xy *= 2.0; p.z += 1.37;
      a *= 0.5;
    }
    return s;
  }

  void main(){
    vec3 sceneCol = texture2D(tColor, vUv).rgb;
    float zBuf = texture2D(tDepth, vUv).r;         // non-linear depth in [0,1]
    if(zBuf >= 1.0){ // sky pixel → no geometry in front
      gl_FragColor = vec4(sceneCol, 1.0);
      return;
    }

    // Reconstruct view-space position at the surface
    vec2 ndc = vUv*2.0 - 1.0;
    vec4 clip = vec4(ndc, zBuf*2.0-1.0, 1.0);
    vec4 view = projInv * clip;
    view /= view.w; // view.xyz is position in view space
    float viewZ = view.z; // negative

    // Convert to world-space
    vec4 world = viewInv * vec4(view.xyz, 1.0);
    vec3 worldPos = world.xyz;

    // Camera world pos and ray
    vec3 camWorld = (viewInv * vec4(0.0,0.0,0.0,1.0)).xyz;
    vec3 ray = normalize(worldPos - camWorld);
    float distToSurf = length(worldPos - camWorld);

    // Intersect the ray segment [0..distToSurf] with vertical fog slab [vfBottom..vfTop]
    // If the whole segment is above top or below bottom, early out
    float tEnter = (vfBottom - camWorld.y) / max(ray.y, 1e-6);
    float tExit  = (vfTop    - camWorld.y) / max(ray.y, 1e-6);
    if(ray.y < 0.0){ float tmp=tEnter; tEnter=tExit; tExit=tmp; }
    tEnter = max(tEnter, 0.0);
    tExit  = min(max(tExit, 0.0), distToSurf);

    if(tExit <= tEnter){ // no intersection with fog volume
      gl_FragColor = vec4(sceneCol, 1.0);
      return;
    }

    // March a few steps from tEnter to tExit
    float steps = 8.0;    // small & fast; increase for thicker fog
    float jitter = hash21(gl_FragCoord.xy)*(1.0/steps);
    float accumA = 0.0;
    vec3  accumC = vec3(0.0);

    for(int i=0;i<8;i++){
      float f = (float(i)+jitter)/steps;
      float t = mix(tEnter, tExit, f);
      vec3  P = camWorld + ray * t;

      // 3D FBM in world space (XZ anchored, Y as slice)
      vec3 Q = vec3(P.xz * vfScale + time * vfSpeed, P.y * 0.15);
      float n = fbm3(Q);
      float billow = 1.0 - abs(2.0*n - 1.0);
      billow = smoothstep(vfCoverage-0.1, vfCoverage+0.1, billow);
      billow = pow(billow, max(0.7, vfSharp));

      // vertical falloff
      float heightFall = exp(-(P.y - vfBottom) / max(0.001, vfFalloff));
      float density = vfDensity * billow * heightFall;

      // segment alpha (Beer-Lambert over small step)
      float seg = (tExit - tEnter)/steps;
      float a = 1.0 - exp(-density * seg);

      // Phase toward sun
      float phase = clamp(dot(normalize(sunDir), normalize(ray))*0.5+0.5, 0.0, 1.0);
      vec3  tint = mix(fogColor, vec3(1.0), 0.15);
      vec3  c = tint * (0.6 + 0.4*sunUp) * (1.0 + vfLight * phase);

      // Front-to-back composite
      accumC += (1.0 - accumA) * a * c;
      accumA += (1.0 - accumA) * a;

      if(accumA > 0.98) break;
    }

    // Composite fog over scene color
    vec3 outCol = mix(sceneCol, accumC, accumA);
    gl_FragColor = vec4(outCol, 1.0);
  }
`;

/* ====================== SETUP & RUN ====================== */

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

  // Render target with depth texture (for fog pass)
  depthTex = new THREE.DepthTexture(innerWidth, innerHeight, THREE.UnsignedInt248Type);
  rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
    depthTexture: depthTex,
    depthBuffer: true
  });

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

  // Scene fog baseline (night)
  scene.fog = new THREE.FogExp2(PALETTE.night.fogColor, PALETTE.night.fogDensity);

  // Ground
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  setupGroundTextures();

  // Test box
  const testBox = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0x8aa37b })
  );
  testBox.position.set(0, 1, 0);
  testBox.castShadow = true;
  scene.add(testBox);

  // Controls
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
      uHorizonPower:{ value: FogPreset.horizonPower },
      // high clouds
      uTime:        { value: 0.0 },
      uCloudCov:    { value: 0.52 },
      uCloudSharp:  { value: 1.3 },
      uCloudSpeed:  { value: new THREE.Vector2(0.012, 0.000) },
      uCloudScale:  { value: 0.80 },
      uCloudTint:   { value: new THREE.Color(0xEEF2F7) },
      uCloudLight:  { value: 0.6 },
      // ground sheet
      uGF_Height:   { value: 0.2 },
      uGF_Thick:    { value: 0.75 },
      uGF_Cov:      { value: 0.55 },
      uGF_Sharp:    { value: 1.0 },
      uGF_Speed:    { value: new THREE.Vector2(0.008, 0.002) },
      uGF_Scale:    { value: 0.25 },
      uGF_Tint:     { value: new THREE.Color(0xDDE3EA) },
    }
  });
  skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -9999;
  scene.add(skyDome);

  // === Fullscreen fog pass ===
  fsScene  = new THREE.Scene();
  fsCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const quadGeo = new THREE.PlaneGeometry(2,2);

  fogMat = new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: FS_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor:     { value: rt.texture },
      tDepth:     { value: depthTex },
      projInv:    { value: new THREE.Matrix4() },
      viewInv:    { value: new THREE.Matrix4() },
      cameraNear: { value: camera.near },
      cameraFar:  { value: camera.far },
      fogColor:   { value: new THREE.Color(scene.fog.color) },
      sunDir:     { value: new THREE.Vector3(1,1,0).normalize() },
      sunUp:      { value: 1.0 },

      // volumetric defaults (you can tweak live)
      vfBottom:   { value: 0.0 },
      vfTop:      { value: 6.0 },
      vfDensity:  { value: 0.9 },
      vfFalloff:  { value: 2.2 },
      vfScale:    { value: 0.18 },
      vfSpeed:    { value: new THREE.Vector2(0.04, 0.01) },
      vfCoverage: { value: 0.55 },
      vfSharp:    { value: 1.1 },
      vfLight:    { value: 0.4 },
      time:       { value: 0.0 },
    }
  });

  fsQuad = new THREE.Mesh(quadGeo, fogMat);
  fsScene.add(fsQuad);

  // UI
  addEventListener('resize', onResize);
  setupLiveTuning();
  setLightingMood('night');
  addFogTestCubes();
  setupPresetKeys();
  setupTimeKeys();
  setupTilingKeys();
  setupTintKey();
  updateDebugUI();
}

/* ====================== TEXTURES ====================== */
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

/* ====================== DAY / NIGHT ====================== */
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
  ground.material.color.set(0xffffff);
}

function smooth01(x, a, b){
  const t = THREE.MathUtils.clamp((x - a) / Math.max(1e-5, (b - a)), 0, 1);
  return t * t * (3 - 2 * t);
}
function aboveHorizonSoft(y) { return smooth01(y, -HORIZON_BLEND, +HORIZON_BLEND); }
function celestialWeights(ang) {
  const ySun  = Math.sin(ang);
  const yMoon = Math.sin(ang + Math.PI);
  let wSun  = aboveHorizonSoft(ySun);
  let wMoon = aboveHorizonSoft(yMoon);
  const sum = wSun + wMoon;
  if (sum > 1.0) { wSun /= sum; wMoon /= sum; }
  return { wSun, wMoon };
}

function updateDayNight(timeSec) {
  const phase = (timeSec % DAY_LENGTH) / DAY_LENGTH;
  const ang   = phase * Math.PI * 2;

  sun.position.set(Math.cos(ang) * SKY_RADIUS,  Math.sin(ang) * SKY_RADIUS,  0);
  moon.position.set(Math.cos(ang + Math.PI) * SKY_RADIUS, Math.sin(ang + Math.PI) * SKY_RADIUS, 0);

  const { wSun, wMoon } = celestialWeights(ang);

  let dt = 1/60;
  if (_havePrevTime) dt = Math.max(0.0001, (timeSec - _prevTimeSec));
  _prevTimeSec = timeSec; _havePrevTime = true;
  const k = 6.0, a = 1.0 - Math.exp(-k * dt);

  const sunTarget  = PALETTE.day.sunIntensity   * wSun;
  const moonTarget = PALETTE.night.sunIntensity * wMoon;
  sun.intensity  = THREE.MathUtils.lerp(sun.intensity,  sunTarget,  a);
  moon.intensity = THREE.MathUtils.lerp(moon.intensity, moonTarget, a);
  sun.castShadow = sun.intensity > 0.05;

  const sunUp = wSun;
  const wAmb  = smooth01(sunUp, 0.05, 0.35);
  const wExp  = smooth01(sunUp, 0.15, 0.70);
  const wFog  = smooth01(sunUp, 0.20, 0.80);

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

  const nightTint = new THREE.Color(PALETTE.night.groundColor);
  const dayTint   = new THREE.Color(PALETTE.day.groundColor);
  const paletteTint = nightTint.lerp(dayTint, wAmb);
  const finalTint = paletteTint.clone().lerp(new THREE.Color(0xffffff), 1 - TINT_STRENGTH);
  ground.material.color.copy(finalTint);

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

  // Update fog pass uniforms too
  fogMat.uniforms.fogColor.value.copy(scene.fog.color);
  fogMat.uniforms.sunDir.value.copy(sunDir);
  fogMat.uniforms.sunUp.value = sunUp;

  _dbg.sunUp = sunUp; _dbg.wAmb = wAmb; _dbg.wExp = wExp; _dbg.wFog = wFog;
}

/* ====================== KEYS / UI ====================== */
function setupPresetKeys(){ /* unchanged */ 
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') { FogPreset.multiplier = 0.8;  FogPreset.densityBoost = 10.0; FogPreset.heightDay = 60.0; FogPreset.heightNight = 40.0; FogPreset.horizonWidth = 0.28; FogPreset.horizonPower = 1.2; }
    if (e.key === 'F2') { FogPreset.multiplier = 1.2;  FogPreset.densityBoost = 12.0; FogPreset.heightDay = 55.0; FogPreset.heightNight = 35.0; FogPreset.horizonWidth = 0.32; FogPreset.horizonPower = 1.4; }
    if (e.key === 'F3') { FogPreset.multiplier = 1.6;  FogPreset.densityBoost = 14.0; FogPreset.heightDay = 50.0; FogPreset.heightNight = 30.0; FogPreset.horizonWidth = 0.36; FogPreset.horizonPower = 1.6; }
  });
}
function setupTimeKeys(){ /* unchanged */ 
  window.addEventListener('keydown', (e) => {
    if (e.key === 'p' || e.key === 'P') timeScale = (timeScale === 0 ? 1 : 0);
    if (e.key === 'u' || e.key === 'U') manualPhase = 0.00;
    if (e.key === 'o' || e.key === 'O') manualPhase = 0.25;
    if (e.key === 'y' || e.key === 'Y') manualPhase = 0.50;
    if (e.key === 'i' || e.key === 'I') manualPhase = 0.75;
    if (e.key === 'r' || e.key === 'R') manualPhase = null;
  });
}
function setupTilingKeys(){ /* unchanged */
  window.addEventListener('keydown', (e) => {
    if (!ground || !ground.material) return;
    if (e.key === ',' || e.key === '<') { _dbg.tile = Math.max(1, Math.round(_dbg.tile * 0.8)); applyTiling(_dbg.tile); }
    if (e.key === '.' || e.key === '>') { _dbg.tile = Math.min(256, Math.round(_dbg.tile * 1.25)); applyTiling(_dbg.tile); }
  });
}
function setupTintKey(){ /* unchanged */
  window.addEventListener('keydown', (e) => {
    if (e.key === 't' || e.key === 'T') { TINT_STRENGTH = (TINT_STRENGTH > 0 ? 0 : 0.35); updateDebugUI(); }
  });
}

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = Math.min(0.1, (now - _lastFrameTs) / 1000);
  _lastFrameTs = now;

  if (skyDome) skyDome.position.copy(camera.position);
  if (skyMat)  {
    skyMat.uniforms.uCamPos.value.copy(camera.position);
    _cloudTime += dt * timeScale;
    skyMat.uniforms.uTime.value = _cloudTime;
  }

  // update fog pass matrices + time
  fogMat.uniforms.time.value += dt * timeScale;
  fogMat.uniforms.projInv.value.copy(camera.projectionMatrix).invert();
  fogMat.uniforms.viewInv.value.copy(camera.matrixWorld);

  const elapsed = (now - startTime) / 1000;
  const t = (manualPhase !== null) ? manualPhase * DAY_LENGTH : elapsed * timeScale;

  updateDayNight(t);
  updateDebugUI();
  controls.update();

  // 1) render scene (sky + objects) into RT (with depth)
  renderer.setRenderTarget(rt);
  renderer.clear();
  renderer.render(scene, camera);

  // 2) composite volumetric fog in front of geometry to the screen
  renderer.setRenderTarget(null);
  renderer.render(fsScene, fsCamera);
}


// === TEST CUBES for fog check ===
function addFogTestCubes() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffff00, roughness: 0.8, metalness: 0.1 });

  // Cubo piccolo (alto 1.5)
  const cube1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1.5, 1), mat.clone());
  cube1.position.set(-4, 0.75, -6);   // Y = metà altezza
  cube1.castShadow = true;
  cube1.receiveShadow = true;
  scene.add(cube1);

  // Cubo medio (alto 3)
  const cube2 = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), mat.clone());
  cube2.position.set(0, 1.5, -10);
  cube2.castShadow = true;
  cube2.receiveShadow = true;
  scene.add(cube2);

  // Cubo alto (alto 5)
  const cube3 = new THREE.Mesh(new THREE.BoxGeometry(1, 5, 1), mat.clone());
  cube3.position.set(4, 2.5, -14);
  cube3.castShadow = true;
  cube3.receiveShadow = true;
  scene.add(cube3);
}


function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);

  // resize RT + depth
  if (rt) {
    rt.setSize(innerWidth, innerHeight);
    depthTex.image.width = innerWidth;
    depthTex.image.height = innerHeight;
  }
}

/* ---------- Debug overlay & live tuning ---------- */
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

      // High clouds
      case '5': skyMat.uniforms.uCloudCov.value = clamp(skyMat.uniforms.uCloudCov.value - 0.02, 0.0, 1.0); break;
      case '6': skyMat.uniforms.uCloudCov.value = clamp(skyMat.uniforms.uCloudCov.value + 0.02, 0.0, 1.0); break;
      case '7': skyMat.uniforms.uCloudSharp.value = clamp(skyMat.uniforms.uCloudSharp.value - 0.1, 0.3, 5.0); break;
      case '8': skyMat.uniforms.uCloudSharp.value = clamp(skyMat.uniforms.uCloudSharp.value + 0.1, 0.3, 5.0); break;
      case '9': skyMat.uniforms.uCloudScale.value = clamp(skyMat.uniforms.uCloudScale.value - 0.05, 0.2, 3.0); break;
      case '0': skyMat.uniforms.uCloudScale.value = clamp(skyMat.uniforms.uCloudScale.value + 0.05, 0.2, 3.0); break;
      case 'ArrowLeft':  skyMat.uniforms.uCloudSpeed.value.x -= 0.002; break;
      case 'ArrowRight': skyMat.uniforms.uCloudSpeed.value.x += 0.002; break;
      case 'ArrowDown':  skyMat.uniforms.uCloudSpeed.value.y -= 0.002; break;
      case 'ArrowUp':    skyMat.uniforms.uCloudSpeed.value.y += 0.002; break;

      // Volumetric fog pass (this is the one that hides objects)
      case 'g': fogMat.uniforms.vfDensity.value   = clamp(fogMat.uniforms.vfDensity.value + 0.05, 0.0, 3.0); break;
      case 'h': fogMat.uniforms.vfDensity.value   = clamp(fogMat.uniforms.vfDensity.value - 0.05, 0.0, 3.0); break;
      case 'j': fogMat.uniforms.vfTop.value       = clamp(fogMat.uniforms.vfTop.value + 0.2, 0.5, 20.0); break;
      case 'k': fogMat.uniforms.vfTop.value       = clamp(fogMat.uniforms.vfTop.value - 0.2, 0.5, 20.0); break;
      case 'z': fogMat.uniforms.vfCoverage.value  = clamp(fogMat.uniforms.vfCoverage.value - 0.02, 0.0, 1.0); break;
      case 'x': fogMat.uniforms.vfCoverage.value  = clamp(fogMat.uniforms.vfCoverage.value + 0.02, 0.0, 1.0); break;

      default: changed = false;
    }
    if (changed) updateDebugUI();
  });
}

function updateDebugUI() {
  if (!debugEl) return;
  const U = skyMat?.uniforms, F = fogMat?.uniforms;
  debugEl.textContent =
    `fog: ${scene.fog.density.toFixed(3)} | exp: ${renderer.toneMappingExposure.toFixed(2)} | ` +
    `amb: ${ambient.intensity.toFixed(2)} | sun: ${sun.intensity.toFixed(2)} | tile: ${_dbg.tile} | tint: ${TINT_STRENGTH.toFixed(2)}\n` +
    `sunUp: ${_dbg.sunUp.toFixed(2)} | wAmb: ${_dbg.wAmb.toFixed(2)} | wExp: ${_dbg.wExp.toFixed(2)} | wFog: ${_dbg.wFog.toFixed(2)}\n` +
    (U ? `clouds: cov ${U.uCloudCov.value.toFixed(2)} | sharp ${U.uCloudSharp.value.toFixed(2)} | scale ${U.uCloudScale.value.toFixed(2)} | speed (${U.uCloudSpeed.value.x.toFixed(3)}, ${U.uCloudSpeed.value.y.toFixed(3)})\n` : '') +
    (F ? `vFog: top ${F.vfTop.value.toFixed(1)} | dens ${F.vfDensity.value.toFixed(2)} | cov ${F.vfCoverage.value.toFixed(2)} | scale ${F.vfScale.value.toFixed(2)}\n` : '') +
    `sky uFogDensity: ${_dbg.uFogD.toFixed(4)} | sky uFogHeight: ${_dbg.uFogH.toFixed(1)}\n` +
    `[N]/[M] palette | time: [P] pause  [U]/[O]/[Y]/[I]/[R] jump | fog: [ ]  - = | amb 1/2 | sun 3/4 | ` +
    `high clouds 5..0 + arrows | volumetric g/h dens, j/k top, z/x coverage`;
}

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function getSunUp() { return _dbg.sunUp || 0; }

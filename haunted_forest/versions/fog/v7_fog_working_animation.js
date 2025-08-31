// nebbia funziona 
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let ambient, sun;
let debugEl;
let animateFog = true;       // [A] per ON/OFF
const _fogShaders = new Set();

/* ================== Procedural fog chunks (FBM) ================== */
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

// 1) world position
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

// 2) uniform + noise
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

// 3) formula (parametri come la repo)
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  vec3 fogOrigin = cameraPosition;
  vec3 dir = normalize(vWorldPosition - fogOrigin);
  float dist = distance(vWorldPosition, fogOrigin);

  // scala/velocità come repo
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

// aggancia uniform fogTime ai materiali
function attachFogTo(root){
  root.traverse?.((child)=>{
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

/* ================== App ================== */
init();
animate();

function init(){
  // SCENA
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0c0);

  // CAMERA (far grande + camera alta)
  camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 20000);
  camera.position.set(0, 20, 120);   // un po’ più indietro per percepire il tappeto
  camera.updateProjectionMatrix();

  // RENDERER
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

  // LUCI
  ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);
  sun = new THREE.DirectionalLight(0xffe6b3, 1.0);
  sun.position.set(60, 120, 80);
  sun.castShadow = true;
  scene.add(sun);

  // FOG molto sottile (ordini di grandezza come repo)
  scene.fog = new THREE.FogExp2(0xDFE9F3, 5e-6);

  // TERRENO grande
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20000, 20000, 2, 2),
    new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 1 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Qualche oggetto verticale per percepire la stratificazione
  const matCone = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.7, metalness: 0.0 });
  for(let i=0;i<60;i++){
    const cone = new THREE.Mesh(new THREE.ConeGeometry(20, 200, 16), matCone);
    const r = 1200 + Math.random()*1800;
    const a = Math.random()*Math.PI*2;
    cone.position.set(Math.cos(a)*r, 100, Math.sin(a)*r);
    cone.castShadow = true;
    scene.add(cone);
  }

  // tre box come nel test
  const makeBox = (z, h=50, col=0x9db385)=>{
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, metalness: 0.1 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(60, h, 60), m);
    b.position.set(0, h/2, z);
    b.castShadow = true;
    scene.add(b);
  };
  makeBox(-300, 80, 0xb9d097);
  makeBox(-900, 120, 0x9db385);
  makeBox(-1800, 200, 0x7f956c);

  // collega la fog procedurale
  attachFogTo(scene);

  // CONTROLS
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 60, -600);

  // UI
  setupDebug();
  addEventListener('resize', onResize);
}

function animate(){
  requestAnimationFrame(animate);

  // anima (o ferma) la foschia
  const t = performance.now() * 0.001;
  _fogShaders.forEach(s => { s.uniforms.fogTime.value = animateFog ? t : 0.0; });

  controls.update();
  renderer.render(scene, camera);
  updateDebug();
}

function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

/* ---------------- UI ---------------- */
function setupDebug(){
  debugEl = document.createElement('div');
  debugEl.style.cssText = `
    position:fixed; left:8px; bottom:8px; z-index:9999;
    color:#dfe8f3; background:#0008; padding:6px 8px; border-radius:6px;
    font:12px/1.35 monospace; user-select:none; pointer-events:none; white-space:pre;`;
  document.body.appendChild(debugEl);

  addEventListener('keydown', (e)=>{
    switch(e.key){
      case '[': scene.fog.density = clamp(scene.fog.density - 1e-6, 0, 1); break;
      case ']': scene.fog.density = clamp(scene.fog.density + 1e-6, 0, 1); break;
      case '-': renderer.toneMappingExposure = clamp(renderer.toneMappingExposure - 0.05, 0.2, 3.0); break;
      case '=':
      case '+': renderer.toneMappingExposure = clamp(renderer.toneMappingExposure + 0.05, 0.2, 3.0); break;
      case 'a':
      case 'A': animateFog = !animateFog; break; // toggle animazione
    }
  });
}

function updateDebug(){
  if(!debugEl) return;
  debugEl.textContent =
    `FogExp2+FBM density: ${scene.fog?.density.toExponential(2)}  |  ` +
    `Exposure: ${renderer.toneMappingExposure.toFixed(2)}  |  ` +
    `shaders:${_fogShaders.size}  |  anim:${animateFog?'ON':'OFF'}\n` +
    `Keys: [ / ] fog  |  - / = exposure  |  A anim  |  orbit drag`;
}

function clamp(x,a,b){ return Math.max(a, Math.min(b, x)); }
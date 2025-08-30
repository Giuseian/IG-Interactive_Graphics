// PASSO 1 - Combining with Github Code found at  https://github.com/simondevyoutube/ThreeJS_Tutorial_Fog

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';

let scene, camera, renderer, controls;
let ambient, sun;
let debugEl;

init();
animate();

function init(){
  // SCENE
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a0c0);

  // CAMERA
  camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 5000);
  camera.position.set(0, 6, 18);

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

  // LIGHTS
  ambient = new THREE.AmbientLight(0xffffff, 0.35);
  scene.add(ambient);

  sun = new THREE.DirectionalLight(0xffe6b3, 1.2);
  sun.position.set(10, 20, 10);
  sun.castShadow = true;
  scene.add(sun);

  // FOG BASELINE (Exp2)
  // Valore moderato per vedere subito l'effetto anche a -30/-60
  scene.fog = new THREE.FogExp2(0xDFE3EB, 0.01);

  // GROUND
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x6b7a59, roughness: 1 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // TRE BOX A DISTANZA
  const makeBox = (z, h=2, col=0x8aa37b)=>{
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.8, metalness: 0.1 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2), m);
    b.position.set(0, h/2, z);
    b.castShadow = true;
    scene.add(b);
    return b;
  };
  makeBox(-10, 2, 0xb9d097);
  makeBox(-30, 3, 0x9db385);
  makeBox(-60, 5, 0x7f956c);

  // CONTROLS
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 1, -20);

  // UI overlay + keys
  setupDebug();

  addEventListener('resize', onResize);
}

function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
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
    font:12px/1.35 monospace; user-select:none; pointer-events:none; white-space:pre;
  `;
  document.body.appendChild(debugEl);
  updateDebug();

  addEventListener('keydown', (e)=>{
    let changed = true;
    switch(e.key){
      case '[': scene.fog.density = clamp(scene.fog.density - 0.001, 0.0, 0.2); break;
      case ']': scene.fog.density = clamp(scene.fog.density + 0.001, 0.0, 0.2); break;
      case '-': renderer.toneMappingExposure = clamp(renderer.toneMappingExposure - 0.05, 0.2, 3.0); break;
      case '=':
      case '+': renderer.toneMappingExposure = clamp(renderer.toneMappingExposure + 0.05, 0.2, 3.0); break;
      default: changed = false;
    }
    if(changed) updateDebug();
  });
}

function updateDebug(){
  debugEl.textContent =
    `FogExp2 density: ${scene.fog?.density.toFixed(3)}  |  Exposure: ${renderer.toneMappingExposure.toFixed(2)}\n` +
    `Keys: [ / ] fog  |  - / = exposure  |  orbit drag`;
}

function clamp(x, a, b){ return Math.max(a, Math.min(b, x)); }
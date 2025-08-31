
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/MTLLoader.js';

const canvas   = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e2126);

const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 0.01, 2000);
camera.position.set(0, 2, 14);                 // più indietro per vedere il cerchio
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

/* luci morbide */
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a3038, 0.45));
const dir = new THREE.DirectionalLight(0xffffff, 0.65); dir.position.set(2,3,2);
scene.add(dir);

/* palette PBR “AC” */
const LEAF_COLOR  = new THREE.Color('#7FA36B');
const TRUNK_COLOR = new THREE.Color('#B28C72');
const OTHER_COLOR = new THREE.Color('#BFBFBF');
const EMISSIVE_STRENGTH = 0.08;

/* Applica materiali PBR – mantiene eventuale array di materiali */
function applyTreePBR(root){
  const TRUNK_NAMES = ['材质','trunk'];
  const LEAF_NAMES  = ['材质.001','leaves','leaf'];

  root.traverse(o=>{
    if(!o.isMesh) return;

    const matsIn = Array.isArray(o.material) ? o.material : [o.material];
    const objName = (o.name || '').toLowerCase();

    const matsOut = matsIn.map(m=>{
      const n = String(m?.name || '').normalize('NFC').toLowerCase();
      const isTrunk = TRUNK_NAMES.some(s => n.includes(s)) || objName.includes('cylinder');
      const isLeaf  = LEAF_NAMES.some(s => n.includes(s))  || objName.includes('ico') || objName.includes('pine');

      const baseCol = isLeaf ? LEAF_COLOR : (isTrunk ? TRUNK_COLOR : OTHER_COLOR);
      const mat = new THREE.MeshStandardMaterial({
        color: baseCol.clone(),
        roughness: 0.95,
        metalness: 0.0,
        flatShading: true,
        side: THREE.DoubleSide
      });
      mat.emissive.copy(baseCol).multiplyScalar(0.5);
      mat.emissiveIntensity = EMISSIVE_STRENGTH;
      return mat;
    });

    o.material = (matsOut.length === 1) ? matsOut[0] : matsOut;
  });
}

/* centra, scala a ~2u, appoggia a Y=0 e azzera X/Z per coerenza */
function normalizeAndPlace(root){
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const maxDim = Math.max(size.x,size.y,size.z)||1;
  root.scale.setScalar(2.0/maxDim);
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;
  root.position.x = 0; root.position.z = 0;
}

/* inquadra un oggetto/gruppo */
function fitToView(object){
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const ctr  = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x,size.y,size.z)||1;
  const dist = maxDim / (2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2));
  camera.position.set(ctr.x, ctr.y + maxDim*0.3, ctr.z + dist*1.25);
  controls.target.copy(ctr);
  controls.update();
}

/* scatter – ritorna il gruppo e clona i materiali anche se sono array */
function scatterSimple(source, n=40, minR=5, maxR=12){
  const group = new THREE.Group();
  for(let i=0;i<n;i++){
    const t = source.clone(true);
    t.traverse(o=>{
      if(o.isMesh && o.material){
        if(Array.isArray(o.material)) o.material = o.material.map(m=>m.clone());
        else o.material = o.material.clone();
      }
    });
    const r = THREE.MathUtils.lerp(minR,maxR,Math.random());
    const a = Math.random()*Math.PI*2;
    t.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
    t.rotation.y = Math.random()*Math.PI*2;
    t.scale.setScalar(THREE.MathUtils.randFloat(0.9,1.2));
    group.add(t);
  }
  scene.add(group);
  return group;
}

/* carica OBJ+MTL e crea la foresta */
(async function(){
  const mtl = await new MTLLoader().loadAsync('/assets/textures/trees/pine.mtl');
  mtl.preload();
  const loader = new OBJLoader().setMaterials(mtl);
  const root = await loader.loadAsync('/assets/textures/trees/pine.obj');

  normalizeAndPlace(root);
  applyTreePBR(root);

  // tieni un “prototipo” al centro (opzionale)
  // scene.add(root);

  // crea il cerchio di alberi e fai fit sul gruppo
  const forest = scatterSimple(root, 40, 5, 12);
  console.log('Alberi nel gruppo:', forest.children.length);
  fitToView(forest);
  root.visible = false;           //  tienilo come “reference”, ma invisibile

})();

addEventListener('resize', ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

(function animate(){
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene,camera);
})();
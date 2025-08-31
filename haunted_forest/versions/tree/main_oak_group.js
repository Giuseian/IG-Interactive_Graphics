
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
camera.position.set(0, 2, 14);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

/* luci morbide */
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a3038, 0.45));
const dir = new THREE.DirectionalLight(0xffffff, 0.65); dir.position.set(2,3,2);
scene.add(dir);

/* ====== Parametri di scatter (più distanti) ====== */
const COUNT_TREES = 36;      // numero di alberi
const SPACING_MUL = 1.80;    // fattore sulla somma dei raggi effettivi (scala inclusa)
const RING        = [8, 22]; // anello di posizionamento in multipli del diametro XZ del modello

/* palette PBR – rovere */
const LEAF_COLOR  = new THREE.Color('#6F8F5E');  // chioma quercia
const TRUNK_COLOR = new THREE.Color('#8B6A4E');  // corteccia
const OTHER_COLOR = new THREE.Color('#BFBFBF');
const EMISSIVE_STRENGTH = 0.06;

/* Applica materiali PBR – mapping per oak.obj */
function applyTreePBR(root){
  const TRUNK_NAMES = ['trunk', 'trunk.001', 'bark', 'cylinder'];
  const LEAF_NAMES  = ['leaf', 'leaves', 'foliage', 'icosphere', 'crown', 'canopy'];

  root.traverse(o=>{
    if(!o.isMesh) return;
    const objName = (o.name || '').toLowerCase();
    const matsIn = Array.isArray(o.material) ? o.material : [o.material];

    const matsOut = matsIn.map(m=>{
      const n = String(m?.name || '').normalize('NFC').toLowerCase();
      const isTrunk = TRUNK_NAMES.some(s => n.includes(s) || objName.includes(s));
      const isLeaf  = LEAF_NAMES.some(s => n.includes(s) || objName.includes(s));
      const baseCol = isLeaf ? LEAF_COLOR : (isTrunk ? TRUNK_COLOR : OTHER_COLOR);

      const mat = new THREE.MeshStandardMaterial({
        color: baseCol.clone(),
        roughness: isLeaf ? 0.8 : 0.95,
        metalness: 0.0,
        flatShading: false,
        side: THREE.DoubleSide
      });
      mat.emissive.copy(baseCol).multiplyScalar(0.4);
      mat.emissiveIntensity = EMISSIVE_STRENGTH;

      if (o.geometry && !o.geometry.attributes.normal) {
        o.geometry.computeVertexNormals();
      }
      return mat;
    });

    o.material = (matsOut.length === 1) ? matsOut[0] : matsOut;
    o.castShadow = o.receiveShadow = true;
  });
}

/* centra, scala a ~2u, appoggia a Y=0 e azzera X/Z */
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
  root.updateMatrixWorld(true);
}

/* diametro in pianta (XZ) dell'oggetto normalizzato */
function getXZDiameter(obj){
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  const dx = b.max.x - b.min.x;
  const dz = b.max.z - b.min.z;
  return Math.max(dx, dz);
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

/* scatter con raggio variabile: distanza >= SPACING_MUL * (r_i + r_j) */
function scatterNoOverlap(source, count=32, spacingMul=1.6, ring=[7,20]){
  const group = new THREE.Group();

  // ingombro di base
  const dia = getXZDiameter(source);
  const Rmin = dia * ring[0];
  const Rmax = dia * ring[1];

  const placed = []; // {pos:Vector3, radius:number}
  let attempts = 0;
  const maxAttempts = count * 800;

  while (placed.length < count && attempts < maxAttempts) {
    attempts++;

    // scala casuale → raggio effettivo proporzionale
    const scale = THREE.MathUtils.randFloat(0.9, 1.15);
    const radius = (dia * scale) * 0.5;

    const r = THREE.MathUtils.lerp(Rmin, Rmax, Math.random());
    const a = Math.random() * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a)*r, 0, Math.sin(a)*r);

    // test distanza minima da tutti gli altri
    let ok = true;
    for (const o of placed) {
      const min = spacingMul * (radius + o.radius);
      if (p.distanceTo(o.pos) < min) { ok = false; break; }
    }
    if (!ok) continue;

    // istanzia
    const t = source.clone(true);
    t.traverse(o=>{
      if(o.isMesh && o.material){
        o.castShadow = o.receiveShadow = true;
        o.material = Array.isArray(o.material) ? o.material.map(m=>m.clone()) : o.material.clone();
      }
    });
    t.position.copy(p);
    t.rotation.y = Math.random()*Math.PI*2;
    t.scale.setScalar(scale);
    group.add(t);

    placed.push({ pos: p, radius });
  }

  if (placed.length < count) {
    console.warn(`Piazzati ${placed.length}/${count}. Aumenta RING o riduci SPACING_MUL per farcene stare di più.`);
  }

  scene.add(group);
  return group;
}

/* carica OAK (OBJ+MTL) e crea la foresta */
(async function(){
  let root;
  try {
    const mtl = await new MTLLoader().loadAsync('/assets/textures/trees/oak.mtl');
    mtl.preload();
    const loader = new OBJLoader().setMaterials(mtl);
    root = await loader.loadAsync('/assets/textures/trees/oak.obj');
  } catch(e){
    const loader = new OBJLoader();
    root = await loader.loadAsync('/assets/textures/trees/oak.obj');
  }

  normalizeAndPlace(root);
  applyTreePBR(root);

  // foresta molto più “larga”
  const forest = scatterNoOverlap(root, COUNT_TREES, SPACING_MUL, RING);
  fitToView(forest);

  // prototipo invisibile
  root.visible = false;
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

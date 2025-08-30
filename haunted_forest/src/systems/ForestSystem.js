// src/systems/ForestSystem.js
// -----------------------------------------------------------------------------
// ForestSystem
// -----------------------------------------------------------------------------
// Popola un anello (tra innerRadius e outerRadius) con alberi instanziati.
// - Generazione pseudo–blue-noise via random + rejection con SpatialHash
// - Supporto a “clearings” (zone libere da vegetazione)
// - Multi–tipo: ogni tipo ha geometrie/materiali propri (instanced per mat)
// - Occluders: per ogni albero produce un cilindro approssimante (pos/radius/height)
// - Dimensionamento: spacing minimo base + "sizePad" ricavato dalla taglia media
//
// NOTE:
//  • Nessuna modifica di comportamento rispetto al tuo codice: solo pulizia,
//    commenti, typedefs e micro-rifiniture (nomi/guardie).
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { createRNG, randRange } from '../utils/rng.js';
import { SpatialHash } from '../utils/spatialHash.js';

/**
 * @typedef {Object} ForestTypeConfig
 * @property {string} name
 * @property {string} url
 * @property {number} [occluderHeight=140]
 * @property {number} [occluderRadiusScale=0.4]
 * @property {object} [options]
 */

/**
 * @typedef {Object} ForestConfig
 * @property {number} [seed=1234]
 * @property {number} [innerRadius=60]
 * @property {number} [outerRadius=1500]
 * @property {number} [minSpacing=8]
 * @property {number} [maxSpacing=12]
 * @property {number} [count=600]
 * @property {[number,number]} [scale=[0.9,1.2]]  // fattore di scala uniforme [min,max]
 * @property {{x:number,z:number,r:number}[]} [clearings=[]]
 * @property {ForestTypeConfig[]} [types=[]]
 * @property {boolean} [castShadow=true]
 * @property {boolean} [receiveShadow=true]
 */

/**
 * @typedef {Object} TreeProto
 * @property {{geometry:THREE.BufferGeometry, material:THREE.Material}[]} geometriesByMaterial
 * @property {number} baseRadius  // raggio base (chioma/tronco) usato per occluder/spacing
 */

/**
 * @typedef {Object} TreeCatalog
 * @property {(name:string, url:string, options?:object)=>Promise<TreeProto>} load
 */

/** Config di default */
const DEFAULT_CFG = /** @type {ForestConfig} */ ({
  seed: 1234,
  innerRadius: 60,
  outerRadius: 1500,
  minSpacing: 8,
  maxSpacing: 12,
  count: 600,
  scale: [0.9, 1.2],
  clearings: [],
  types: [],
  castShadow: true,
  receiveShadow: true,
});

export class ForestSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {ForestConfig} config
   * @param {TreeCatalog} treeCatalog
   */
  constructor(scene, config, treeCatalog) {
    this.scene = scene;
    this.cfg = Object.assign({}, DEFAULT_CFG, config);

    this.rng = createRNG(this.cfg.seed);
    this.catalog = treeCatalog;

    // Spatial hash iniziale (il cellSize potrà essere riallineato in generate())
    this.spatial = new SpatialHash(this.cfg.maxSpacing);

    /** @type {THREE.InstancedMesh[]} */
    this.meshes = [];

    /** @type {{pos:THREE.Vector3, radius:number, height:number}[]} */
    this.occluders = [];

    /** @type {{cfg:ForestTypeConfig, proto:TreeProto}[]} */
    this.typeProtos = [];
  }

  /** Carica i tipi di albero dal catalogo. */
  async loadTypes() {
    this.typeProtos.length = 0;
    for (const t of (this.cfg.types || [])) {
      const proto = await this.catalog.load(t.name, t.url, t.options || {});
      this.typeProtos.push({ cfg: t, proto });
    }
  }

  /** True se (x,z) cade dentro una clearing (zona esclusa). */
  _inClearings(x, z) {
    for (const c of (this.cfg.clearings || [])) {
      const dx = x - (c.x || 0);
      const dz = z - (c.z || 0);
      if (Math.hypot(dx, dz) < (c.r || 0)) return true;
    }
    return false;
  }

  /**
   * Genera punti nello spazio anulare con rejection sampling + spatial hash.
   * @param {number} targetCount Numero di punti richiesti
   * @param {number} sizePad     Extra spacing (dipende dalla taglia del modello)
   * @returns {{x:number,z:number}[]}
   */
  _generatePoints(targetCount, sizePad = 0) {
    const pts = [];
    const { innerRadius, outerRadius, minSpacing, maxSpacing } = this.cfg;
    const maxTries = targetCount * 30;

    for (let tries = 0; pts.length < targetCount && tries < maxTries; tries++) {
      // campionamento uniforme nell’anello
      const a = this.rng() * Math.PI * 2;
      const r = Math.sqrt(this.rng()) * (outerRadius - innerRadius) + innerRadius;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;

      if (this._inClearings(x, z)) continue;

      // distanza minima = spacing base + pad in funzione della taglia
      const spacing = randRange(this.rng, minSpacing, maxSpacing);
      const minDist = spacing + sizePad;

      // verifica vicini via spatial hash
      let ok = true;
      for (const idx of this.spatial.queryNeighbors(x, z)) {
        const p = this.spatial.points[idx];
        if (!p) continue;
        if (Math.hypot(x - p.x, z - p.z) < minDist) { ok = false; break; }
      }
      if (!ok) continue;

      this.spatial.add(x, z);
      pts.push({ x, z });
    }
    return pts;
  }

  /**
   * Genera l’intera foresta:
   *  - carica i tipi
   *  - calcola sizePad medio dal primo tipo (come nella tua versione)
   *  - produce i punti
   *  - costruisce gli InstancedMesh (bucket per materiale)
   *  - ritorna conteggio e occluders
   */
  async generate() {
    await this.loadTypes();
    if (this.typeProtos.length === 0) {
      // niente tipi -> niente foresta (fail-safe non invasivo)
      return { count: 0, occluders: [] };
    }

    // === Calcolo del sizePad in base al PRIMO tipo (semplificazione intenzionale)
    const [sMin, sMax] = this.cfg.scale;
    const sMed = 0.5 * (sMin + sMax);
    const firstType   = this.typeProtos[0];
    const baseRadius  = firstType?.proto?.baseRadius || 0;
    const radiusScale = firstType?.cfg?.occluderRadiusScale ?? 0.4;
    // da raggio a “diametro medio” (×2) per usare la chioma come pad
    const sizePad = baseRadius * radiusScale * sMed * 2.0;

    // riallinea il cellSize dell’hash per riflettere il nuovo spacing effettivo
    this.spatial = new SpatialHash(this.cfg.maxSpacing + sizePad);

    // === Punti su anello con pad “intelligente”
    const pts = this._generatePoints(this.cfg.count, sizePad);

    // === Prepara bucket (type × material) per costruire InstancedMesh
    /** @type {{ typeIdx:number, matIdx:number, geometry:THREE.BufferGeometry, material:THREE.Material, transforms:THREE.Matrix4[] }[]} */
    const buckets = [];
    for (let ti = 0; ti < this.typeProtos.length; ti++) {
      const { proto } = this.typeProtos[ti];
      for (let mi = 0; mi < proto.geometriesByMaterial.length; mi++) {
        const { geometry, material } = proto.geometriesByMaterial[mi];
        buckets.push({ typeIdx: ti, matIdx: mi, geometry, material, transforms: [] });
      }
    }

    // === Assegnazione dei punti ai tipi + creazione trasformazioni e occluders
    for (const p of pts) {
      const ti = Math.floor(this.rng() * this.typeProtos.length);
      const { proto, cfg } = this.typeProtos[ti];

      const rotY = this.rng() * Math.PI * 2;
      const s    = randRange(this.rng, sMin, sMax);

      for (let mi = 0; mi < proto.geometriesByMaterial.length; mi++) {
        // trova bucket per (ti,mi)
        const bucket = buckets.find(b => b.typeIdx === ti && b.matIdx === mi);
        const m = new THREE.Matrix4()
          .makeRotationY(rotY)
          .premultiply(new THREE.Matrix4().makeScale(s, s, s))
          .premultiply(new THREE.Matrix4().makeTranslation(p.x, 0, p.z));
        bucket.transforms.push(m);
      }

      // Occluder (cilindro) approssimante
      const radius = (proto.baseRadius * (cfg.occluderRadiusScale || 0.4)) * s;
      const height = (cfg.occluderHeight || 120) * s;
      this.occluders.push({ pos: new THREE.Vector3(p.x, 0, p.z), radius, height });
    }

    // === Costruisci gli InstancedMesh e aggiungi alla scena
    const tmp = new THREE.Object3D();
    for (const b of buckets) {
      const count = b.transforms.length;
      if (count === 0) continue;

      const mesh = new THREE.InstancedMesh(b.geometry, b.material, count);
      mesh.castShadow = this.cfg.castShadow;
      mesh.receiveShadow = this.cfg.receiveShadow;

      for (let i = 0; i < count; i++) {
        tmp.matrix.copy(b.transforms[i]);
        mesh.setMatrixAt(i, tmp.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;

      this.scene.add(mesh);
      this.meshes.push(mesh);
    }

    return { count: pts.length, occluders: this.occluders };
  }

  /** Rimuove i mesh dalla scena e libera le risorse. */
  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry?.dispose?.();
      if (Array.isArray(m.material)) m.material.forEach(mat => mat.dispose());
      else m.material?.dispose?.();
    }
    this.meshes.length = 0;
    this.occluders.length = 0;

    // ripristina uno spatial hash "base"
    this.spatial = new SpatialHash(this.cfg.maxSpacing);
  }
}

// src/assets/TreeCatalog.js
// -----------------------------------------------------------------------------
// TreeCatalog
// -----------------------------------------------------------------------------
// Carica modelli .OBJ di alberi e produce "prototipi" pronti per l'instancing:
//
//  - Split per materiale (usando i groups della geometry).
//  - Applica regole PBR per ottenere materiali coerenti.
//  - Merge delle sub-geometry per materiale -> poche BufferGeometry finali.
//  - Riallinea la base a y=0 e calcola un baseRadius (mezzo diametro XZ).
//
// Output di load(name, url):
//   { geometriesByMaterial: [{ geometry, material }, ...], baseRadius }
// Questi prototipi vengono usati da ForestSystem per creare InstancedMesh.
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { OBJLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/OBJLoader.js';
import * as BufferGeometryUtils from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * @typedef {Object} TreeProto
 * @property {{geometry: THREE.BufferGeometry, material: THREE.Material}[]} geometriesByMaterial
 * @property {number} baseRadius  // metà del diametro XZ alla base (scala finale)
 */

/**
 * @typedef {Object} LoadOpts
 * @property {number} [scale=1]                   Scala globale applicata al modello
 * @property {number|THREE.Color} [defaultColor]  Colore di default (se non definito nei materiali sorgente)
 * @property {number} [roughness=0.9]
 * @property {number} [metalness=0.0]
 * @property {boolean} [keepSourceMaps=false]     Mantieni le texture map dal .OBJ
 * @property {Array<Object>} [rules=[]]           Regole per materiali (match per nome mesh/materiale)
 */

export class TreeCatalog {
  constructor() {
    this.loader = new OBJLoader();
    /** @type {Map<string, TreeProto>} */
    this.prototypes = new Map(); // name -> TreeProto
  }

  /**
   * Carica e prepara un albero .OBJ in un "prototipo" per l'instancing.
   * Usa cache interna (per nome).
   * @param {string} name
   * @param {string} url
   * @param {LoadOpts} [opts]
   * @returns {Promise<TreeProto>}
   */
  async load(name, url, opts = {}) {
    if (this.prototypes.has(name)) return /** @type {TreeProto} */ (this.prototypes.get(name));

    const {
      scale = 1.0,
      defaultColor = 0x2e7d32,
      roughness = 0.9,
      metalness = 0.0,
      keepSourceMaps = false,
      rules = []
    } = opts;

    const obj = await this.loader.loadAsync(url);

    // firmaMat -> { material, geoms: BufferGeometry[] (sub-pezzi già in world space) }
    const byMat = new Map();

    // Per ogni mesh (e per ogni suo gruppo di indici) estrai una sub-geometry, portala in world,
    // costruisci/assegna il materiale in base alle regole, poi bucketizza per "firma" materiale.
    obj.traverse((child) => {
      if (!child.isMesh || !child.geometry) return;

      child.updateWorldMatrix(true, false);

      const mats = Array.isArray(child.material) ? child.material : [child.material];
      const hasGroups = child.geometry.groups && child.geometry.groups.length > 0;

      /** @type {{start:number,count:number,materialIndex:number}[]} */
      const groups = hasGroups
        ? child.geometry.groups
        : [{ start: 0, count: (child.geometry.index ? child.geometry.index.count : child.geometry.attributes.position.count), materialIndex: 0 }];

      for (const g of groups) {
        const srcMat = mats[Math.min(g.materialIndex ?? 0, mats.length - 1)] || mats[0];

        // --- estrai la sotto-geometria del gruppo (non indicizzata) ---
        const sub = this._extractGroupGeometry(child.geometry, g.start, g.count);

        // porta in spazio mondo (bake della transform del nodo OBJ)
        sub.applyMatrix4(child.matrixWorld);

        // materiale PBR secondo regole
        const chosen = this._buildMaterialFromRules({
          mesh: child,
          sourceMat: srcMat,
          rules,
          defaults: { defaultColor, roughness, metalness, keepSourceMaps }
        });

        // bucket per firma materiale
        const key = this._materialSignature(chosen);
        if (!byMat.has(key)) byMat.set(key, { material: chosen, geoms: [] });
        byMat.get(key).geoms.push(sub);
      }
    });

    // Merge per materiale + riallineo base a y=0 + normals + scale
    /** @type {{geometry:THREE.BufferGeometry, material:THREE.Material}[]} */
    const geometriesByMaterial = [];
    let baseRadius = 1;

    for (const { material, geoms } of byMat.values()) {
      // unisci i pezzi di questo materiale
      const merged = BufferGeometryUtils.mergeGeometries(geoms, false);
      // pulizia RAM dei sub-pezzi (non servono più)
      for (const g of geoms) g.dispose();

      merged.computeBoundingBox();
      const bb = merged.boundingBox;
      const widthX = bb.max.x - bb.min.x;
      const widthZ = bb.max.z - bb.min.z;
      baseRadius = Math.max(baseRadius, 0.5 * Math.hypot(widthX, widthZ));

      // porta la base a y=0
      merged.translate(0, -bb.min.y, 0);

      // scala globale (se richiesta)
      if (scale !== 1) merged.scale(scale, scale, scale);

      merged.computeVertexNormals();

      geometriesByMaterial.push({ material, geometry: merged });
    }

    const proto = { geometriesByMaterial, baseRadius: baseRadius * scale };
    this.prototypes.set(name, proto);
    return proto;
  }

  // -----------------------------------------------------------------------------
  // Helpers privati
  // -----------------------------------------------------------------------------

  /**
   * Estrae un sotto-range di una geometry in base a (start,count) sugli INDICI.
   * Converte a non-indicizzata per poter fare uno slice pulito degli attributi.
   * @param {THREE.BufferGeometry} geom
   * @param {number} start
   * @param {number} count
   * @returns {THREE.BufferGeometry}
   */
  _extractGroupGeometry(geom, start, count) {
    const non = geom.index ? geom.toNonIndexed() : geom;
    const g = new THREE.BufferGeometry();

    // copia attributi principali
    for (const name in non.attributes) {
      const src = non.attributes[name];
      const itemSize = src.itemSize;
      const begin = start * itemSize;
      const end = (start + count) * itemSize;
      const arr = src.array.slice(begin, end);
      g.setAttribute(name, new THREE.BufferAttribute(arr, itemSize, src.normalized));
    }

    // copia UV2/UV3 se presenti (alcuni tool le usano)
    if (non.attributes.uv2) {
      const src = non.attributes.uv2;
      const arr = src.array.slice(start * src.itemSize, (start + count) * src.itemSize);
      g.setAttribute('uv2', new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
    }
    if (non.attributes.uv3) {
      const src = non.attributes.uv3;
      const arr = src.array.slice(start * src.itemSize, (start + count) * src.itemSize);
      g.setAttribute('uv3', new THREE.BufferAttribute(arr, src.itemSize, src.normalized));
    }

    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  _toArray(x) { return !x ? [] : (Array.isArray(x) ? x : [x]); }

  _matchAny(subs, target) {
    if (!target) return false;
    const low = String(target).toLowerCase();
    for (const s of this._toArray(subs)) {
      const needle = String(s).toLowerCase();
      if (needle && low.includes(needle)) return true;
    }
    return false;
  }

  _pickRule(mesh, sourceMat, rules) {
    const objName = mesh?.name || '';
    const matName = sourceMat?.name || '';
    for (const r of rules) {
      const okObj = r.matchObj ? this._matchAny(r.matchObj, objName) : false;
      const okMat = r.matchMat ? this._matchAny(r.matchMat, matName) : false;
      if (okObj || okMat) return r;
    }
    return null;
  }

  _colorFrom(c, fallback) {
    const color = new THREE.Color();
    if (c != null) color.set(c);
    else if (fallback != null) color.set(fallback);
    else color.set(0xffffff);
    return color;
  }

  /**
   * Costruisce un MeshStandardMaterial a partire da regole opzionali e valori
   * di default/sorgente.
   */
  _buildMaterialFromRules({ mesh, sourceMat, rules, defaults }) {
    const rule = this._pickRule(mesh, sourceMat, rules) || {};

    const color      = this._colorFrom(rule.color, sourceMat?.color ?? defaults.defaultColor);
    const roughness  = rule.roughness ?? sourceMat?.roughness ?? defaults.roughness ?? 0.9;
    const metalness  = rule.metalness ?? sourceMat?.metalness ?? defaults.metalness ?? 0.0;
    const flatShading= rule.flatShading ?? false;
    const side       = rule.side ?? THREE.DoubleSide;
    const transparent= rule.transparent ?? sourceMat?.transparent ?? false;
    const opacity    = rule.opacity ?? sourceMat?.opacity ?? 1.0;

    // Emissive opzionale come "tinta" (spesso tenuta a zero per alberi)
    const emissiveScale     = rule.emissiveScale ?? 0.0;
    const emissiveColor     = color.clone().multiplyScalar(emissiveScale);
    const emissiveIntensity = rule.emissiveIntensity ?? 0.0;

    // Texture map opzionale (solo se vogliamo mantenere quella sorgente)
    const keepMap = rule.keepMap ?? defaults.keepSourceMaps ?? false;
    const map     = keepMap ? (sourceMat?.map || null) : null;

    const mat = new THREE.MeshStandardMaterial({
      color, roughness, metalness, flatShading, side, transparent, opacity, map
    });

    if (emissiveIntensity > 0 || emissiveScale > 0) {
      mat.emissive.copy(emissiveColor);
      mat.emissiveIntensity = emissiveIntensity;
    }
    return mat;
  }

  /**
   * Crea una "firma" testuale del materiale: serve a raggruppare geometrie
   * compatibili per l'instancing (stesso materiale logico).
   */
  _materialSignature(mat) {
    const c  = mat.color?.getHexString?.() || '';
    const e  = mat.emissive?.getHexString?.() || '';
    const m  = (mat.metalness ?? 0).toFixed(3);
    const r  = (mat.roughness ?? 0).toFixed(3);
    const f  = mat.flatShading ? 1 : 0;
    const s  = mat.side ?? THREE.FrontSide;
    const t  = mat.transparent ? 1 : 0;
    const o  = (mat.opacity ?? 1).toFixed(3);
    const ei = (mat.emissiveIntensity ?? 0).toFixed(3);
    const mapId = mat.map?.uuid || '';
    return `c:${c}|e:${e}|ei:${ei}|m:${m}|r:${r}|f:${f}|s:${s}|t:${t}|o:${o}|map:${mapId}`;
  }
}

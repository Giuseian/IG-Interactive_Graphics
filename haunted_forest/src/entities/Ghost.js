// src/entities/Ghost.js
// -----------------------------------------------------------------------------
// Classe "Ghost": entità mobile inseguente con dissolve shader e anello
// diegetico a terra. È gestita dallo Spawner (GhostSpawner) che la carica,
// la attiva, la aggiorna e la ricicla.
//
// • Stati: 'inactive' → 'appearing' → 'active' → 'cleansing' → 'inactive'
// • Shader: patchGhostMaterial aggiunge dissolve + uniform set condivisi
// • Ring diegetico: base tenue + arco a progresso (shader custom)
// • Movimento: seek con turn-rate, swoop in quota, serpentina (weave)
// • Pacificazione: in safe-zone i ghost restano alla periferia e rallentano
//
// NOTA: Questo file è stato pulito e documentato. Nessuna logica/comportamento
//       è stato modificato.
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader }   from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/OBJLoader.js';
import { patchGhostMaterial } from '../entities/dissolvePatch.js';

/* =============================================================================
   Helpers / util
============================================================================= */

/**
 * Riconosce “feature” del volto (occhi/bocca/guance) guardando nomi di mesh
 * o materiali: applicheremo un materiale leggermente diverso (edge/color).
 */
function isFeature(mesh, mat) {
  const a = (mesh?.name || '').toLowerCase();
  const b = (mat?.name  || '').toLowerCase();
  const re = /(ghost_)?(eyes?|mouth|cheeks?)/;
  return re.test(a) || re.test(b);
}

/**
 * Duplica i materiali originali della mesh creando:
 *  - un materiale “feature” per occhi/bocca/etc
 *  - un materiale “body” per il resto
 * Entrambi sono patchati con dissolve (patchGhostMaterial).
 */
function buildGhostMaterialsForMesh(mesh, opacityBody) {
  const src = mesh.material;
  const srcMats = Array.isArray(src) ? src : [src];
  const geom = mesh.geometry;

  const newMats = srcMats.map((m) => {
    const feature = isFeature(mesh, m);

    if (feature) {
      const fm = new THREE.MeshStandardMaterial({
        name: (m?.name || '') + '_feature',
        color: (m?.color ? m.color.clone() : new THREE.Color(0x111111)),
        metalness: 0.0, roughness: 0.6,
        transparent: true, opacity: Math.min(1, opacityBody + 0.15),
        depthWrite: false, depthTest: true,
        vertexColors: !!geom.attributes.color,
        emissive: new THREE.Color(0x000000), emissiveIntensity: 0.0
      });

      // Feature: bordo leggermente differente, dissolve lievemente “ritardato”
      patchGhostMaterial(fm, {
        edgeColor: 0xffd166,
        edgeWidth: 0.025,
        noiseScale: 1.15,
        thresholdBias: -0.03
      });

      return fm;
    }

    // Corpo principale
    const mat = new THREE.MeshStandardMaterial({
      name: (m?.name || '') + '_body',
      color: (m?.color ? m.color.clone() : new THREE.Color(0xffffff)),
      metalness: 0.0, roughness: 0.35,
      transparent: true, opacity: opacityBody,
      emissive: new THREE.Color(0x66ffff), emissiveIntensity: 0.40,
      depthWrite: false, depthTest: true,
      vertexColors: !!geom.attributes.color,
    });

    patchGhostMaterial(mat, {
      noiseScale: 0.65,
      edgeWidth: 0.06,
      flowSpeed: 0.35
    });

    return mat;
  });

  mesh.material = Array.isArray(src) ? newMats : newMats[0];
  return newMats;
}

/* =============================================================================
   Ring diegetico (indicatori a terra)
============================================================================= */

const _UP = new THREE.Vector3(0,1,0);
const _QN = new THREE.Quaternion();

/**
 * Materiale shader per l’arco progressivo del ring.
 * uProg in [0..1] determina l’angolo coperto.
 */
function makeArcMaterial(outerR, innerR) {
  const uniforms = {
    uOuterR:   { value: outerR },
    uInnerR:   { value: innerR },
    uProg:     { value: 0.0001 },            // 0..1 (exposure)
    uOpacity:  { value: 0.75 },
    uPulse:    { value: 0.0 },               // 0..1 breve flash
    uFeather:  { value: Math.max(outerR, innerR) * 0.02 }, // feather bordo
    uC1:       { value: new THREE.Color(0x33d1ff) }, // cyan
    uC2:       { value: new THREE.Color(0xffd166) }, // amber
    uC3:       { value: new THREE.Color(0xff6b6b) }, // red
  };

  const vert = `
    varying vec2 vPos; // xz locali
    void main(){
      vPos = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
    }
  `;

  const frag = `
    precision highp float;
    varying vec2 vPos;
    uniform float uOuterR, uInnerR, uProg, uOpacity, uPulse, uFeather;
    uniform vec3 uC1, uC2, uC3;

    void main(){
      float r = length(vPos);

      // ring con feather
      float ring = smoothstep(uInnerR, uInnerR + uFeather, r)
                 * (1.0 - smoothstep(uOuterR - uFeather, uOuterR, r));
      if (ring <= 0.0) discard;

      // angolo 0 in alto ( +Z ), senso orario
      float ang = atan(vPos.x, vPos.y);
      if (ang < 0.0) ang += 6.28318530718;
      float theta = clamp(uProg, 0.0, 1.0) * 6.28318530718;
      if (ang > theta) discard;

      // palette progressiva
      vec3 col = mix(uC1, uC2, smoothstep(0.20, 0.60, clamp(uProg,0.0,1.0)));
      col = mix(col, uC3, smoothstep(0.60, 1.00, clamp(uProg,0.0,1.0)));

      float a = uOpacity * (0.85 + 0.15 * clamp(uPulse,0.0,1.0));
      gl_FragColor = vec4(col, a) * ring;
    }
  `;

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    toneMapped: false
  });
}

/* =============================================================================
   Scratch temporanei (evitano allocazioni in update)
============================================================================= */
const _wRoot  = new THREE.Vector3();
const _wModel = new THREE.Vector3();
const _dir    = new THREE.Vector3();
const _right  = new THREE.Vector3();
const _tmpV   = new THREE.Vector3();
const _tmpV2  = new THREE.Vector3();

/* =============================================================================
   Classe Ghost
============================================================================= */

/**
 * @typedef {Object} GhostWeaveOpts
 * @property {boolean} [enabled=true]
 * @property {number}  [amp=0.35]
 * @property {number}  [omega=1.2]
 * @property {number}  [fadeNear=10]
 * @property {number}  [fadeFar=80]
 */

/**
 * @typedef {Object} GhostSwoopOpts
 * @property {number} [far=120]  Distanza oltre cui il ghost sta “alto”
 * @property {number} [near=55]  Distanza entro cui scende basso
 * @property {number} [hLow=1.6]
 * @property {number} [hHigh=7.2]
 * @property {number} [yLerp=3.2] Fattore di smoothing verticale
 */

/**
 * @typedef {Object} GhostOpts
 * @property {string} [url]                          GLB/OBJ del modello
 * @property {number} [targetHeight=2.2]             Altezza target post-normalizzazione
 * @property {number} [scaleJitter=0.28]             Randomizzatore di scala
 * @property {number} [opacityBody=0.75]             Opacità corpo
 * @property {(x:number,z:number)=>number} [getGroundY]
 * @property {(x:number,z:number)=>THREE.Vector3|null} [getGroundNormal]
 * @property {number} [clearance=0.05]               Quanta aria sopra il terreno
 * @property {()=>THREE.Vector3|null} [getTargetPos] Funzione che restituisce il target (player)
 * @property {number} [speed=6.0]
 * @property {number} [burstMultiplier=1.6]
 * @property {number} [yawRateDeg=720]
 * @property {number} [keepDistance=0.0]
 * @property {number} [arriveRadius=1.2]
 * @property {number} [hardLockDist=60]
 * @property {GhostWeaveOpts} [weave]
 * @property {GhostSwoopOpts} [swoop]
 * @property {number} [yawModelOffsetDeg=0]          Offset yaw del modello
 * @property {number} [alignSnapWindow=0.15]        Finestra di snap iniziale allineamento
 */

export class Ghost {
  /**
   * @param {GhostOpts} opts
   */
  constructor(opts = {}) {
    // --- Caricamento / look ---
    this.url           = opts.url ?? '/assets/models/ghost/ghost.glb';
    this.targetHeight  = opts.targetHeight ?? 2.2;
    this.scaleJitter   = opts.scaleJitter ?? 0.28;
    this.opacityBody   = opts.opacityBody ?? 0.75;

    // --- Terreno e target ---
    this.getGroundY = opts.getGroundY || ((x, z) => 0.0);
    this.getGroundNormal = opts.getGroundNormal || null;
    this.clearance  = (opts.clearance ?? 0.05);
    this.getTargetPos = opts.getTargetPos || null;

    // --- Gerarchia scene graph ---
    this.root = new THREE.Group(); this.root.name = 'Ghost';
    this.rig  = new THREE.Group(); this.rig.name  = 'GhostRig';
    this.root.add(this.rig);
    this.root.visible = false;

    this.model  = null;          // mesh/scene caricata
    this.materials   = [];       // materiali duplicati e patchati
    this.uniformSets = [];       // handle agli uniform condivisi del dissolve
    this.baseRadius  = 0.8;

    // --- Idle pose (bob + sway) ---
    this.idle = {
      baseY: 0.45,
      phase: Math.random() * Math.PI * 2,
      ampBob: 0.06,
      omegaBob: 1.2,
      swayAmpX: THREE.MathUtils.degToRad(4),
      swayAmpZ: THREE.MathUtils.degToRad(4),
      swayOmega: 1.05,
      clampGround: true,
      minY: 0.35,
      maxY: 0.60,
    };

    // --- Movimento orizzontale + parametri ---
    this.vel = new THREE.Vector3(0,0,0);
    this.yaw = 0;
    this.params = {
      appearDuration:   1.0,
      cleanseDuration:  0.8,
      speed:            opts.speed ?? 6.0,
      burstMultiplier:  opts.burstMultiplier ?? 1.6,
      yawRateDeg:       opts.yawRateDeg ?? 720,
      keepDistance:     opts.keepDistance ?? 0.0,
      arriveRadius:     opts.arriveRadius ?? 1.2,
      exposureFalloff:  0.6,
      hardLockDist:     opts.hardLockDist ?? 60
    };

    // --- Swoop (quota) ---
    this.swoop = {
      far:   opts.swoop?.far   ?? 120,
      near:  opts.swoop?.near  ?? 55,
      hLow:  opts.swoop?.hLow  ?? 1.6,
      hHigh: opts.swoop?.hHigh ?? 7.2,
      yLerp: opts.swoop?.yLerp ?? 3.2
    };

    // --- Allineamento iniziale ---
    this.yawModelOffsetDeg = opts.yawModelOffsetDeg ?? 0;
    this.yawModelOffset    = THREE.MathUtils.degToRad(this.yawModelOffsetDeg);
    this.alignSnapWindow   = opts.alignSnapWindow ?? 0.15;
    this._alignSnapT       = 0;

    // --- Serpentina (weave) ---
    this.weave = {
      enabled:  opts.weave?.enabled ?? true,
      amp:      opts.weave?.amp ?? 0.35,
      omega:    opts.weave?.omega ?? 1.2,
      fadeNear: opts.weave?.fadeNear ?? 10,
      fadeFar:  opts.weave?.fadeFar  ?? 80,
      phase:    Math.random() * Math.PI * 2,
    };
    this._weavePrev = new THREE.Vector3(0,0,0);

    // --- Stato / timers ---
    this.state    = 'inactive'; // 'inactive' | 'appearing' | 'active' | 'cleansing'
    this.tState   = 0;
    this.exposure = 0;

    // --- Pacificazione (totem safe) ---
    this._pacified = false;
    this._pacifyZone = null; // { center: Vector3, radius: number }
    this._keepDistanceBase = null;
    this._speedBase = null;

    // --- Ring diegetico ---
    this._ring = { group:null, base:null, arc:null, lastT:-1, radius:2.2, pulseT:0, pulseMax:0.22 };

    // --- Misc debug/time ---
    this._time = 0;
    this._debugPins = null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle / caricamento
  // ---------------------------------------------------------------------------

  /**
   * Carica il modello (GLB/OBJ), normalizza e applica i materiali patchati.
   * Inizializza il ring diegetico. Non aggiunge alla scena (usa addTo()).
   * @returns {Promise<Ghost>}
   */
  async load() {
    const isGLB = this.url.toLowerCase().endsWith('.glb') || this.url.toLowerCase().endsWith('.gltf');
    const model = isGLB
      ? (await new GLTFLoader().loadAsync(this.url)).scene
      : (await new OBJLoader().loadAsync(this.url));

    this.model = model;

    this._normalize();        // centra e scala al target height
    this._applyMaterials();   // duplica/patcha materiali e registra uniformSets
    this._ensureHierarchy();  // garantisce root > rig > model
    this._zeroLocalOffsetsXZ();

    if (this.yawModelOffset) this.model.rotation.y += this.yawModelOffset;

    this._setThreshold(0.98); // dissolve alto = quasi invisibile
    this.setVisible(false);

    this._buildRing();        // ring diegetico

    return this;
  }

  // ---------------------------------------------------------------------------
  // Interfaccia usata dallo spawner/main
  // ---------------------------------------------------------------------------

  /** Aggiunge il ghost a un parent della scena */
  addTo(parent) { parent.add(this.root); return this; }

  /** Imposta la posizione world della root */
  setPosition(x, y, z) { this.root.position.set(x, y, z); return this; }

  /** @returns {THREE.Vector3} posizione world (copiata in out) */
  getPosition(out = new THREE.Vector3()) { return out.copy(this.root.position); }

  /** Mostra/nasconde ghost e ring */
  setVisible(v) { this.root.visible = !!v; if (this._ring.group) this._ring.group.visible = !!v; return this; }

  /** Override dei parametri idle (bob/sway) */
  setIdleParams(partial = {}) { Object.assign(this.idle, partial); return this; }

  /** Reset kinematica (velocità/weave) senza toccare la posizione */
  resetKinematics(){
    this.vel.set(0,0,0);
    this._alignSnapT = 0;
    this._weavePrev.set(0,0,0);
    return this;
  }

  /** Spawn + transizione “appearing” */
  spawnAt(x, y, z) { this.setPosition(x, y, z); return this.appear(); }

  /** Entra nello stato 'appearing' */
  appear()    { return this._enter('appearing'); }

  /** Passa direttamente ad 'active' e porta il dissolve “pieno” */
  activate(){
    this._enter('active');
    this._setThreshold(0.15);
    return this;
  }

  /** Entra nello stato 'cleansing' (inizio dissolve finale) */
  cleanse()   { return this._enter('cleansing'); }

  /** Torna 'inactive' (nascosto e riciclabile) */
  deactivate(){ return this._enter('inactive'); }

  /**
   * Applica esposizione al beam. Se raggiunge 1 in 'active', entra in 'cleansing'.
   * Produce un breve “pulse” del ring e wisps proporzionali all’incremento.
   * @param {number} delta incremento (può essere negativo per decay)
   * @returns {boolean} true se ha triggerato cleanse
   */
  applyExposure(delta) {
    const before = this.exposure;
    this.exposure = THREE.MathUtils.clamp(this.exposure + delta, 0, 1);

    if (this.exposure > before + 1e-4) this._ring.pulseT = this._ring.pulseMax;
    const dExp = this.exposure - before;
    if (dExp > 0) this._emitWispHit(dExp);

    if (this.exposure >= 1 && this.state === 'active') {
      this.cleanse();
      return true;
    }
    return false;
  }

  /**
   * Pacifica il ghost quando il player è in zona protetta (totem).
   * Aumenta il keepDistance e riduce la velocità; opzionalmente definisce
   * un “perimetro” da rispettare.
   * @param {boolean} flag
   * @param {{center: THREE.Vector3, radius: number}|null} zone
   */
  setPacified(flag, zone = null) {
    const want = !!flag;
    const changed = (want !== this._pacified) ||
                    (want && (zone?.radius !== this._pacifyZone?.radius ||
                              !zone?.center?.equals?.(this._pacifyZone?.center)));
    if (!changed) return this;

    this._pacified = want;

    if (this._pacified) {
      if (this._keepDistanceBase == null) this._keepDistanceBase = this.params.keepDistance;
      if (this._speedBase == null)        this._speedBase = this.params.speed;

      if (zone && zone.center && isFinite(+zone.radius) && +zone.radius > 0) {
        this._pacifyZone = {
          center: zone.center.clone?.() ?? new THREE.Vector3(zone.center.x, zone.center.y||0, zone.center.z),
          radius: +zone.radius
        };
      } else {
        this._pacifyZone = null;
      }

      const fallbackKeep = 100;
      const perimeter = this._pacifyZone ? this._pacifyZone.radius + 6.0 : fallbackKeep;
      this.params.keepDistance = Math.max(this._keepDistanceBase ?? 0, perimeter);
      this.params.speed = Math.min(this._speedBase, this._speedBase * 0.6);
    } else {
      this._pacifyZone = null;
      if (this._keepDistanceBase != null) this.params.keepDistance = this._keepDistanceBase;
      if (this._speedBase != null)        this.params.speed        = this._speedBase;
    }
    return this;
  }

  /**
   * Tick di simulazione (chiamato a ogni frame dallo Spawner).
   * Gestisce shader time, idle pose, state machine e ring.
   * @param {number} dt Delta-time in secondi
   */
  update(dt) {
    this._time += dt;

    // Uniform time per dissolve/edge noise (se esiste)
    for (const set of this.uniformSets) {
      if (set?.uPulseTime) set.uPulseTime.value = this._time;
    }

    if (this.root.visible) this._updateIdle(dt);

    this.tState += dt;
    switch (this.state) {
      case 'appearing': this._updateAppearing(dt); break;
      case 'active':    this._updateActive(dt);    break;
      case 'cleansing': this._updateCleansing(dt); break;
    }

    // Sicurezza: garantisci rig > model offset neutro in XZ
    if (this.model && this.root.parent) {
      this.root.getWorldPosition(_wRoot);
      this.model.getWorldPosition(_wModel);
      const dx = Math.abs(_wModel.x - _wRoot.x);
      const dz = Math.abs(_wModel.z - _wRoot.z);
      if (dx > 0.02 || dz > 0.02) {
        this._ensureHierarchy();
        this._zeroLocalOffsetsXZ();
      }
    }

    // Ring
    this._updateRing(dt);
  }

  /* =================== Internals (state & movement) =================== */

  _enter(next) {
    this.state  = next;
    this.tState = 0;

    if (next === 'inactive') {
      this.setVisible(false);
      this.exposure = 0;
      this._setThreshold(0.98);
    }

    if (next === 'appearing'){
      this.setVisible(true);
      this.exposure = 0;
      this._setThreshold(0.98);

      // Spawn “alto” (canopy) e piccolo jitter
      const gx = this.root.position.x;
      const gz = this.root.position.z;
      const gy = this.getGroundY(gx, gz);
      const jitter = 1.0 + Math.random()*1.4;
      const yCanopy = gy + this.swoop.hHigh + jitter;
      if (!isNaN(yCanopy)) this.root.position.y = Math.max(this.root.position.y, yCanopy);

      // Snap iniziale verso il target (evita esitazione al primo frame)
      const target = (typeof this.getTargetPos === 'function') ? this.getTargetPos() : null;
      if (target) {
        this._alignInstant(target);
        this._alignSnapT = this.alignSnapWindow;
      }
      this._weavePrev.set(0,0,0);
    }

    if (next === 'active') {
      this.setVisible(true);
      this._setThreshold(0.25);
      const target = (typeof this.getTargetPos === 'function') ? this.getTargetPos() : null;
      if (target) {
        this._alignInstant(target);
        this._alignSnapT = Math.max(this._alignSnapT, this.alignSnapWindow * 0.5);
      }
      this._weavePrev.set(0,0,0);
    }

    // Burst wisps quando inizia il cleanse
    if (next === 'cleansing') {
      this._emitWispBurst();
    }

    return this;
  }

  _alignInstant(target){
    _dir.subVectors(target, this.root.position);
    _dir.y = 0;
    const len = _dir.length();
    if (len < 1e-6) _dir.set(0,0,1);
    else            _dir.multiplyScalar(1/len);

    this.vel.copy(_dir);
    this.yaw = Math.atan2(_dir.x, _dir.z);
    this.rig.rotation.y = this.yaw;
  }

  _updateAppearing(dt) {
    const d = this.params.appearDuration || 1.0;
    const t = THREE.MathUtils.clamp(this.tState / d, 0, 1);
    const k = t * t * (3 - 2 * t);
    const thr = THREE.MathUtils.lerp(0.98, 0.25, k);
    this._setThreshold(thr);
    if (t >= 1 || thr <= 0.26) this.activate();
  }

  _updateActive(dt) {
    // Decadimento naturale dell’esposizione
    if (this.exposure > 0) this.applyExposure(-this.params.exposureFalloff * dt);

    // Barriera se pacificato (non entra nel perimetro)
    if (this._pacified && this._pacifyZone) {
      const cx = this._pacifyZone.center.x, cz = this._pacifyZone.center.z;
      const dx = this.root.position.x - cx;
      const dz = this.root.position.z - cz;
      const r  = Math.hypot(dx, dz);
      const minR = (this._pacifyZone.radius || 0) + 2.0;
      if (r < Math.max(0.01, minR)) {
        const nx = dx / (r || 1e-6), nz = dz / (r || 1e-6);
        const push = (minR - r);
        this.root.position.x += nx * push;
        this.root.position.z += nz * push;
      }
    }

    // Target
    if (typeof this.getTargetPos !== 'function') return;
    const target = this.getTargetPos();
    if (!target) return;

    // Direzione/turn-rate
    _dir.subVectors(target, this.root.position);
    _dir.y = 0;
    const dist = _dir.length();
    if (!isFinite(dist) || dist < 1e-6) return;
    _dir.multiplyScalar(1 / dist);

    const yawRate = THREE.MathUtils.degToRad(this.params.yawRateDeg || 720);
    let kTurn = Math.min(1, yawRate * dt);

    if (this._alignSnapT > 0) {
      this.vel.copy(_dir);
      const yawTarget = Math.atan2(_dir.x, _dir.z);
      this.yaw = yawTarget;
      this.rig.rotation.y = this.yaw;
      this._alignSnapT -= dt;
    } else {
      if (dist >= this.params.hardLockDist) {
        this.vel.copy(_dir);
      } else {
        if (this.vel.lengthSq() < 1e-6) {
          this.vel.copy(_dir);
        } else {
          const cur = _tmpV.copy(this.vel).normalize();
          const cosA = THREE.MathUtils.clamp(cur.dot(_dir), -1, 1);
          const ang = Math.acos(cosA);
          if (ang > THREE.MathUtils.degToRad(35)) kTurn = Math.min(1, kTurn * 3.5);
          cur.lerp(_dir, kTurn).normalize();
          this.vel.copy(cur);
        }
      }
      if (this.vel.lengthSq() > 1e-6) {
        const yawTarget = Math.atan2(this.vel.x, this.vel.z);
        let dy = yawTarget - this.yaw;
        while (dy >  Math.PI) dy -= 2*Math.PI;
        while (dy < -Math.PI) dy += 2*Math.PI;
        this.yaw += dy * Math.min(1, yawRate * dt);
        this.rig.rotation.y = this.yaw;
      }
    }

    // Velocità & inseguimento (arrive/stop)
    let spd = this.params.speed;
    if (dist > this.swoop.far) spd *= this.params.burstMultiplier;

    const stop    = Math.max(0, this.params.keepDistance || 0);
    const arriveR = Math.max(1e-3, this.params.arriveRadius || 0.03);
    const desired = Math.max(0, dist - stop);

    if (desired <= arriveR) {
      this.root.position.x = target.x - _dir.x * stop;
      this.root.position.z = target.z - _dir.z * stop;
    } else {
      const step = spd * dt;
      this.root.position.x += this.vel.x * step;
      this.root.position.z += this.vel.z * step;
    }

    // Serpentina (weave) in XZ, smorzata vicino al target
    if (this.weave.enabled) {
      if (this.vel.lengthSq() > 1e-6) _right.set(this.vel.z, 0, -this.vel.x).normalize();
      else                             _right.set(_dir.z, 0, -_dir.x).normalize();

      const kDist = THREE.MathUtils.clamp((dist - this.weave.fadeNear) / Math.max(1e-3, (this.weave.fadeFar - this.weave.fadeNear)), 0, 1);
      const kNear = THREE.MathUtils.clamp(desired / (arriveR * 1.5), 0, 1);

      const A = this.weave.amp * kDist * kNear;
      const s = Math.sin(this.weave.omega * this._time + this.weave.phase);

      const off = _tmpV.copy(_right).multiplyScalar(A * s);
      const delta = _tmpV2.copy(off).sub(this._weavePrev);
      this.root.position.add(delta);
      this._weavePrev.copy(off);
    }

    // Quota (swoop): alto quando lontano → basso quando vicino
    const gy = this.getGroundY(this.root.position.x, this.root.position.z);
    const yHigh = gy + this.swoop.hHigh;
    const yLow  = gy + this.swoop.hLow;
    const yTarget = (dist > this.swoop.far) ? yHigh
                  : (dist <= this.swoop.near ? yLow
                                             : THREE.MathUtils.lerp(yHigh, yLow, (this.swoop.far - dist)/(this.swoop.far - this.swoop.near)));
    const yK = Math.min(1, this.swoop.yLerp * dt);
    this.root.position.y = THREE.MathUtils.lerp(this.root.position.y, yTarget, yK);
  }

  _updateCleansing(dt) {
    const d = this.params.cleanseDuration || 0.8;
    const t = THREE.MathUtils.clamp(this.tState / d, 0, 1);
    const k = t * t * (3 - 2 * t);
    const start = Math.max(0.25, this._getThreshold());
    const thr = THREE.MathUtils.lerp(start, 0.98, k);
    this._setThreshold(thr);
    if (t >= 1 || thr >= 0.97) this.deactivate();
  }

  // Idle pose locale (bob + sway), clamp al terreno
  _updateIdle(dt) {
    const t = this._time, ph = this.idle.phase;
    let y = this.idle.baseY + this.idle.ampBob * Math.sin(this.idle.omegaBob * t + ph);

    // Clamp al terreno in spazio locale del rig
    let floorLocal = -Infinity;
    if (this.root) {
      this.root.getWorldPosition(_wRoot);
      const groundY = this.getGroundY(_wRoot.x, _wRoot.z) + this.clearance;
      const toLocal = new THREE.Vector3(_wRoot.x, groundY, _wRoot.z);
      this.root.worldToLocal(toLocal);
      floorLocal = Math.max(floorLocal, toLocal.y);
    }
    const ySafe = Math.min(this.idle.maxY, Math.max(floorLocal, y));
    this.rig.position.y = ySafe;

    // Sway lieve su X/Z
    const rx = this.idle.swayAmpX * Math.sin(this.idle.swayOmega * t + ph * 0.7);
    const rz = this.idle.swayAmpZ * Math.sin(this.idle.swayOmega * t + ph * 0.9);
    this.rig.rotation.x = rx;
    this.rig.rotation.z = rz;
  }

  // ---------------------------------------------------------------------------
  // Shader uniforms / gerarchia / normalizzazione
  // ---------------------------------------------------------------------------

  _setThreshold(v) { for (const s of this.uniformSets) if (s?.uThreshold) s.uThreshold.value = v; }
  _getThreshold()  { for (const s of this.uniformSets) if (s?.uThreshold) return s.uThreshold.value; return 0.98; }

  // Porta il modello a scala targetHeight, centrato XZ e poggiato a terra
  _normalize() {
    const box = new THREE.Box3().setFromObject(this.model);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);

    this.model.position.x -= center.x;
    this.model.position.z -= center.z;
    this.model.position.y -= box.min.y;

    const jitter = 1 + (Math.random()*2 - 1) * this.scaleJitter;
    const s = (this.targetHeight * jitter / (size.y || 1.0));
    this.model.scale.setScalar(s);

    const box2 = new THREE.Box3().setFromObject(this.model);
    this.model.position.y -= box2.min.y;
  }

  // Duplica/patcha materiali e registra i set di uniform del dissolve
  _applyMaterials() {
    const meshes = [];
    this.model.traverse((o) => { if (o.isMesh) meshes.push(o); });
    for (const o of meshes) {
      const mats = buildGhostMaterialsForMesh(o, this.opacityBody);
      const arr = Array.isArray(mats) ? mats : [mats];
      this.materials.push(...arr);
      for (const m of arr) {
        const u = m?.userData?._ghostUniforms;
        if (u) this.uniformSets.push(u);
      }
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = 10; // render dopo il terreno/altro
    }
  }

  // Garantisce root > rig > model
  _ensureHierarchy() {
    if (this.model.parent !== this.rig) this.rig.add(this.model);
    if (this.rig.parent !== this.root) this.root.add(this.rig);
    this.model.updateMatrixWorld(true);
    this.rig.updateMatrixWorld(true);
    this.root.updateMatrixWorld(true);
  }

  // Azzeramento offset XZ locali (stabilità gerarchia)
  _zeroLocalOffsetsXZ() {
    this.rig.position.x = 0;   this.rig.position.z = 0;
    this.model.position.x = 0; this.model.position.z = 0;
  }

  // ---------------------------------------------------------------------------
  // Ring diegetico (base + arco shader)
  // ---------------------------------------------------------------------------

  _buildRing(){
    const r = this._ring.radius;

    // Base tenue (con polygonOffset per evitare z-fighting)
    const baseGeo = new THREE.RingGeometry(r * 0.82, r * 1.00, 64);
    baseGeo.rotateX(-Math.PI/2);
    const baseMat = new THREE.MeshBasicMaterial({
      color: 0x99e6ff,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      depthTest: false,              // non testa contro la depth del terreno
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.renderOrder = 999;

    // Arco shader (quad XZ, tagliato via shader a uProg)
    const arcGeo = new THREE.PlaneGeometry(2*r, 2*r);
    arcGeo.rotateX(-Math.PI/2);
    const arcMat = makeArcMaterial(r * 1.00, r * 0.74);
    arcMat.depthWrite = false;
    arcMat.depthTest  = false;
    const arc = new THREE.Mesh(arcGeo, arcMat);
    arc.renderOrder = 1000;

    const g = new THREE.Group();
    g.add(base); g.add(arc);
    g.visible = false;
    this.root.add(g);

    this._ring.group = g;
    this._ring.base  = base;
    this._ring.arc   = arc;
    this._ring.lastT = -1;
  }

  _updateRing(dt){
    const R = this._ring;
    if (!R?.group) return;

    // Posiziona pochi cm sopra il terreno locale della root
    const gx = this.root.position.x, gz = this.root.position.z;
    const gy = this.getGroundY(gx, gz);
    R.group.position.set(0, (gy + 0.10) - this.root.position.y, 0);

    // Tilt opzionale con la normale del terreno
    if (typeof this.getGroundNormal === 'function') {
      const n = this.getGroundNormal(gx, gz) || _UP;
      _QN.setFromUnitVectors(_UP, n.clone().normalize());
      R.group.quaternion.copy(_QN);
    } else {
      R.group.quaternion.identity();
    }

    // Pulse / visibilità
    R.pulseT = Math.max(0, R.pulseT - dt);
    const t = THREE.MathUtils.clamp(this.exposure, 0, 1);

    const activeOrAppearing = (this.state === 'active') || (this.state === 'appearing' && this.tState < 0.25);
    const pulsing           = (R.pulseT > 0);
    const showBaseWhenActive= (this.state === 'active');

    R.group.visible = (activeOrAppearing || pulsing || showBaseWhenActive) && this.root.visible;

    // Base: opacità leggermente inferiore quando always-on in 'active'
    if (R.base) {
      const baseAlpha = showBaseWhenActive ? 0.16 : 0.22;
      const k = pulsing ? (baseAlpha + 0.28 * (R.pulseT / R.pulseMax)) : baseAlpha;
      R.base.material.opacity = k;
    }

    // Arco (uProg=exposure)
    if (R.arc?.material?.uniforms) {
      const U = R.arc.material.uniforms;
      U.uProg.value  = t;
      U.uPulse.value = pulsing ? (R.pulseT / R.pulseMax) : 0.0;
    }
  }

  // ---------------------------------------------------------------------------
  // Wisps (effetti particellari) — variante attiva: guaina attorno al ghost
  // ---------------------------------------------------------------------------

  // Variante "fire near ghost" (attiva)
  _emitWispHit(deltaExp){
    if (!window.wisps || deltaExp <= 0) return;

    // Colore in rampa: cyan → amber → red con l’aumentare dell’exposure
    const c1 = new THREE.Color(0x33d1ff);
    const c2 = new THREE.Color(0xffd166);
    const c3 = new THREE.Color(0xff6b6b);
    const t  = THREE.MathUtils.clamp(this.exposure, 0, 1);
    const col = (t < 0.6)
      ? c1.clone().lerp(c2, THREE.MathUtils.smoothstep(t, 0.20, 0.60))
      : c2.clone().lerp(c3, THREE.MathUtils.smoothstep(t, 0.60, 1.00));

    // Centro della “guaina” a metà altezza visiva del ghost
    const H     = Math.max(1.0, this.targetHeight * 0.9);
    const center= new THREE.Vector3(
      this.root.position.x,
      this.root.position.y + this.rig.position.y + H * 0.5,
      this.root.position.z
    );

    const rad   = Math.max(0.35, (this._ring?.radius ?? 2.2) * 0.45);
    const count = Math.max(2, Math.floor(6 + 80 * deltaExp));

    window.wisps.emitSheath(center, H, rad, count, {
      up: 1.2, out: 0.55, spread: 0.28,
      size: [0.6, 1.6],
      life: [0.8, 1.5],
      tint: col
    });
  }

  _emitWispBurst(){
    if (!window.wisps) return;

    const H = Math.max(1.0, this.targetHeight * 0.9);
    const center = new THREE.Vector3(
      this.root.position.x,
      this.root.position.y + this.rig.position.y + H * 0.5,
      this.root.position.z
    );
    window.wisps.emitBurst(center, 140, {
      up: 2.6, out: 2.0,
      size: [1.0, 2.6],
      life: [1.2, 2.0],
      tint: new THREE.Color(0xffd166)
    });
  }

  // ---------------------------------------------------------------------------
  // Debug (dissolve patch)
  // ---------------------------------------------------------------------------

  /** Setta un eventuale debug mode per la patch dissolve (se presente). */
  setDebugMode(mode = 0) {
    for (const s of this.uniformSets) {
      if (s?.uDebugMode) s.uDebugMode.value = mode | 0;
    }
    return this;
  }
}

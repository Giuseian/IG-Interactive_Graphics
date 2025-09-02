// src/systems/SanctuarySystem.js
// -----------------------------------------------------------------------------
// SanctuarySystem
// -----------------------------------------------------------------------------
// Gestisce i “santuari/totem” con ring a terra e beacon, macchina a stati
// (idle → armed → purifying → done), carica il modello FBX per ogni istanza,
// aggiorna i materiali/emissive e, mentre purifichi, fornisce safe-zone al
// resto del gioco (es. pausa aggro nello spawner).
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { FBXLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/FBXLoader.js';

/** Clona i materiali per ogni mesh (evita sharing tra cloni) */
function cloneMaterialsPerMesh(root){
  root.traverse(o=>{
    if (!o.isMesh || !o.material) return;
    const src = o.material;
    if (Array.isArray(src)) {
      o.material = src.map(m => (m?.clone ? m.clone() : m));
      for (const m of o.material) if (m) m.needsUpdate = true;
    } else {
      o.material = src.clone?.() ?? src;
      if (o.material) o.material.needsUpdate = true;
    }
  });
}

/** Scala a un'altezza target e appoggia la base a y=0. Ritorna l’altezza finale. */
function fitObjectToHeight(obj, targetH = 0.9) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  const curH = size.y > 1e-6 ? size.y : 1.0;

  const s = targetH / curH;
  obj.scale.multiplyScalar(s);

  obj.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box2.min.y; // base a terra

  obj.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(obj);
  const sz3 = new THREE.Vector3(); box3.getSize(sz3);
  return sz3.y;
}

export class SanctuarySystem {
  /**
   * @param {Object} opts
   * @param {THREE.Scene}  opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {Object}       opts.beamSystem
   * @param {Object}       opts.spawner
   * @param {string}       opts.modelUrl
   * @param {Array<{x:number, z:number, radius?:number, holdSeconds?:number, targetHeight?:number}>} [opts.items]
   * @param {number}  [opts.decayRate=0.25]
   * @param {number}  [opts.targetHeight=200.5]  // cm
   * @param {number}  [opts.entryPad=8.0]
   * @param {function} [opts.onPurified]         // (index, doneCount, total)
   * @param {number}  [opts.purifyGrace=0.6]
   * @param {number}  [opts.aimStick=0.2]
   * @param {function} [opts.onBeamTint]         // (hex|null)
   */
  constructor(opts = {}) {
    // Dependenze
    this.scene       = opts.scene;
    this.camera      = opts.camera;
    this.beamSystem  = opts.beamSystem;
    this.spawner     = opts.spawner;

    // Config
    this.modelUrl     = opts.modelUrl;
    this.itemsDef     = opts.items || [];   // array di items (posizioni e parametri dei singoli totem)
    this.decayRate    = opts.decayRate ?? 0.25;
    this.targetHeight = opts.targetHeight ?? 200.5; // cm
    this.entryPad     = opts.entryPad ?? 8.0;

    // Callback
    this.onPurified  = typeof opts.onPurified  === 'function' ? opts.onPurified  : null;
    this.onBeamTint  = typeof opts.onBeamTint  === 'function' ? opts.onBeamTint  : null;

    // Anti-flicker
    this.purifyGrace = opts.purifyGrace ?? 0.6;
    this.aimStick    = opts.aimStick    ?? 0.2;

    // Scratch
    this._ray     = new THREE.Raycaster();
    this._tmpV    = new THREE.Vector3();
    this._tmpV2   = new THREE.Vector3();
    this._apex    = new THREE.Vector3();
    this._beamDir = new THREE.Vector3();
    this._tmpC    = new THREE.Color();

    // Stato istanze
    this._fbx       = null;
    this._sanct     = [];
    this._doneCount = 0;

    // Tempo & palette
    this._time      = 0;
    this._colIdle   = new THREE.Color(0x64a6ff); // blu (idle)
    this._colArmed  = new THREE.Color(0xff6b6b); // rosso (armed)
    this._colYellow = new THREE.Color(0xffe066); // giallo (purifying start)
    this._colDone   = new THREE.Color(0x39ff95); // verde (done)

    this._purifyingCount = 0;
    this._safeCount      = 0;

    // Tinta BEAM
    this._lastBeamHex = null;
  }

  async init(){
    const loader = new FBXLoader();
    this._fbx = await loader.loadAsync(this.modelUrl);  // load fbx 

    // Normalizza materiali del modello base (emissive off all’inizio) 
    this._fbx.traverse(o=>{
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const m = o.material;
      if (!m || m.isShaderMaterial) return;
      if (!('emissive' in m)) {
        o.material = new THREE.MeshStandardMaterial({
          color: m.color ? m.color.clone() : new THREE.Color(0xaaaaaa),
          roughness: 0.85, metalness: 0.0,
          emissive: new THREE.Color(0x000000),
          emissiveIntensity: 0.0
        });
      } else {
        m.emissive = m.emissive || new THREE.Color(0x000000);
        m.emissiveIntensity = 0.0;
      }
    });

    // Istanze dei santuari
    for (let i = 0; i < this.itemsDef.length; i++){  // per ogni totem
      const def  = this.itemsDef[i];
      const root = new THREE.Group();  // Crea un group alla posizione XZ 
      root.position.set(def.x, 0, def.z);
      this.scene.add(root);

      const model = this._fbx.clone(true);  // clona il modello 
      cloneMaterialsPerMesh(model);   // clona i materiali -> così l'emissive di un totem non sporca gli altri 
      const finalH = fitObjectToHeight(model, def.targetHeight ?? this.targetHeight);  // adatta la scala a un'altezza target e appoggia la base a terra 
      root.add(model);

      // Collider statico (per camera/occlusion)  -> serve per occluder/ostacolo 
      const bbox   = new THREE.Box3().setFromObject(model);
      const size   = new THREE.Vector3(); bbox.getSize(size);
      const rXZ    = 0.5 * Math.max(size.x, size.z);
      const colRad = Math.max(12, rXZ * 0.65);
      const colH   = Math.max(30, size.y);

      // Ring (anello pieno tenute) + glow (esterno additivo) + outline (interno scuro)
      const rOuter = (def.radius != null) ? def.radius : 100;
      const rInner = Math.max(0.6 * rOuter, rOuter - 8.0);

      const ringGeo = new THREE.RingGeometry(rInner, rOuter, 64);
      ringGeo.rotateX(-Math.PI/2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: this._colIdle.clone(), transparent: true, opacity: 0.25, depthWrite: false, fog: false
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 0.02;
      root.add(ring);

      const outlineGeo = new THREE.RingGeometry(rInner * 0.92, rInner * 0.98, 64);
      outlineGeo.rotateX(-Math.PI/2);
      const outlineMat = new THREE.MeshBasicMaterial({
        color: 0x0a0f14, transparent: true, opacity: 0.25, depthWrite:false, fog:false
      });
      const ringOutline = new THREE.Mesh(outlineGeo, outlineMat);
      ringOutline.position.y = 0.018;
      root.add(ringOutline);

      const glowGeo = new THREE.RingGeometry(rOuter * 1.00, rOuter * 1.05, 64);
      glowGeo.rotateX(-Math.PI/2);
      const glowMat = new THREE.MeshBasicMaterial({
        color: this._colIdle.clone(), transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite:false, fog:false
      });
      const ringGlow = new THREE.Mesh(glowGeo, glowMat);
      ringGlow.position.y = 0.021;
      root.add(ringGlow);

      // Beacon cilindrico (si alza sopra il totem)
      const hBeacon  = Math.max(6, finalH * 2.8);
      const rBottom  = Math.max(0.6, rOuter * 0.12);
      const rTop     = Math.max(0.3, rOuter * 0.04);
      const beaconGeo = new THREE.CylinderGeometry(rTop, rBottom, hBeacon, 24, 1, true);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: 0x66ccff, transparent:true, opacity:0.06,
        blending: THREE.AdditiveBlending, depthWrite:false, side: THREE.DoubleSide, fog:false
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      const beaconInset = Math.max(0.6, rBottom * 0.65);
      beacon.position.y = finalH + hBeacon * 0.5 - beaconInset;  // sopra la testa del totem 
      root.add(beacon);

      // Luce di stato
      const light = new THREE.PointLight(0x66ffcc, 0.0, rOuter * 6, 2.0);
      light.position.set(0, Math.max(1.0, finalH * 1.2), 0);
      root.add(light);

      // Stato runtime della singola istanza
      this._sanct.push({
        def, root, model, ring, ringOutline, ringGlow, beacon, light,
        modelHeight: finalH,
        aimYOffset: finalH * 0.85,
        charge: 0,
        holdSeconds: def.holdSeconds ?? 3.0,
        radius: rOuter,
        state: 'idle',
        _spawnTick: 0,
        lastPurifyT: -1,
        aimStickUntil: 0,
        collider: { pos: new THREE.Vector3(def.x, 0, def.z), radius: colRad, height: colH }
      });
    }
  }

  /** Colore di purifica: giallo→verde con easing. */
  _purifyColor(out, t){
    t = THREE.MathUtils.clamp(t, 0, 1);
    const te = t * t * (3.0 - 2.0 * t);
    out.copy(this._colYellow).lerp(this._colDone, te);
    return out;
  }

  /** Tinta del beam in base allo stato del totem focalizzato. */
  _beamHexForState(s, t){
    if (s === 'armed') return this._colArmed.getHex();
    if (s === 'purifying'){
      this._purifyColor(this._tmpC, t);
      return this._tmpC.getHex();
    }
    return null;
  }

  /**
   * Update principale.
   * @param {number} dt
   * @param {{playerPos:THREE.Vector3, overheated?:boolean, beamOn?:boolean}} ctx
   */
  update(dt, ctx = {}){
    // ctx è la posizione del player 
    if (!this.beamSystem || this._sanct.length === 0) return;

    this._time += dt;

    const beam    = this.beamSystem;   // stato beam 
    const cosHalf = Math.cos(THREE.MathUtils.degToRad(beam.halfAngleDeg));  // mezzo angolo del cono 
    beam.getBeamApex?.(this._apex);   // apice del raggio del beam 
    beam.getBeamForward?.(this._beamDir);  // direzione del raggio del beam

    const obstacles = beam.obstacles || [];  // ostacoli per linea di vista 
    const maxRange  = beam.maxRange || 9999;  // portata massima del raggio 

    const inOverheat = !!ctx.overheated;
    const beamOn     = !!ctx.beamOn;

    let purifyingNow = 0;
    let safeNow      = 0;

    for (let i = 0; i < this._sanct.length; i++){  // per ogni totem 
      const s = this._sanct[i];
      if (s.state === 'done') { this._applyVisual(s, 1.0, 'done'); continue; }  // check se tutti i totem sono stati purificati 

      // 1) Player nel ring (con entryPad)
      const dx = ctx.playerPos.x - s.root.position.x;  // distanza_x tra posizione del player e santuario 
      const dz = ctx.playerPos.z - s.root.position.z;
      const rad = s.radius + this.entryPad;
      const inCircle = (dx*dx + dz*dz) <= (rad*rad);  // sei nel cerchio ? 

      // 2) Totem nel cono + LOS
      // aim è un punto mirabile del totem -> più in alto del centro, così da non mirare il pavimento 
      const aim = this._tmpV.set(s.root.position.x, s.root.position.y + s.aimYOffset, s.root.position.z);
      const to  = this._tmpV2.subVectors(aim, this._apex);  // vettore dall'apice del beam al punto 
      const dist = to.length();  // distanza dall'apice del beam al punto 
      let inCone = false, losOK = false;

      if (dist > 1e-3 && dist <= maxRange) {   // se il punto è entro portata  
        to.multiplyScalar(1/dist);  // normalizza il punto dell'apice del beam al punto 
        // Test angolare 
        inCone = (to.dot(this._beamDir) >= cosHalf);  // vedo se l'angolo tra la direzione del beam e "to" è <= mezzo angolo del cono 
        if (inCone) { // se è dentro al cono, verifica linea di vista (LOS)
          if (obstacles.length === 0) {  // se obstacles è vuoto, allora ok 
            losOK = true;
          } else {  // altrimenti, fai recast dall'apice ad aim -> fallisce se colpisce ostacoli 
            this._ray.set(this._apex, to); this._ray.far = dist;
            losOK = (this._ray.intersectObjects(obstacles, true).length === 0);
          }
        }
      }

      // Hysteresis : Se in questo frame entri nel cono con LOS valida, "agganci" la mira per un piccolo delta : se il mouse trema non perdi subito la mira 
      if (inCone && losOK) s.aimStickUntil = this._time + this.aimStick;

      const aimOK        = (inCone || (this._time < s.aimStickUntil)) && losOK;  
      const canPoint     = inCircle && aimOK;
      const canChargeNow = canPoint && beamOn && !inOverheat; // puoi caricare solo se punti, il beam è ON e non sei overheated 

      // Grace : dopo avere purificato, per un piccolo intervallo, mantieni la possibilità di caricare anche se per un attimo hai perso il beam 
      const stillInGrace = inCircle && (this._time - s.lastPurifyT) <= this.purifyGrace;
      const canCharge    = canChargeNow || stillInGrace;

      // caricamento 
      if (canCharge) {
        s.state  = 'purifying';
        s.charge = Math.min(s.holdSeconds, s.charge + dt);  // accumula carica 
        s._spawnTick += dt;
        s.lastPurifyT = this._time;
        purifyingNow++;
        safeNow++;
      } else {  // Se resti nel ring, la carica decade lentamente 
        s.state  = inCircle ? 'armed' : 'idle';
        if (!stillInGrace) s.charge = Math.max(0, s.charge - this.decayRate * dt);
        s._spawnTick = 0;
        if (s.state === 'armed') safeNow++;
      }

      // calcola il progress e aggiorna i materiali coerentemente allo stato 
      const t = THREE.MathUtils.clamp(s.charge / s.holdSeconds, 0, 1);
      this._applyVisual(s, t, s.state);

      // Completato?
      if (t >= 1 && s.state !== 'done') {
        s.state = 'done';
        this._applyVisual(s, 1, 'done');
        this._doneCount++;
        if (this.onPurified) this.onPurified(i, this._doneCount, this._sanct.length);
        if (this._doneCount === this._sanct.length) this._celebrateAll();
      }
    }

    // --- TINT arma & SAFE ZONE (in base al totem “attuale” più vicino)
    let tintHex    = null;
    let safeCenter = null;
    let safeRadius = 0;

    if (this._sanct.length){
      let best = null, bestD = Infinity;
      for (const s of this._sanct){
        const dx = ctx.playerPos.x - s.root.position.x;
        const dz = ctx.playerPos.z - s.root.position.z;
        const inCircle = (dx*dx + dz*dz) <= (s.radius + this.entryPad) ** 2;
        if (!inCircle) continue;
        const d = Math.hypot(dx, dz);
        if (d < bestD){ best = s; bestD = d; }
      }
      if (best){
        const t = THREE.MathUtils.clamp(best.charge / best.holdSeconds, 0, 1);
        tintHex    = this._beamHexForState(best.state, t);
        safeCenter = best.root.position;
        safeRadius = best.radius + this.entryPad;
      }
    }

    if (this.onBeamTint && tintHex !== this._lastBeamHex){
      this._lastBeamHex = tintHex;
      this.onBeamTint(tintHex);
    }

    this._safeCount      = safeNow;
    this._purifyingCount = purifyingNow;

    // Comunica allo spawner la pausa aggro quando sei “in santuario”
    if (this.spawner?.pauseAggro) {
      this.spawner.pauseAggro(this._safeCount > 0);
    }
  }

  // Pittore del sistema - In base allo stato e alla progressione, modula ring e glow, beacon ed emissive del modello 
  _applyVisual(s, t, mode){
    const ringMat   = s.ring.material;
    const beaconMat = s.beacon.material;
    const glowMat   = s.ringGlow.material;

    switch(mode){
      case 'idle': {
        ringMat.color.copy(this._colIdle); ringMat.opacity = 0.25;  // blu tenue 
        glowMat.color.copy(this._colIdle); glowMat.opacity = 0.10;  // blu tenue 
        beaconMat.color.copy(this._colIdle); beaconMat.opacity = 0.06;
        this._setModelEmissive(s.model, new THREE.Color(0x000000), 0.0);
        s.light.color.copy(this._colIdle); s.light.intensity = 0.0;
      } break;

      case 'armed': {
        ringMat.color.copy(this._colArmed); ringMat.opacity = 0.28;  // rosso
        glowMat.color.copy(this._colArmed); glowMat.opacity = 0.12;  // rosso
        beaconMat.color.copy(this._colArmed); beaconMat.opacity = 0.10;
        this._setModelEmissive(s.model, this._colArmed, 0.25);
        s.light.color.copy(this._colArmed); s.light.intensity = 0.4;
      } break;

      case 'purifying': {
        const c = this._purifyColor(this._tmpC, t);
        ringMat.color.copy(c);   ringMat.opacity   = 0.28 + 0.27 * t;  // giallo -> verde 
        glowMat.color.copy(c);   glowMat.opacity   = 0.14 + 0.18 * t;  // giallo -> verde
        beaconMat.color.copy(c); beaconMat.opacity = 0.10 + 0.32 * t;
        this._setModelEmissive(s.model, c, 0.5 + 1.2 * t);
        s.light.color.copy(c);   s.light.intensity = 1.0 + 1.4 * t;
      } break;

      case 'done':
      default: {
        ringMat.color.copy(this._colDone); ringMat.opacity = 0.45;
        glowMat.color.copy(this._colDone); glowMat.opacity = 0.22;
        beaconMat.color.copy(this._colDone); beaconMat.opacity = 0.50;
        this._setModelEmissive(s.model, this._colDone, 1.9);
        s.light.color.copy(this._colDone); s.light.intensity = 1.9;
      } break;
    }

    ringMat.needsUpdate   = true;
    beaconMat.needsUpdate = true;
    glowMat.needsUpdate   = true;
  }

  _setModelEmissive(model, color, intensity){
    model.traverse(o=>{
      if (o.isMesh && o.material && 'emissive' in o.material) {
        o.material.emissive.copy(color);
        o.material.emissiveIntensity = intensity;
        o.material.needsUpdate = true;
      }
    });
  }

  /** Info del santuario più vicino: { state, t, dist, radius } */
  getNearestInfo(playerPos){
    if (!this._sanct.length) return null;
    let best=null, bestD=Infinity;
    for (const s of this._sanct){
      const dx = playerPos.x - s.root.position.x;
      const dz = playerPos.z - s.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD){ best = s; bestD = d; }
    }
    if (!best) return null;
    const t = THREE.MathUtils.clamp(best.charge / best.holdSeconds, 0, 1);
    return { state: best.state, t, dist: bestD, radius: best.radius };
  }

  /** Totem non-done più vicino con posizione. */
  getNearestIncomplete(playerPos){
    let best=null, bestD=Infinity;
    for (const s of this._sanct){
      if (s.state === 'done') continue;
      const dx = playerPos.x - s.root.position.x;
      const dz = playerPos.z - s.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD){ best = s; bestD = d; }
    }
    if (!best) return null;
    const t = THREE.MathUtils.clamp(best.charge / best.holdSeconds, 0, 1);
    return { state: best.state, t, dist: bestD, radius: best.radius, pos: best.root.position.clone() };
  }

  /** Sei dentro al ring (considerando entryPad)? */
  isInsideRing(playerPos, sanct){
    if (!sanct) return false;
    const dx = playerPos.x - sanct.pos.x;
    const dz = playerPos.z - sanct.pos.z;
    const rad = (sanct.radius ?? 0) + (this.entryPad ?? 0);
    return (dx*dx + dz*dz) <= rad*rad;
  }

  /** True se almeno un santuario è in purifying (retro compat). */
  isPurifySafe(){ return this._purifyingCount > 0; }

  /** True se sei dentro a un ring armed/purifying (non done). */
  isInsideProtectedRing(playerPos){
    for (const s of this._sanct){
      if (s.state === 'done') continue;
      const dx = playerPos.x - s.root.position.x;
      const dz = playerPos.z - s.root.position.z;
      const rad = s.radius + (this.entryPad ?? 0);
      const inside = (dx*dx + dz*dz) <= rad*rad;
      if (inside && (s.state === 'armed' || s.state === 'purifying')) return true;
    }
    return false;
  }

  /** Quanti totem stanno attualmente canalizzando. */
  getPurifyingCount(){ return this._purifyingCount | 0; }

  _celebrateAll(){
    for (const s of this._sanct){
      s.state = 'done';
      this._applyVisual(s, 1, 'done');
    }
  }

  /** Occluders statici: { pos:Vector3, radius:Number, height:Number } */
  getOccluders(){
    return this._sanct.map(s => s.collider).filter(Boolean);
  }

  /** Reset totale (per Retry/Replay). */
  resetAll(){
    this._doneCount = 0;
    this._purifyingCount = 0;
    this._safeCount = 0;
    for (const s of this._sanct){
      s.charge = 0;
      s.state  = 'idle';
      this._applyVisual(s, 0, 'idle');
    }
    this._lastBeamHex = null;
    if (this.onBeamTint) this.onBeamTint(null);
  }
}

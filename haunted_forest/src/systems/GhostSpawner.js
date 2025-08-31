// systems/GhostSpawner.js
// -----------------------------------------------------------------------------
// Gestisce il pool dei fantasmi, lo spawn (anche in ondate), il despawn
// intelligente (lontananza / alle spalle fuori schermo), e la “modalità difesa”
// intorno ai totem (cap temporaneo e orbita).
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
import { Ghost } from '../entities/Ghost.js';

/** @internal random [0,1) */
const rand01 = () => Math.random();
/** @internal intero in [a,b] */
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* ========================= Costanti (solo naming) ========================= */
const DEFAULTS = {
  POOL_SIZE: 24,
  MAX_ALIVE: 12,
  SPAWN_INTERVAL: 0.4,

  MIN_R: 6.0,
  MAX_R: 14.0,
  MIN_PLAYER_DIST: 5.0,
  MIN_SEPARATION: 2.0,
  MAX_TRIES_PER_TICK: 12,

  ANTI_POP_IN: false,

  SPAWN_MODE: 'mix',
  SECTOR_HALF_DEG: 60,
  MIX_WEIGHTS: { front: 0.25, behind: 0.5, left: 0.125, right: 0.125 },

  // Despawn/culling
  DESPAWN_BEHIND_DIST: 60,
  MIN_BEHIND_RANGE: 30,
  BEHIND_TIME: 1.25,
  PROTECT_SECONDS: 0.75,
  DESPAWN_STYLE: 'deactivate', // 'deactivate' | 'cleanse'

  // Wave by distance
  WAVE_BY_DISTANCE: true,
  WAVE_METERS: 70,
  WAVE_COUNT_MIN: 2,
  WAVE_COUNT_MAX: 3,
  WAVE_MIN_INTERVAL: 2.5,
  WAVE_JITTER: 1.0,

  // Guard mode (difesa totem)
  GUARD_ORBIT_SPEED: 0.7,
  GUARD_ORBIT_RADIUS_MUL: 0.65,
  GUARD_CHASE_PLAYER_WITHIN_TOTEM: 0.6,
  GUARD_CHASE_PLAYER_NEAR_GHOST: 180
};

/**
 * @typedef {Object} GhostSpawnerOptions
 * @property {THREE.Scene} scene
 * @property {THREE.Camera} camera
 * @property {(x:number,z:number)=>number} [getGroundY]
 * @property {()=>THREE.Vector3} [getFocusPos]
 * @property {function(Ghost):void} [onGhostCleansed]
 *
 * @property {number} [poolSize=24]
 * @property {number} [maxAlive=12]
 * @property {number} [spawnInterval=0.4]
 * @property {number} [minR=6]
 * @property {number} [maxR=14]
 * @property {number} [minPlayerDist=5]
 * @property {number} [minSeparation=2]
 * @property {number} [maxTriesPerTick=12]
 * @property {boolean} [antiPopIn=false]
 *
 * @property {'mix'|'front'|'behind'|'left'|'right'|'none'} [spawnMode='mix']
 * @property {number} [sectorHalfAngleDeg=60]
 * @property {{front:number,behind:number,left:number,right:number}} [mixWeights]
 *
 * @property {number} [farCull=maxR*2]
 * @property {number} [despawnBehindDist=60]
 * @property {number} [minBehindRange=30]
 * @property {number} [behindTime=1.25]
 * @property {number} [protectSeconds=0.75]
 * @property {'deactivate'|'cleanse'} [despawnStyle='deactivate']
 *
 * @property {{byDistance:boolean,meters:number,countMin:number,countMax:number,minInterval:number,jitter:number}} [wave]
 *
 * @property {Object} [ghostOpts] opzioni inoltrate al costruttore di Ghost
 */

/**
 * Gestore dello spawn dei fantasmi (pooling, regole di visibilità, ondate,
 * hotspot di difesa).
 */
export class GhostSpawner {
  /**
   * @param {GhostSpawnerOptions} [opts]
   */
  constructor(opts = {}) {
    // --- Dipendenze esterne --------------------------------------------------
    this.scene       = opts.scene;
    this.camera      = opts.camera;
    this.getGroundY  = opts.getGroundY || (() => 0);
    this.getFocusPos = opts.getFocusPos || null;

    // Callback esterne
    this.onGhostCleansed = typeof opts.onGhostCleansed === 'function' ? opts.onGhostCleansed : null;

    // --- Pool & Active -------------------------------------------------------
    /** @type {Ghost[]} */
    this.pool = [];
    /** @type {Set<Ghost>} */
    this.active = new Set();

    // --- Parametri (valori invariati rispetto all’originale) ----------------
    this.params = {
      // Pool/spawn
      poolSize:      opts.poolSize      ?? DEFAULTS.POOL_SIZE,
      maxAlive:      opts.maxAlive      ?? DEFAULTS.MAX_ALIVE,
      spawnInterval: opts.spawnInterval ?? DEFAULTS.SPAWN_INTERVAL,
      minR:          opts.minR          ?? DEFAULTS.MIN_R,
      maxR:          opts.maxR          ?? DEFAULTS.MAX_R,
      minPlayerDist: opts.minPlayerDist ?? DEFAULTS.MIN_PLAYER_DIST,
      minSeparation: opts.minSeparation ?? DEFAULTS.MIN_SEPARATION,
      maxTriesPerTick: opts.maxTriesPerTick ?? DEFAULTS.MAX_TRIES_PER_TICK,

      // Visibilità/anti pop-in
      antiPopIn:     opts.antiPopIn ?? DEFAULTS.ANTI_POP_IN,

      // Settori
      spawnMode:          opts.spawnMode ?? DEFAULTS.SPAWN_MODE,
      sectorHalfAngleDeg: opts.sectorHalfAngleDeg ?? DEFAULTS.SECTOR_HALF_DEG,
      mixWeights: {
        front:  (opts.mixWeights?.front  ?? DEFAULTS.MIX_WEIGHTS.front),
        behind: (opts.mixWeights?.behind ?? DEFAULTS.MIX_WEIGHTS.behind),
        left:   (opts.mixWeights?.left   ?? DEFAULTS.MIX_WEIGHTS.left),
        right:  (opts.mixWeights?.right  ?? DEFAULTS.MIX_WEIGHTS.right),
      },

      // Despawn/culling
      farCull:            opts.farCull            ?? ((opts.maxR ?? DEFAULTS.MAX_R) * 2),
      despawnBehindDist:  opts.despawnBehindDist  ?? DEFAULTS.DESPAWN_BEHIND_DIST,
      minBehindRange:     opts.minBehindRange     ?? DEFAULTS.MIN_BEHIND_RANGE,
      behindTime:         opts.behindTime         ?? DEFAULTS.BEHIND_TIME,
      protectSeconds:     opts.protectSeconds     ?? DEFAULTS.PROTECT_SECONDS,
      despawnStyle:       opts.despawnStyle       ?? DEFAULTS.DESPAWN_STYLE,

      // Ondate a distanza percorsa
      wave: {
        byDistance: opts.wave?.byDistance ?? DEFAULTS.WAVE_BY_DISTANCE,
        meters:     opts.wave?.meters     ?? DEFAULTS.WAVE_METERS,
        countMin:   opts.wave?.countMin   ?? DEFAULTS.WAVE_COUNT_MIN,
        countMax:   opts.wave?.countMax   ?? DEFAULTS.WAVE_COUNT_MAX,
        minInterval:opts.wave?.minInterval?? DEFAULTS.WAVE_MIN_INTERVAL,
        jitter:     opts.wave?.jitter     ?? DEFAULTS.WAVE_JITTER,
      },

      // Opzioni di Ghost inoltrate
      ghostOpts:          opts.ghostOpts ?? {},
    };

    // --- Stato runtime -------------------------------------------------------
    this.spawnCooldown = this.params.spawnInterval;
    this._time = 0;

    // Stato per “wave by distance”
    this._lastCamPos   = this.camera?.position?.clone() ?? new THREE.Vector3();
    this._distAccum    = 0;
    this._waveCooldown = 0;

    // Scratch oggetti
    this._frustum = new THREE.Frustum();
    this._proj    = new THREE.Matrix4();
    this._forward = new THREE.Vector3();
    this._right   = new THREE.Vector3();

    // Timers (“dietro” + protezione spawn)
    this._behindTimers = new Map();
    this._protectUntil = new Map();

    // Aggro pause (usato durante purify)
    this._pauseAggro = false;

    // Hotspot di difesa (cap temporaneo + spawn più denso)
    this._defense = null;
    this._capBoost = 0;
    this._boostActive = false;

    // Parametri “guard mode” (orbita il totem)
    this.guard = {
      orbitSpeed: DEFAULTS.GUARD_ORBIT_SPEED,
      orbitRadiusMul: DEFAULTS.GUARD_ORBIT_RADIUS_MUL,
      chasePlayerWithinTotem: DEFAULTS.GUARD_CHASE_PLAYER_WITHIN_TOTEM,
      chasePlayerNearGhost: DEFAULTS.GUARD_CHASE_PLAYER_NEAR_GHOST,
    };

    // Tracking stato precedente per eventi (es. onGhostCleansed)
    this._prevState = new Map();
  }

  /** Precarica il pool dei Ghost. */
  async init() {
    for (let i = 0; i < this.params.poolSize; i++) {
      const g = new Ghost({
        ...this.params.ghostOpts,
        getGroundY:  this.getGroundY,
        getTargetPos: () => this.camera?.position?.clone?.() ?? null,
      });
      await g.load();
      this.pool.push(g);
    }
  }

  // =========================== API pubblica =================================

  /** Ritorna un ghost attivo a caso (comodo per debug/HUD). */
  firstActive() { for (const g of this.active) return g; return null; }
  /** Aumenta il cap massimo (debug/aiuti). */
  incMaxAlive(n=1){ this.params.maxAlive += n; }
  /** Riduce il cap massimo (mai sotto 0). */
  decMaxAlive(n=1){ this.params.maxAlive = Math.max(0, this.params.maxAlive - n); }
  /** Cambia modalità di spawn (front/behind/left/right/mix/none). */
  setSpawnMode(mode){ this.params.spawnMode = mode; }
  /** Attiva/disattiva la regola anti pop-in. */
  toggleAntiPopIn(){ this.params.antiPopIn = !this.params.antiPopIn; }

  /** Pausa l’aggressività: niente nuovi spawn e ghost “pacificati”. */
  pauseAggro(flag){ this._pauseAggro = !!flag; }
  /** Stato pausa aggressività. */
  isAggroPaused(){ return !!this._pauseAggro; }

  /**
   * Reset completo (usato da Retry/Replay).
   * - Despawn immediato di tutti i ghost attivi
   * - Azzera cooldown/timers/wave/protections
   * - Disattiva eventuale defense hotspot
   */
  reset(){
    // Despawn immediato di tutti gli active
    for (const g of Array.from(this.active)) this._despawnImmediate(g);
    this.active.clear();

    // Timers & stati
    this.spawnCooldown = this.params.spawnInterval;
    this._time = 0;
    this._distAccum = 0;
    this._waveCooldown = 0;

    this._behindTimers.clear();
    this._protectUntil.clear();
    this._prevState.clear();

    this._defense = null;
    this._capBoost = 0;
    this._boostActive = false;

    this._pauseAggro = false;
  }

  // ---------------------- Defense Hotspot (totem) ---------------------------
  /**
   * Incrementa temporaneamente il cap e riduce l’intervallo spawn
   * quando il player è dentro il raggio del totem.
   */
  setDefenseHotspot({ pos, radius = 700, capBoost = 2, spawnIntervalMul = 0.6 } = {}){
    if (!pos) { this._defense = null; return; }
    this._defense = {
      pos: pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y||0, pos.z),
      radius: Math.max(1, +radius || 1),
      capBoost: Math.max(0, capBoost|0),
      spawnIntervalMul: Math.max(0.1, Math.min(1, +spawnIntervalMul || 1))
    };
  }
  /** Disattiva l’hotspot (torna al comportamento normale). */
  clearDefenseHotspot(){ this._defense = null; }

  /** Forza lo spawn di un singolo ghost subito (se possibile). */
  forceSpawnNow(){ this.spawnCooldown = 0; this._trySpawnOne(); }
  /** Forza un’ondata di n ghost (rispetta comunque il cap). */
  forceWave(n = 2){
    const want = Math.max(1, n|0);
    for (let i=0; i<want; i++){
      if (this.active.size >= this._getMaxAlive()) break;
      if (!this._trySpawnOne()) break;
    }
    this._distAccum = 0;
    this._waveCooldown = this.params.wave.minInterval;
  }

  /** Riempie fino al cap attuale. */
  fillToCap(){
    let guard = 32;
    while (this.active.size < this._getMaxAlive() && guard-- > 0) {
      if (!this._trySpawnOne()) break;
    }
  }
  /** “Purifica” tutti i ghost attivi (transizione di dissolve). */
  cleanseAll(){ for (const g of this.active) g.cleanse(); }
  /** “Purifica” il ghost più vicino alla posizione data. */
  cleanseNearest(camPos){
    let best=null, bestD=Infinity;
    for (const g of this.active){
      const dx = g.root.position.x - camPos.x;
      const dz = g.root.position.z - camPos.z;
      const d = Math.hypot(dx,dz);
      if (d < bestD){ best=g; bestD=d; }
    }
    if (best) best.cleanse();
  }

  /** Info per HUD/Debug. */
  debugInfo(){
    return {
      alive:    this.active.size,
      maxAlive: this._getMaxAlive(),
      pool:     this.pool.length,
      nextIn:   Math.max(0, this.spawnCooldown),
      mode:     this.params.spawnMode,
      antiPopIn:this.params.antiPopIn,
      aggroPaused: this._pauseAggro,
      defenseActive: !!this._boostActive,
    };
  }

  // ============================== Main tick =================================
  /**
   * Avanza lo stato dello spawner e dei ghost.
   * @param {number} dt delta time in secondi
   */
  update(dt) {
    this._time += dt;

    // 1) Distanza XZ percorsa → ondate
    const cp = this.camera.position;
    this._distAccum += Math.hypot(cp.x - this._lastCamPos.x, cp.z - this._lastCamPos.z);
    this._lastCamPos.copy(cp);
    this._waveCooldown -= dt;

    // 2) Riciclo e culling
    this._recycleInactive();
    this._cullByDistanceAndBehind(dt);

    // 3) Defense hotspot attivo?
    const def = this._defense;
    const inDefense = !!(def && !this._pauseAggro &&
      Math.hypot(cp.x - def.pos.x, cp.z - def.pos.z) <= def.radius);
    this._capBoost    = inDefense ? (def.capBoost|0) : 0;
    this._boostActive = inDefense;

    // Se l’hotspot si spegne, rimuovi guard mode e torna a targettare il player
    if (!this._boostActive) {
      for (const g of this.active) {
        if (g._guardMode) {
          g.getTargetPos = () => this.camera.position.clone();
          g._guardMode = false;
          delete g._guardPhase; delete g._guardCenter;
          g._chasing = false;
          g.params.speed = g._baseSpeed ?? g.params.speed;
          g.params.burstMultiplier = g._baseBurst ?? g.params.burstMultiplier;
        }
      }
    }

    // 4) Spawn “a cadenza” (pausato durante purify)
    if (!this._pauseAggro) {
      this.spawnCooldown -= dt;
      if (this.spawnCooldown <= 0 && this.active.size < this._getMaxAlive()) {
        const spawned = this._trySpawnOne();
        const base = this.params.spawnInterval;
        const mul  = (inDefense ? (def?.spawnIntervalMul ?? 1) : 1);
        this.spawnCooldown = spawned ? (base * mul) : Math.max(0.5, base * 0.25);
      }
    } else {
      // mantieni un cooldown non-zero per evitare loop di spawn immediati quando si riattiva
      this.spawnCooldown = Math.max(this.spawnCooldown, this.params.spawnInterval * 0.75);
    }

    // 5) Wave by distance
    const w = this.params.wave;
    if (!this._pauseAggro && w.byDistance && this._waveCooldown <= 0 && this._distAccum >= w.meters) {
      const want = randInt(w.countMin, w.countMax);
      for (let i=0; i<want; i++) {
        if (this.active.size >= this._getMaxAlive()) break;
        if (!this._trySpawnOne()) break;
      }
      this._distAccum = 0;
      this._waveCooldown = Math.max(0.5, w.minInterval + (Math.random()*2 - 1) * w.jitter);
    }

    // 6) Avanza i ghost + eventi (es. onGhostCleansed)
    for (const g of this.active) {
      if (this._pauseAggro && typeof g.setPacified === 'function') g.setPacified(true);
      if (!this._pauseAggro && typeof g.setPacified === 'function') g.setPacified(false);
      g.update?.(dt);

      const prev = this._prevState.get(g) ?? g.state;
      if (prev !== g.state) {
        if (g.state === 'cleansing' && this.onGhostCleansed) this.onGhostCleansed(g);
        this._prevState.set(g, g.state);
      }
    }
  }

  // ============================== Internals =================================
  _getMaxAlive(){ return this.params.maxAlive + (this._capBoost|0); }

  /** Rimette nel pool i ghost tornati “inactive”. */
  _recycleInactive(){
    for (const g of Array.from(this.active)) {
      if (g.state === 'inactive') {
        if (g.root.parent) g.root.parent.remove(g.root);
        this.active.delete(g);
        this.pool.push(g);
        this._behindTimers.delete(g);
        this._protectUntil.delete(g);
        this._prevState.delete(g);
      }
    }
  }

  /** Despawn “secco” (rimozione immediata). */
  _despawnImmediate(g){
    if (g.root.parent) g.root.parent.remove(g.root);
    g.deactivate();
    this.active.delete(g);
    this.pool.push(g);
    this._behindTimers.delete(g);
    this._protectUntil.delete(g);
    this._prevState.delete(g);
  }

  /** Despawn tramite “cleanse” (transizione visiva). */
  _despawnCleanse(g){
    if (g.state !== 'cleansing') g.cleanse();
    this._behindTimers.delete(g);
    this._protectUntil.delete(g);
  }

  /** Direzione forward/right sul piano XZ (normalizzate). */
  _getForwardXZ(){
    this.camera.getWorldDirection(this._forward);
    this._forward.y = 0;
    const len = this._forward.length();
    if (len < 1e-5) { this._forward.set(0,0,-1); }
    else { this._forward.multiplyScalar(1/len); }
    this._right.set(this._forward.z, 0, -this._forward.x);
  }

  /** Culling per distanza e “alle spalle fuori schermo” con timer. */
  _cullByDistanceAndBehind(dt){
    const pCam = this.camera.position;
    this._getForwardXZ();

    this._proj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._proj);

    const farCull = this.params.farCull;
    const behDist = this.params.despawnBehindDist;
    const behTime = this.params.behindTime;
    const minBehindRange = this.params.minBehindRange;

    for (const g of Array.from(this.active)) {
      const gx = g.root.position.x, gz = g.root.position.z;
      const dx = gx - pCam.x, dz = gz - pCam.z;
      const dist = Math.hypot(dx, dz);

      const until = this._protectUntil.get(g) ?? 0;
      const inProtect = (this._time < until);

      // troppo lontani
      if (dist > farCull) {
        (this.params.despawnStyle === 'cleanse') ? this._despawnCleanse(g) : this._despawnImmediate(g);
        continue;
      }

      // alle spalle, lontani dallo schermo e non protetti → timer di despawn
      const exposure = +g.exposure || 0;
      if (!inProtect && exposure <= 0.05) {
        const s = this._forward.x * dx + this._forward.z * dz; // proiezione lungo forward
        const onScreen = this._frustum.containsPoint(g.root.position);
        if (s < -behDist && dist > minBehindRange && !onScreen) {
          const t = (this._behindTimers.get(g) || 0) + dt;
          this._behindTimers.set(g, t);
          if (t >= behTime) {
            (this.params.despawnStyle === 'cleanse') ? this._despawnCleanse(g) : this._despawnImmediate(g);
            continue;
          }
        } else {
          if (this._behindTimers.has(g)) this._behindTimers.set(g, 0);
        }
      } else {
        if (this._behindTimers.has(g)) this._behindTimers.set(g, 0);
      }
    }
  }

  /** Estrae dal pool (o null se vuoto). */
  _getFromPool(){ return this.pool.pop() || null; }

  /** Prova a spawnare un singolo ghost secondo le regole correnti. */
  _trySpawnOne(){
    if (this.pool.length === 0) return false;
    if (this._pauseAggro) return false;

    // Centro di spawn: totem se boost attivo, altrimenti player
    const focus = this.camera?.position;
    const center = (this._boostActive && this._defense?.pos) ? this._defense.pos : focus;
    if (!center) return false;

    this._getForwardXZ();

    const tries = this.params.maxTriesPerTick;
    for (let i = 0; i < tries; i++) {
      const cand = this._sampleCandidate(center);
      if (!cand) continue;
      if (this._rejectByRules(cand, focus)) continue;

      const g = this._getFromPool();
      if (!g) return false;

      g.resetKinematics?.();
      g.setPosition(cand.x, cand.y, cand.z).addTo(this.scene);
      g.appear();

      // Guard mode: orbita e “chase” situazionale intorno al totem
      if (this._boostActive && this._defense?.pos) {
        const def = this._defense;
        const orbitR = THREE.MathUtils.lerp(this.params.minR, this.params.maxR, this.guard.orbitRadiusMul);

        g._guardPhase  = Math.random() * Math.PI * 2;
        g._guardCenter = def.pos.clone();
        g._guardMode   = true;

        g._chasing = false;
        g._chaseBoostUntil = 0;
        g._baseSpeed = g.params.speed;
        g._baseBurst = g.params.burstMultiplier;
        g._boostSpeed = g._baseSpeed * 1.25;
        g._boostBurst = g._baseBurst * 1.15;
        g._boostDuration = 2.0;

        g.getTargetPos = () => {
          const cam = this.camera.position;
          const gx = g.root.position.x, gz = g.root.position.z;

          const distPlayerTotem = Math.hypot(cam.x - def.pos.x, cam.z - def.pos.z);
          const distPlayerGhost = Math.hypot(cam.x - gx,      cam.z - gz);

          const seesPlayerNearTotem =
            distPlayerTotem <= def.radius * this.guard.chasePlayerWithinTotem;

          const seesPlayerNearGhost =
            distPlayerGhost <= this.guard.chasePlayerNearGhost;

          if (!this._pauseAggro && (seesPlayerNearTotem || seesPlayerNearGhost)) {
            if (!g._chasing) {
              g._chasing = true;
              g.params.speed = g._boostSpeed;
              g.params.burstMultiplier = g._boostBurst;
              g._chaseBoostUntil = performance.now() * 0.001 + g._boostDuration;
            }
            if (g._chasing && performance.now() * 0.001 > g._chaseBoostUntil) {
              g.params.speed = g._baseSpeed;
              g.params.burstMultiplier = g._baseBurst;
            }
            return cam.clone();
          }

          // Orbita il totem
          const t = (performance.now() * 0.001) + g._guardPhase;
          const x = def.pos.x + Math.cos(t * this.guard.orbitSpeed) * orbitR;
          const z = def.pos.z + Math.sin(t * this.guard.orbitSpeed) * orbitR;
          const y = this.getGroundY(x, z) + 2.0;
          return new THREE.Vector3(x, y, z);
        };
      } else {
        // Standard: inseguono il player
        g.getTargetPos = () => this.camera.position.clone();
        g._guardMode = false;
      }

      this.active.add(g);
      this._prevState.set(g, g.state);
      this._protectUntil.set(g, this._time + (this.params.protectSeconds || 0));
      return true;
    }
    return false;
  }

  /** Campiona un candidato di spawn sul settore scelto e r casuale in [minR,maxR]. */
  _sampleCandidate(center){
    const { minR, maxR, spawnMode, sectorHalfAngleDeg } = this.params;

    const dir2D = this._pickDirection2D(spawnMode);
    const half = THREE.MathUtils.degToRad(sectorHalfAngleDeg);
    const jitter = (rand01() * 2 - 1) * half;

    const cosJ = Math.cos(jitter), sinJ = Math.sin(jitter);
    const rx = dir2D.x * cosJ - dir2D.z * sinJ;
    const rz = dir2D.x * sinJ + dir2D.z * cosJ;

    const r2min = minR * minR;
    const r2max = maxR * maxR;
    const r = Math.sqrt( r2min + (r2max - r2min) * rand01() );

    const x = center.x + rx * r;
    const z = center.z + rz * r;
    const y = this.getGroundY(x,z) + 1.4;

    return new THREE.Vector3(x, y, z);
  }

  /** Sceglie la direzione base (F/B/L/R) o random/mix. */
  _pickDirection2D(mode){
    const F = this._forward;
    const R = this._right;
    const B = new THREE.Vector3(-F.x, 0, -F.z);
    const L = new THREE.Vector3(-R.x, 0, -R.z);

    switch (mode) {
      case 'front':  return F.clone();
      case 'behind': return B.clone();
      case 'left':   return L.clone();
      case 'right':  return R.clone();
      case 'none':
      default: {
        if (mode !== 'mix') {
          const ang = Math.random() * Math.PI * 2;
          return new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
        }
        const w = this.params.mixWeights || {};
        const wf = Math.max(0, +w.front  || 0);
        const wb = Math.max(0, +w.behind || 0);
        const wl = Math.max(0, +w.left   || 0);
        const wr = Math.max(0, +w.right  || 0);
        const sum = wf+wb+wl+wr || 1;
        let u = Math.random() * sum;
        if ((u -= wf) < 0) return F.clone();
        if ((u -= wb) < 0) return B.clone();
        if ((u -= wl) < 0) return L.clone();
        return R.clone();
      }
    }
  }

  /** Applica le regole di esclusione per evitare spawn “ingiusti”. */
  _rejectByRules(p, focus){
    const { minPlayerDist, minSeparation, antiPopIn } = this.params;

    const cam = this.camera?.position || focus;
    if (!cam) return true;

    // 1) mai troppo vicino al player
    if (Math.hypot(p.x - cam.x, p.z - cam.z) < minPlayerDist) return true;

    // 2) mantieni separazione dagli altri ghost attivi
    for (const g of this.active) {
      const gx = g.root.position.x, gz = g.root.position.z;
      if (Math.hypot(p.x - gx, p.z - gz) < minSeparation) return true;
    }

    // 3) anti pop-in (non far apparire sotto gli occhi e vicinissimo)
    if (antiPopIn) {
      this._proj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._proj);
      const onScreen = this._frustum.containsPoint(p);
      const distCam = Math.hypot(p.x - cam.x, p.z - cam.z);
      if (onScreen && distCam < (this.params.minR * 0.85)) return true;
    }

    return false;
  }
}
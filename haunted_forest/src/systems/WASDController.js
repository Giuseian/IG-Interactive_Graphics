// src/systems/WASDController.js
// -----------------------------------------------------------------------------
// WASDController (stile FPS)
// -----------------------------------------------------------------------------
// - Gestisce yaw/pitch interni aggiornati dal mouse (pointer lock).
// - Muove la camera sul piano XZ in funzione della direzione di sguardo reale.
// - Tiene Y = ground(x,z) + eyeHeight (niente salti, niente gravità).
// - Semplice modello di accelerazione + “friction” esponenziale quando rilasci.
// - Nessuna dipendenza da OrbitControls.
// -----------------------------------------------------------------------------

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/**
 * @typedef {Object} WASDOpts
 * @property {THREE.Camera} camera                   Camera da guidare (obbligatoria)
 * @property {(x:number,z:number)=>number} [getGroundY] Funzione terreno (default: 0)
 * @property {number} [eyeHeight=20]                 Altezza degli “occhi” dal terreno
 * @property {number} [speed=50]                     Velocità base (m/s)
 * @property {number} [sprintMultiplier=1.6]         Moltiplicatore con Shift
 * @property {number} [accel=12]                     Quanto velocemente raggiunge il desired
 * @property {number} [friction=6]                   Smorzamento esponenziale a input nullo
 * @property {{minX:number,maxX:number,minZ:number,maxZ:number}|null} [bounds=null] Limiti hard su XZ
 * @property {number} [sensX=0.002]                  Sensibilità yaw (rad/px)
 * @property {number} [sensY=0.002]                  Sensibilità pitch (rad/px)
 * @property {number} [pitchMin=-PI/2+ε]             Limite inferiore pitch (rad)
 * @property {number} [pitchMax=+PI/2-ε]             Limite superiore pitch (rad)
 */

/**
 * Controller FPS minimale per camera libera su XZ.
 */
export class WASDController {
  /** @param {WASDOpts} param0 */
  constructor({
    camera,
    getGroundY = () => 0.0,
    eyeHeight = 20,
    speed = 50,
    sprintMultiplier = 1.6,
    accel = 12,
    friction = 6,
    bounds = null,
    sensX = 0.002,
    sensY = 0.002,
    pitchMin = -Math.PI/2 + 0.001,
    pitchMax =  Math.PI/2 - 0.001,
  } = {}) {
    // --- deps & parametri ---
    this.camera     = camera;
    this.getGroundY = getGroundY;
    this.eyeHeight  = eyeHeight;
    this.params = { speed, sprintMultiplier, accel, friction, bounds, sensX, sensY, pitchMin, pitchMax };

    // --- stato movimento/orientamento ---
    this.pos   = camera.position.clone();         // posizione “vera” che poi copiamo sulla camera
    this.vel   = new THREE.Vector3();             // velocità orizzontale (usiamo solo X/Z)
    this.keys  = new Set();                       // tasti attivi
    this.enabled = true;

    // Yaw/pitch iniziali dalla camera corrente (convenzione YXZ)
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw   = e.y;
    this.pitch = e.x;

    // scratch directions
    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();

    // --- input tastiera ---
    this._onKeyDown = (ev) => {
      const k = ev.key.toLowerCase();
      if (['w','a','s','d','shift'].includes(k)) ev.preventDefault();
      this.keys.add(k);
    };
    this._onKeyUp = (ev) => {
      const k = ev.key.toLowerCase();
      this.keys.delete(k);
    };
    addEventListener('keydown', this._onKeyDown);
    addEventListener('keyup',   this._onKeyUp);
  }

  /** Rimuove gli handler tastiera (da chiamare quando distruggi il controller). */
  dispose(){
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup',   this._onKeyUp);
  }

  /** Abilita/disabilita completamente il controller. */
  setEnabled(v){ this.enabled = !!v; }

  /** Cancella lo stato dei tasti premuti. */
  clearInput(){ this.keys.clear(); }

  /**
   * Riposiziona la camera in uno stato noto.
   * @param {{x:number,y?:number,z:number,yaw?:number,pitch?:number,zeroVel?:boolean}} pose
   *  Se y è omesso → y = ground(x,z) + eyeHeight.
   */
  resetPose({ x=0, z=0, y=null, yaw=0, pitch=0, zeroVel=true } = {}){
    if (zeroVel) this.vel.set(0,0,0);

    this.yaw   = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, this.params.pitchMin, this.params.pitchMax);

    const gy = this.getGroundY(x, z);
    const newY = (y == null) ? (gy + this.eyeHeight) : y;

    this.pos.set(x, newY, z);
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    this.clearInput();
  }

  /**
   * Da chiamare su mousemove quando hai il pointer lock attivo.
   * @param {number} dx deltaX in pixel
   * @param {number} dy deltaY in pixel
   */
  onMouseDelta(dx, dy){
    if (!this.enabled) return;
    // FPS “naturale”: a destra → yaw aumenta; in su → pitch diminuisce (convenzione YXZ).
    this.yaw   += dx * this.params.sensX;
    this.pitch -= dy * this.params.sensY;
    this.pitch = Math.max(this.params.pitchMin, Math.min(this.params.pitchMax, this.pitch));
  }

  /** Yaw snap (es. per Q/E). */
  addYaw(angleRad){ this.yaw += angleRad; }

  /** Forward XZ normalizzato della camera (utile a chi lo voglia leggere). */
  getForward(out = new THREE.Vector3()){
    this.camera.getWorldDirection(out);
    out.y = 0;
    const L = out.length();
    if (L < 1e-6) out.set(0,0,-1); else out.multiplyScalar(1/L);
    return out;
  }

  /** Velocità orizzontale corrente (m/s). */
  getSpeed(){ return Math.hypot(this.vel.x, this.vel.z); }

  /**
   * Tick di simulazione (da chiamare ogni frame).
   * @param {number} dt Delta-time in secondi
   */
  update(dt){
    if (!this.enabled) return;

    // 1) applica yaw/pitch alla camera (convenzione YXZ)
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // 2) direzioni locali su XZ derivate dalla camera
    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    const L = this._fwd.length();
    if (L < 1e-6) this._fwd.set(0,0,-1); else this._fwd.multiplyScalar(1/L);
    this._right.set(this._fwd.z, 0, -this._fwd.x); // perpendicolare su XZ

    // 3) input (WASD + Shift)
    let ix = 0, iz = 0;
    if (this.keys.has('w')) iz += 1;   // avanti
    if (this.keys.has('s')) iz -= 1;   // indietro
    if (this.keys.has('d')) ix += 1;   // destra
    if (this.keys.has('a')) ix -= 1;   // sinistra

    const moving   = (ix !== 0 || iz !== 0);
    const maxSpeed = this.params.speed * (this.keys.has('shift') ? this.params.sprintMultiplier : 1);

    // 4) velocità desiderata in world (solo XZ)
    const desired = new THREE.Vector3();
    if (moving) {
      desired
        .addScaledVector(this._fwd,   iz)
        .addScaledVector(this._right, ix);
      const Ld = desired.length();
      if (Ld > 1e-6) desired.multiplyScalar(maxSpeed / Ld);
    }

    // 5) accelera verso desired (lerp esponenziale stabile)
    const k = Math.min(1, this.params.accel * dt);
    this.vel.x += (desired.x - this.vel.x) * k;
    this.vel.z += (desired.z - this.vel.z) * k;

    // 6) friction quando non stai premendo
    if (!moving) {
      const damp = Math.exp(-this.params.friction * dt);
      this.vel.x *= damp; this.vel.z *= damp;
      if (this.vel.lengthSq() < 1e-6) this.vel.set(0,0,0);
    }

    // 7) integrazione + clamp XZ
    const dx = this.vel.x * dt;
    const dz = this.vel.z * dt;
    if (dx || dz) {
      this.pos.x += dx; this.pos.z += dz;
      const b = this.params.bounds;
      if (b){
        this.pos.x = Math.max(b.minX, Math.min(b.maxX, this.pos.x));
        this.pos.z = Math.max(b.minZ, Math.min(b.maxZ, this.pos.z));
      }
    }

    // Y = terreno + eyeHeight (niente rimbalzi)
    const gy = this.getGroundY(this.pos.x, this.pos.z);
    this.pos.y = gy + this.eyeHeight;

    // 8) scrivi sulla camera
    this.camera.position.copy(this.pos);
  }
}

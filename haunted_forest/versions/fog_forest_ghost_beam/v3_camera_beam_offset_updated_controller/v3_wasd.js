// src/systems/WASDController.js
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/**
 * WASDController – stile FPS:
 * - Tiene yaw/pitch interni (rotazione camera) aggiornati dal mouse.
 * - Muove su XZ rispetto allo sguardo reale della camera.
 * - Clamp Y = ground + eyeHeight.
 * - NESSUNA dipendenza da OrbitControls.
 */
export class WASDController {
  constructor({
    camera,
    getGroundY = () => 0.0,
    eyeHeight = 20,
    speed = 50,
    sprintMultiplier = 1.6,
    accel = 12,
    friction = 6,
    bounds = null,
    sensX = 0.002,   // sensibilità orizzontale mouse
    sensY = 0.002,   // sensibilità verticale mouse
    pitchMin = -Math.PI/2 + 0.001,
    pitchMax =  Math.PI/2 - 0.001,
  } = {}) {
    this.camera = camera;
    this.getGroundY = getGroundY;
    this.eyeHeight = eyeHeight;
    this.params = { speed, sprintMultiplier, accel, friction, bounds, sensX, sensY, pitchMin, pitchMax };

    // stato movimento
    this.pos = camera.position.clone();
    this.vel = new THREE.Vector3(); // solo XZ
    this.keys = new Set();
    this.enabled = true;

    // stato orientamento (inizializza dallo stato attuale della camera)
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;

    this._fwd = new THREE.Vector3();
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
    addEventListener('keyup', this._onKeyUp);
  }

  dispose(){
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener('keyup', this._onKeyUp);
  }

  setEnabled(v){ this.enabled = !!v; }

  /** Da chiamare sul mousemove quando il pointer lock è attivo. */
  onMouseDelta(dx, dy){
    if (!this.enabled) return;
    // Segni "naturali" FPS: mouse a destra -> yaw aumenta (ruoti a destra),
    // mouse su -> guardi su (pitch diminuisce perché +X è giù in convenzione YXZ).
    this.yaw   += dx * this.params.sensX;
    this.pitch -= dy * this.params.sensY;
    this.pitch = Math.max(this.params.pitchMin, Math.min(this.params.pitchMax, this.pitch));
  }

  /** Yaw snap (per Q/E) */
  addYaw(angleRad){
    this.yaw += angleRad;
  }

  /** Forward XZ normalizzato (utile a chi lo vuole leggere). */
  getForward(out = new THREE.Vector3()){
    // Calcolato dalla camera reale per essere sempre coerente col movimento
    this.camera.getWorldDirection(out);
    out.y = 0;
    const L = out.length();
    if (L < 1e-6) out.set(0,0,-1); else out.multiplyScalar(1/L);
    return out;
  }

  /** Velocità orizzontale corrente (m/s). */
  getSpeed(){
    return Math.hypot(this.vel.x, this.vel.z);
  }

  update(dt){
    if (!this.enabled) return;

    // 1) aggiorna rotazione camera da yaw/pitch
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    // 2) direzioni locali su XZ derivate dalla CAMERA (a prova di segno)
    this.camera.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    const L = this._fwd.length();
    if (L < 1e-6) this._fwd.set(0,0,-1); else this._fwd.multiplyScalar(1/L);
    this._right.set(this._fwd.z, 0, -this._fwd.x); // perpendicolare su XZ

    // 3) input
    let ix = 0, iz = 0;
    if (this.keys.has('w')) iz += 1;   // avanti
    if (this.keys.has('s')) iz -= 1;   // indietro
    if (this.keys.has('d')) ix += 1;   // destra
    if (this.keys.has('a')) ix -= 1;   // sinistra

    const moving = (ix !== 0 || iz !== 0);
    const maxSpeed = this.params.speed * (this.keys.has('shift') ? this.params.sprintMultiplier : 1);

    // 4) velocità desiderata
    const desired = new THREE.Vector3();
    if (moving) {
      desired
        .addScaledVector(this._fwd, iz)
        .addScaledVector(this._right, ix);
      const Ld = desired.length();
      if (Ld > 1e-6) desired.multiplyScalar(maxSpeed / Ld);
    }

    // 5) accel verso desired (solo XZ)
    const k = Math.min(1, this.params.accel * dt);
    this.vel.x += (desired.x - this.vel.x) * k;
    this.vel.z += (desired.z - this.vel.z) * k;

    // 6) friction se fermi
    if (!moving) {
      const damp = Math.exp(-this.params.friction * dt);
      this.vel.x *= damp; this.vel.z *= damp;
      if (this.vel.lengthSq() < 1e-6) this.vel.set(0,0,0);
    }

    // 7) integrazione + clamp
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

    // Y = terreno + occhi
    const gy = this.getGroundY(this.pos.x, this.pos.z);
    this.pos.y = gy + this.eyeHeight;

    // 8) applica alla camera
    this.camera.position.copy(this.pos);
  }
}

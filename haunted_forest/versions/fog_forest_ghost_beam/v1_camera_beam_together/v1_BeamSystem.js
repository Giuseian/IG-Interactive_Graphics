// src/systems/BeamSystem.js  - camera and beam moving together 
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

export class BeamSystem {
  constructor(opts = {}) {
    this.scene     = opts.scene;
    this.camera    = opts.camera;

    // ---- Stato beam
    this.enabled    = true;
    this.firing     = false;
    this.overheated = false;
    this.heat       = 0;

    // ---- Parametri gameplay
    this.halfAngleDeg = opts.halfAngleDeg ?? 18;
    this.maxRange     = opts.maxRange     ?? 200;
    this.exposureRate = opts.exposureRate ?? 3.5;

    // ---- Overheat interno (se vuoi agganciarlo all’HUD lo leggi da qui)
    this.heatRise   = opts.heatRise   ?? 0.8;
    this.heatFall   = opts.heatFall   ?? 0.7;
    this.overheatHi = opts.overheatHi ?? 1.0;
    this.overheatLo = opts.overheatLo ?? 0.6;

    // ---- Smoothing del puntamento (riduce jitter del mouse)
    this.smoothTau = opts.smoothTau ?? 0.12; // sec; 0 = off

    // ---- Ostacoli per LOS (facoltativi; se non li setti → sempre visibile)
    this.obstacles = opts.obstacles || [];

    // ---- Cache / scratch
    this._cosHalf   = Math.cos(THREE.MathUtils.degToRad(this.halfAngleDeg));
    this._ray       = new THREE.Raycaster();
    this._tmpV      = new THREE.Vector3();
    this._fwdRaw    = new THREE.Vector3(0,0,-1);
    this._fwdSmooth = new THREE.Vector3(0,0,-1);
    this._posSmooth = new THREE.Vector3();
    this._upNeg     = new THREE.Vector3(0,-1,0);

    this.hitsThisFrame = 0;

    // ---- NEW: info per HUD/target (bersaglio migliore del frame)
    this.focusedGhost    = null;
    this.focusedWeight   = 0;
    this.focusedDist     = Infinity;
    this.focusedExposure = 0;

    this._buildVisual();
  }

  // ---- API di comodo (usate dal main con , . 9 0)
  incHalfAngle(d=1){ this.setHalfAngleDeg(this.halfAngleDeg + d); }
  decHalfAngle(d=1){ this.setHalfAngleDeg(this.halfAngleDeg - d); }
  incRange(d=10){ this.setMaxRange(this.maxRange + d); }
  decRange(d=10){ this.setMaxRange(Math.max(2, this.maxRange - d)); }

  setFiring(v) { this.firing = !!v && !this.overheated; }
  setHalfAngleDeg(a) {
    this.halfAngleDeg = THREE.MathUtils.clamp(a, 2, 45);
    this._cosHalf = Math.cos(THREE.MathUtils.degToRad(this.halfAngleDeg));
  }
  setMaxRange(r) { this.maxRange = Math.max(2, r); }
  setObstacles(list) { this.obstacles = list || []; }

  /** Info per HUD/debug sul bersaglio attuale */
  getFocusInfo() {
    return {
      ghost: this.focusedGhost,
      exposure: this.focusedExposure,
      weight: this.focusedWeight,
      dist: this.focusedDist
    };
  }

  update(dt, ghostsIterable) {
    this._updateHeat(dt);

    // ---- Forward e posizione smussati
    const camPos = this.camera.position;
    this._fwdRaw.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();

    if (this.smoothTau > 0) {
      const a = 1 - Math.exp(-dt / this.smoothTau);
      this._fwdSmooth.lerp(this._fwdRaw, a).normalize();
      if (this._posSmooth.lengthSq() === 0) this._posSmooth.copy(camPos);
      this._posSmooth.lerp(camPos, a);
    } else {
      this._fwdSmooth.copy(this._fwdRaw);
      this._posSmooth.copy(camPos);
    }

    let visualLen = this.maxRange;
    this.hitsThisFrame = 0;

    // reset focus info (nuovo frame)
    this.focusedGhost    = null;
    this.focusedWeight   = 0;
    this.focusedDist     = Infinity;
    this.focusedExposure = 0;

    if (this.enabled && this.firing && !this.overheated && ghostsIterable) {
      for (const g of ghostsIterable) {
        if (!g || !g.root || g.state !== 'active') continue;

        // punto da “illuminare” (leggermente sopra il centro)
        const aim = this._tmpV.copy(g.root.position);
        aim.y += 1.0;

        // vettore camera→ghost (uso origine smussata)
        const to   = this._tmpV.clone().subVectors(aim, this._posSmooth);
        const dist = to.length();
        if (dist > this.maxRange || dist < 1e-3) continue;

        to.multiplyScalar(1 / dist);

        // test cono 3D
        const cosAng = to.dot(this._fwdSmooth);
        if (cosAng < this._cosHalf) continue;

        // LOS (se hai passato ostacoli)
        if (!this._hasLOS(this._posSmooth, aim, dist)) continue;

        // peso: centro del cono + vicino alla camera
        const wAngle = (cosAng - this._cosHalf) / (1 - this._cosHalf);
        const wDist  = 1 - (dist / this.maxRange);
        const weight = THREE.MathUtils.clamp(0.5 * wAngle + 0.5 * wDist, 0, 1);

        // aggiorna focus (bersaglio migliore)
        if (weight > this.focusedWeight) {
          this.focusedWeight = weight;
          this.focusedGhost  = g;
          this.focusedDist   = dist;
        }

        const cleansed = g.applyExposure(this.exposureRate * weight * dt);
        if (cleansed) this.hitsThisFrame++;

        if (dist < visualLen) visualLen = dist;
      }

      // dopo il loop, aggiorna exposure per HUD
      this.focusedExposure = this.focusedGhost ? (this.focusedGhost.exposure || 0) : 0;
    }

    this._updateVisual(visualLen);
  }

  _buildVisual() {
    const geo = new THREE.ConeGeometry(1, 1, 36, 1, true);
    geo.translate(0, -0.5, 0);

    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff2b3,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false
    });

    this.cone = new THREE.Mesh(geo, mat);
    this.cone.visible = false;
    this.cone.renderOrder = 900;
    this.cone.frustumCulled = false;
    this.scene.add(this.cone);
  }

  _updateHeat(dt) {
    const wanting = this.firing && !this.overheated;
    this.heat = THREE.MathUtils.clamp(this.heat + (wanting ? this.heatRise : -this.heatFall) * dt, 0, 1);

    if (!this.overheated && this.heat >= this.overheatHi) this.overheated = true;
    if (this.overheated && this.heat <= this.overheatLo) this.overheated = false;
    if (this.overheated) this.firing = false;
  }

  _updateVisual(length) {
    if (!this.cone) return;
    const show = this.firing && !this.overheated;
    this.cone.visible = show;
    if (!show) return;

    const len = THREE.MathUtils.clamp(length, 0.5, this.maxRange);
    const radius = Math.tan(THREE.MathUtils.degToRad(this.halfAngleDeg)) * len;

    // apice un filo davanti alla camera smussata (niente near clipping)
    const eps = Math.max(0.05, Math.min(0.25, 0.02 * len));
    const apex = this._posSmooth;
    const fwd  = this._fwdSmooth;

    this.cone.position.set(apex.x + fwd.x * eps, apex.y + fwd.y * eps, apex.z + fwd.z * eps);
    this.cone.quaternion.setFromUnitVectors(this._upNeg, fwd);
    this.cone.scale.set(radius, len, radius);
    this.cone.updateMatrixWorld(true);
  }

  _hasLOS(origin, aim, dist) {
    if (!this.obstacles || this.obstacles.length === 0) return true;
    this._ray.set(origin, this._tmpV.copy(aim).sub(origin).normalize());
    this._ray.far = dist;
    const hit = this._ray.intersectObjects(this.obstacles, true);
    return hit.length === 0;
  }
}
